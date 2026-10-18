import {spawn} from 'child_process';
import {expect, REPO_ROOT, test} from './support/app';
import {fixture} from './support/seed';
import {waitForPlayer} from './support/playback';

test('open-with: argv file prefills the new-project form, and a second instance forwards its file', async ({launch}) => {
  const {ui, userDataDir} = await launch({files: [fixture('sample.mp4')]});

  await expect(ui).toHaveURL(/project\/new/);
  const selected = ui.locator('.drop-zone-content.file-selected .label');
  await expect(selected.first()).toContainText('sample.mp4');
  await expect(selected.nth(1)).toContainText('sample.srt'); // companion subtitle

  await ui.getByRole('button', {name: 'Start Learning'}).click();
  await expect(ui).toHaveURL(/\/project\/[0-9a-f-]{36}/, {timeout: 20_000});
  await waitForPlayer(ui);

  // Second instance: shares userData, so it loses the single-instance lock, forwards argv and exits
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath: string = require('electron');
  const second = spawn(electronPath, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), fixture('sample-5.1.mkv')], {
    cwd: REPO_ROOT,
    env: {...process.env, YALL_MP_E2E: '1', YALL_MP_USER_DATA_DIR: userDataDir},
    stdio: 'ignore'
  });
  const exited = new Promise<number | null>(resolve => second.once('exit', resolve));
  const timer = setTimeout(() => second.kill('SIGKILL'), 20_000);
  await exited;
  clearTimeout(timer);

  await expect(ui).toHaveURL(/project\/new/, {timeout: 15_000});
  await expect(ui.locator('.drop-zone-content.file-selected .label').first()).toContainText('sample-5.1.mkv');
});
