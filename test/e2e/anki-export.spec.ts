import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {expect, test} from './support/app';
import {CLIPS_MEDIA, inClip} from './support/clips';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';

// The export cuts audio, a screenshot, a short video and an animation with the bundled ffmpeg and hands them to Anki
// through AnkiConnect (http://localhost:8765). Anki is replaced by a small server here, which copies every media file
// it is asked to store before the app deletes the temp files, and records the notes it is asked to add.
test.setTimeout(120_000);

interface Call {
  action: string;
  params: any;
}

const startFakeAnki = async (storeDir: string) => {
  const calls: Call[] = [];
  const stored: { name: string; bytes: Buffer }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const {action, params} = JSON.parse(body);
      calls.push({action, params});
      let result: unknown = null;
      if (action === 'storeMediaFile') {
        const copy = path.join(storeDir, params.filename);
        fs.copyFileSync(params.path, copy);
        stored.push({name: params.filename, bytes: fs.readFileSync(copy)});
        result = params.filename;
      } else if (action === 'addNote') {
        result = 4242;
      } else if (action === 'suspend') {
        result = true;
      } else if (action === 'version') {
        result = 6;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({result, error: null}));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(8765, '127.0.0.1', resolve);
  });
  return {calls, stored, close: () => new Promise<void>(resolve => server.close(() => resolve()))};
};

const isMp3 = (b: Buffer) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebm = (b: Buffer) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
const isAvif = (b: Buffer) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /avi[fs]/.test(b.subarray(8, 16).toString('latin1'));

test('exporting a card cuts mp3, jpg, webm and avif with the bundled ffmpeg and sends the note to AnkiConnect', async ({launch}) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-anki-'));
  let fake: Awaited<ReturnType<typeof startFakeAnki>>;
  try {
    fake = await startFakeAnki(storeDir);
  } catch (error) {
    test.skip(true, `port 8765 is taken (a real AnkiConnect?): ${(error as Error).message}`);
    return;
  }

  try {
    const {ui} = await launch({seed: dir => seedProject(dir, {media: CLIPS_MEDIA, duration: 15})});
    await waitForPlayer(ui);

    const target = {
      template: {
        id: 'e2e', name: 'e2e', ankiDeck: 'Deck', ankiNoteType: 'Basic', tags: [],
        fieldMappings: [
          {source: 'text', destination: 'Front'},
          {source: 'audio', destination: 'Audio'},
          {source: 'screenshot', destination: 'Picture'},
          {source: 'video', destination: 'Clip'},
          {source: 'animation', destination: 'Animation'}
        ]
      },
      tags: ['e2e']
    };
    const result = await ui.evaluate(request => (window as any).electronAPI.exportAnkiCardBatch(request), {
      subtitleData: {type: 'srt', id: '1', text: 'Clip one', startTime: inClip(1, 0), endTime: inClip(1, 1), track: 0},
      mediaPath: CLIPS_MEDIA,
      exportTime: inClip(1, 0.5),
      notes: 'a note', hint: 'a hint', suspend: true, targets: [target]
    });

    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.successCount).toBe(1);

    const byExtension = (ext: string) => fake.stored.find(file => file.name.endsWith(ext));
    expect(isMp3(byExtension('.mp3')?.bytes ?? Buffer.alloc(8)), 'an mp3 was stored').toBe(true);
    expect(isJpeg(byExtension('.jpg')?.bytes ?? Buffer.alloc(8)), 'a jpg was stored').toBe(true);
    expect(isWebm(byExtension('.webm')?.bytes ?? Buffer.alloc(8)), 'a webm was stored').toBe(true);
    expect(isAvif(byExtension('.avif')?.bytes ?? Buffer.alloc(16)), 'an avif was stored').toBe(true);
    for (const file of fake.stored) {
      expect(file.bytes.length, file.name).toBeGreaterThan(500);
    }

    const note = fake.calls.find(call => call.action === 'addNote')?.params.note;
    expect(note.deckName).toBe('Deck');
    expect(note.fields.Front).toBe('Clip one');
    expect(note.fields.Audio).toMatch(/^\[sound:.*\.mp3\]$/);
    expect(note.fields.Picture).toMatch(/^<img src=".*\.jpg">$/);
    expect(note.fields.Clip).toMatch(/<video .* src=".*\.webm"><\/video>/);
    expect(note.fields.Animation).toMatch(/^<img src=".*\.avif">$/);
    expect(fake.calls.some(call => call.action === 'suspend')).toBe(true);
  } finally {
    await fake.close();
    fs.rmSync(storeDir, {recursive: true, force: true});
  }
});
