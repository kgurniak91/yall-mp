import {describe, expect, it} from 'vitest';
import {customIconArguments, desktopEntryText, desktopIconFile, ensureAppImageDesktopEntry, pngSize} from '../linux-desktop-entry';

/** An in-memory file system. */
function memoryFs(files: Record<string, string | Buffer> = {}) {
  return {
    files,
    existsSync: (file: string) => file in files,
    readFileSync: (file: string) => String(files[file]),
    writeFileSync: (file: string, data: string | Buffer) => { files[file] = data; },
    mkdirSync: () => undefined
  };
}

function png(size: number): Buffer {
  const buffer = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(size, 16);
  buffer.writeUInt32BE(size, 20);
  return buffer;
}

const APP = '/home/u/Apps/Y\'ALL Media Player v1.AppImage';
const DESKTOP = '/data/applications/yall-mp.desktop';
const ICON = '/data/icons/hicolor/512x512/apps/yall-mp.png';

describe('AppImage desktop entry', () => {
  it('writes the entry and the icon the first time', () => {
    const fs = memoryFs();
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: png(512), fs})).toBe('created');
    expect(String(fs.files[DESKTOP])).toContain('StartupWMClass=yall-mp');
    expect(String(fs.files[DESKTOP])).toContain(`Exec="${APP}" --no-sandbox %U`);
    expect(fs.files[ICON]).toBeDefined();
  });

  it('leaves a matching entry alone, updates ours when the AppImage was renamed', () => {
    const fs = memoryFs();
    ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: png(512), fs});
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: png(512), fs})).toBe('unchanged');
    const renamed = '/home/u/Apps/Y\'ALL Media Player v2.AppImage';
    expect(ensureAppImageDesktopEntry({appImagePath: renamed, dataHome: '/data', icon: png(512), fs})).toBe('updated');
    expect(String(fs.files[DESKTOP])).toContain('v2.AppImage');
  });

  it('does not touch an entry that is not ours', () => {
    const fs = memoryFs({[DESKTOP]: '[Desktop Entry]\nName=mine\n'});
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: png(512), fs})).toBe('skipped');
    expect(fs.files[DESKTOP]).toBe('[Desktop Entry]\nName=mine\n');
  });

  it('does nothing outside an AppImage, without an icon or with a relative path', () => {
    const fs = memoryFs();
    expect(ensureAppImageDesktopEntry({appImagePath: undefined, dataHome: '/data', icon: png(512), fs})).toBe('skipped');
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: null, fs})).toBe('skipped');
    expect(ensureAppImageDesktopEntry({appImagePath: 'app.AppImage', dataHome: '/data', icon: png(512), fs})).toBe('skipped');
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: Buffer.from('not a png at all......'), fs})).toBe('skipped');
    expect(ensureAppImageDesktopEntry({appImagePath: APP, dataHome: '/data', icon: png(1024), fs})).toBe('skipped');
    expect(Object.keys(fs.files)).toHaveLength(0);
  });

  it('quotes special characters of the path for the Exec line', () => {
    // quoting layer: \" \$ \` ; string layer: every backslash doubled
    expect(desktopEntryText('/a b/"c"$d`e.AppImage')).toContain('Exec="/a b/\\\\"c\\\\"\\\\$d\\\\`e.AppImage" --no-sandbox %U');
    expect(desktopEntryText('/a/100%/x.AppImage')).toContain('Exec="/a/100%%/x.AppImage"');
  });

  it('reads the icon size from the PNG header', () => {
    expect(pngSize(png(512))).toBe(512);
    expect(pngSize(Buffer.alloc(40))).toBeNull();
  });
});

describe('AppImage file icon', () => {
  it('names the icon file after the icon size and skips icons the theme cannot use', () => {
    expect(desktopIconFile('/data', png(512))).toBe(ICON);
    expect(desktopIconFile('/data', png(256))).toBe('/data/icons/hicolor/256x256/apps/yall-mp.png');
    expect(desktopIconFile('/data', png(1024))).toBeNull();
    expect(desktopIconFile('/data', null)).toBeNull();
  });

  it('builds the gio arguments with a file URI that survives spaces and quotes in the paths', () => {
    expect(customIconArguments(APP, ICON)).toEqual(['set', APP, 'metadata::custom-icon', 'file:///data/icons/hicolor/512x512/apps/yall-mp.png']);
    expect(customIconArguments(APP, '/data dir/it\'s/yall-mp.png')[3]).toBe('file:///data%20dir/it\'s/yall-mp.png');
  });
});
