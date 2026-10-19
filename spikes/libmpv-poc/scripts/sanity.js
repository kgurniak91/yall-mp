// Headless sanity check from plain Node: playback, events, Lua auto-pause token, orderly destroy.
const path = require('path');
const root = path.join(__dirname, '..');
const addon = require(path.join(root, 'addon', 'build', 'Release', 'yall_libmpv_poc.node'));

const repo = path.join(root, '..', '..');
const sample = path.join(repo, 'test', 'e2e', 'fixtures', 'sample.mp4');
const lua = path.join(repo, 'mpv', 'yall_auto_pause.lua');

addon.loadMpv(path.join(root, 'vendor', 'mpv-dev', 'libmpv-2.dll'));
addon.create({
  vo: 'null', ao: 'null', idle: 'yes', 'keep-open': 'always',
  'load-scripts': 'yes', scripts: lua
});

const events = [];
const times = [];
addon.onEvent(e => {
  if (e.event === 'property-change' && e.name === 'time-pos' && e.data) times.push(parseFloat(e.data));
  else if (e.event !== 'property-change') events.push(e.event + (e.reason !== undefined ? `(${e.reason})` : ''));
  else events.push(`${e.name}=${e.data}`);
});
addon.observe('time-pos');
addon.observe('pause');
addon.observe('user-data/auto-pause-fired');

console.log('mpv version:', addon.getProperty('mpv-version'));
console.log('command loadfile rc =', addon.command(['loadfile', sample, 'replace']));

setTimeout(() => {
  console.log('script-message rc =', addon.command(['script-message', 'set-auto-pause', '1.0', 'tok']));
}, 800);

setTimeout(() => {
  console.log('time-pos samples:', times.length, 'last:', times[times.length - 1]);
  console.log('pause:', addon.getProperty('pause'), 'token:', addon.getProperty('user-data/auto-pause-fired'));
  addon.command(['script-message', 'set-auto-pause', '-1', '']);
  addon.setProperty('pause', 'no');
}, 3000);

setTimeout(() => {
  console.log('events:', [...new Set(events)].join(', '));
  console.log('eof-reached:', addon.getProperty('eof-reached'));
  const t0 = Date.now();
  addon.destroy();
  console.log('destroy took', Date.now() - t0, 'ms');
  process.exit(0);
}, 13500);
