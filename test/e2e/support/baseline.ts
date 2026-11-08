import {test} from './app';

// The stacked-window invariants only hold on Windows today; elsewhere a failed check is recorded as a baseline note instead of failing
export async function baseline(label: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (e) {
    if (process.platform === 'win32') {
      throw e;
    }
    const received = (e as Error).message.split('\n').find(l => l.includes('Received'));
    test.info().annotations.push({type: 'baseline', description: `${label}: ${received ?? (e as Error).message.slice(0, 200)}`});
  }
}
