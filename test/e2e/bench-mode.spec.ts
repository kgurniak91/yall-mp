import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {expect, test} from './support/app';
import {launchClips} from './support/player';

test('the bench mode plays, writes its counters and quits by itself', async ({launch}) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yall-bench-mode-')), 'result.json');
  const config = path.join(path.dirname(out), 'bench.json');
  fs.writeFileSync(config, JSON.stringify({warmupSec: 1, measureSec: 3, width: 960, height: 600, out}));

  const {app} = await launchClips(launch, {}, {env: {YALL_MP_BENCH: config}});
  await expect.poll(() => fs.existsSync(out), {timeout: 30_000}).toBe(true);

  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  expect(result.error).toBeUndefined();
  expect(result.sender.backend).toBeTruthy();
  expect(result.page.errors).toBe(0);
  expect(result.presentedFps).toBeGreaterThan(5);
  expect(result.mpv).toHaveProperty('frameDrops');
  await app.waitForEvent('close', {timeout: 15_000}).catch(() => undefined);
});
