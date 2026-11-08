import {describe, expect, it} from 'vitest';
import {lookupPanelBounds} from '../lookup-host';

describe('lookupPanelBounds', () => {
  it('centres a panel of 80 percent', () => {
    expect(lookupPanelBounds(1000, 500)).toEqual({x: 100, y: 50, width: 800, height: 400});
  });

  it('stays inside a 640x480 window', () => {
    const bounds = lookupPanelBounds(640, 480);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(640);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
  });
});
