import {PlayerState} from '../../../model/video.types';
import {HoverPauseController, isPointNearRects} from './hover-pause.controller';
import {DEFAULT_GLOBAL_SETTINGS} from '../../../model/settings.types';

describe('HoverPauseController', () => {
  let pause: jasmine.Spy;
  let resume: jasmine.Spy;
  let canResume: boolean;
  let controller: HoverPauseController;

  beforeEach(() => {
    jasmine.clock().install();
    canResume = true;
    pause = jasmine.createSpy('pause');
    resume = jasmine.createSpy('resume');
    controller = new HoverPauseController({pause, resume, canResume: () => canResume}, 150);
    controller.playerStateChanged(PlayerState.Playing);
  });

  afterEach(() => {
    controller.dispose();
    jasmine.clock().uninstall();
  });

  /** Pointer enters, our pause is confirmed by the player */
  function hoverAndPause(): void {
    controller.pointerMoved(true, true);
    controller.playerStateChanged(PlayerState.PausedByUser);
  }

  it('has the setting off by default', () => {
    expect(DEFAULT_GLOBAL_SETTINGS.pauseOnSubtitleHover).toBeFalse();
  });

  it('pauses when the pointer enters while playing', () => {
    controller.pointerMoved(true, true);

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause when the conditions are not met', () => {
    controller.pointerMoved(true, false);

    expect(pause).not.toHaveBeenCalled();
  });

  it('does not pause when the player is not playing', () => {
    controller.playerStateChanged(PlayerState.PausedByUser);

    controller.pointerMoved(true, true);

    expect(pause).not.toHaveBeenCalled();
  });

  it('resumes after the pointer leaves, once the delay has passed', () => {
    hoverAndPause();

    controller.pointerMoved(false, true);
    jasmine.clock().tick(149);
    expect(resume).not.toHaveBeenCalled();
    jasmine.clock().tick(2);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume when the pointer only left for a moment', () => {
    hoverAndPause();

    controller.pointerMoved(false, true);
    jasmine.clock().tick(50);
    controller.pointerMoved(true, true);
    jasmine.clock().tick(500);

    expect(resume).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);

    controller.pointerMoved(false, true);
    jasmine.clock().tick(151);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume a pause it did not make', () => {
    controller.pointerMoved(true, false);
    controller.playerStateChanged(PlayerState.PausedByUser);

    controller.pointerMoved(false, true);
    jasmine.clock().tick(500);

    expect(resume).not.toHaveBeenCalled();
  });

  for (const [name, interact] of [
    ['a word click or selection', (c: HoverPauseController) => c.interaction()]
  ] as const) {
    it(`does not resume after ${name}`, () => {
      hoverAndPause();

      interact(controller);
      controller.pointerMoved(false, true);
      jasmine.clock().tick(500);

      expect(resume).not.toHaveBeenCalled();
    });
  }

  it('does not resume when an interaction happens while the resume is pending', () => {
    hoverAndPause();
    controller.pointerMoved(false, true);
    jasmine.clock().tick(100);

    controller.interaction();
    jasmine.clock().tick(500);

    expect(resume).not.toHaveBeenCalled();
  });

  it('does not resume when a dialog took over before the delay ended', () => {
    hoverAndPause();
    controller.pointerMoved(false, true);
    canResume = false;
    jasmine.clock().tick(200);

    expect(resume).not.toHaveBeenCalled();
  });

  it('forgets the pause when the user plays again, and does not pause again while the pointer stays', () => {
    hoverAndPause();

    controller.playerStateChanged(PlayerState.Playing);
    controller.pointerMoved(true, true);
    controller.pointerMoved(false, true);
    jasmine.clock().tick(500);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it('pauses again after the pointer left and re-entered', () => {
    hoverAndPause();
    controller.playerStateChanged(PlayerState.Playing);

    controller.pointerMoved(false, true);
    controller.pointerMoved(true, true);

    expect(pause).toHaveBeenCalledTimes(2);
  });

  for (const state of [PlayerState.Seeking, PlayerState.AutoPausedAtEnd, PlayerState.Transitioning, PlayerState.Ended]) {
    it(`does not resume after the state moved on to ${state}`, () => {
      hoverAndPause();

      controller.playerStateChanged(state);
      controller.playerStateChanged(PlayerState.PausedByUser);
      controller.pointerMoved(false, true);
      jasmine.clock().tick(500);

      expect(resume).not.toHaveBeenCalled();
    });
  }

  it('keeps the pause while the player has not confirmed it yet', () => {
    controller.pointerMoved(true, true);
    controller.playerStateChanged(PlayerState.Playing);
    controller.playerStateChanged(PlayerState.PausedByUser);

    controller.pointerMoved(false, true);
    jasmine.clock().tick(151);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not pause for a subtitle that appears under a still pointer, only for pointer movement', () => {
    // No pointer event arrives when the subtitle appears, so nothing happens
    controller.playerStateChanged(PlayerState.Playing);
    expect(pause).not.toHaveBeenCalled();

    controller.pointerMoved(true, true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('waits for an open popup before resuming, then resumes once it is closed', () => {
    hoverAndPause();
    controller.setHolding(true);

    controller.pointerMoved(false, true);
    jasmine.clock().tick(1000);
    expect(resume).not.toHaveBeenCalled();

    controller.setHolding(false);
    jasmine.clock().tick(151);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume when the popup closes while the pointer is still over the subtitles', () => {
    hoverAndPause();
    controller.setHolding(true);

    controller.setHolding(false);
    jasmine.clock().tick(500);
    expect(resume).not.toHaveBeenCalled();

    controller.pointerMoved(false, true);
    jasmine.clock().tick(151);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume after a popup when a word was clicked', () => {
    hoverAndPause();
    controller.setHolding(true);
    controller.interaction();

    controller.pointerMoved(false, true);
    controller.setHolding(false);
    jasmine.clock().tick(500);

    expect(resume).not.toHaveBeenCalled();
  });

  it('forgets everything on reset', () => {
    hoverAndPause();

    controller.reset();
    controller.pointerMoved(false, true);
    jasmine.clock().tick(500);

    expect(resume).not.toHaveBeenCalled();
  });
});

describe('isPointNearRects', () => {
  const rects = [{left: 100, top: 100, right: 200, bottom: 120}];

  it('accepts points inside a rect', () => {
    expect(isPointNearRects(150, 110, rects, 0)).toBeTrue();
  });

  it('accepts points within the padding and rejects points beyond it', () => {
    expect(isPointNearRects(150, 128, rects, 8)).toBeTrue();
    expect(isPointNearRects(150, 129, rects, 8)).toBeFalse();
    expect(isPointNearRects(91, 110, rects, 8)).toBeFalse();
  });

  it('rejects everything without rects', () => {
    expect(isPointNearRects(0, 0, [], 8)).toBeFalse();
  });
});
