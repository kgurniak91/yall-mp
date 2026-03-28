import {fakeAsync, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {createServiceFactory, mockProvider, SpectatorService} from '@ngneat/spectator';
import {UnexportedNotesWarningService} from './unexported-notes-warning.service';
import {ClipsStateService} from '../../../../state/clips/clips-state.service';
import {AppStateService} from '../../../../state/app/app-state.service';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {ToastService} from '../../../../shared/services/toast/toast.service';
import {VideoClip} from '../../../../model/video.types';
import {Project} from '../../../../model/project.types';

describe('UnexportedNotesWarningService', () => {
  let spectator: SpectatorService<UnexportedNotesWarningService>;
  let toastService: jasmine.SpyObj<ToastService>;

  const currentClipSignal = signal<VideoClip | undefined>(undefined);
  const projectSignal = signal<Project | null>(null);
  const warnEnabledSignal = signal<boolean>(true);

  const createService = createServiceFactory({
    service: UnexportedNotesWarningService,
    providers: [
      mockProvider(ClipsStateService, {
        currentClipForAllTracks: currentClipSignal.asReadonly()
      }),
      mockProvider(AppStateService, {
        currentProject: projectSignal.asReadonly()
      }),
      mockProvider(GlobalSettingsStateService, {
        warnUnexportedNotes: warnEnabledSignal.asReadonly()
      }),
      mockProvider(ToastService)
    ]
  });

  beforeEach(() => {
    // Reset signals to baseline
    currentClipSignal.set(undefined);
    projectSignal.set(null);
    warnEnabledSignal.set(true);

    spectator = createService();
    toastService = spectator.inject(ToastService) as jasmine.SpyObj<ToastService>;

    // Ensure the effect runs initially to bind signals
    spectator.flushEffects();
  });

  it('shows warning 250ms after leaving a subtitled clip with notes without exporting', fakeAsync(() => {
    // Setup Project State
    projectSignal.set({
      id: 'proj-1',
      subtitles: [{id: 'sub-1', type: 'srt', startTime: 10, endTime: 20, text: 'A', track: 0}],
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    // Enter clip 1
    currentClipSignal.set({
      id: 'clip-1',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    // Leave clip 1 (enter gap)
    currentClipSignal.set({
      id: 'gap-1',
      hasSubtitle: false,
      sourceSubtitles: []
    } as any);
    spectator.flushEffects();

    // Before 250ms, no warning yet
    tick(100);
    expect(toastService.warn).not.toHaveBeenCalled();

    // After 250ms, warning appears
    tick(150);
    expect(toastService.warn).toHaveBeenCalledWith('You moved past a clip with notes without exporting it to Anki');
  }));

  it('does NOT show warning when resizing current clip while being inside of it', fakeAsync(() => {
    projectSignal.set({
      id: 'proj-1',
      subtitles: [{id: 'sub-1', type: 'srt', startTime: 10, endTime: 20, text: 'A', track: 0}],
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    // Enter clip 1
    currentClipSignal.set({
      id: 'clip-1',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    // Simulate transient state during resize: briefly drops to gap
    currentClipSignal.set({
      id: 'gap-transient',
      hasSubtitle: false,
      sourceSubtitles: []
    } as any);
    spectator.flushEffects();

    tick(50); // Less than 250ms timeout window

    // Restores to same clip
    currentClipSignal.set({
      id: 'clip-1-resized',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    tick(300); // Fast forward past the 250ms mark

    // Warning should have been cancelled
    expect(toastService.warn).not.toHaveBeenCalled();
  }));

  it('does NOT show warning when splitting the clip', fakeAsync(() => {
    // Initial Setup
    projectSignal.set({
      id: 'proj-1',
      subtitles: [{id: 'sub-1', type: 'srt', startTime: 10, endTime: 20, text: 'A', track: 0}],
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    currentClipSignal.set({
      id: 'clip-1',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    // Simulate split: The original clip 'sub-1' is replaced by 'sub-1a' and 'sub-1b'.
    // The playhead lands in 'sub-1b' which has the SAME notes.
    projectSignal.set({
      id: 'proj-1',
      subtitles: [
        {id: 'sub-1a', type: 'srt', startTime: 10, endTime: 15, text: 'A', track: 0},
        {id: 'sub-1b', type: 'srt', startTime: 15, endTime: 20, text: 'A', track: 0},
      ],
      notes: {
        'sub-1a': {manualNote: 'Test note'},
        'sub-1b': {manualNote: 'Test note'}
      },
      ankiExportHistory: []
    } as any);

    currentClipSignal.set({
      id: 'clip-1b',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1b'}]
    } as any);
    spectator.flushEffects();

    tick(300);

    // Even though source IDs changed, notes are identical, so no warning
    expect(toastService.warn).not.toHaveBeenCalled();
  }));

  it('does NOT show warning when deleting an unexported clip with notes', fakeAsync(() => {
    projectSignal.set({
      id: 'proj-1',
      subtitles: [{id: 'sub-1', type: 'srt', startTime: 10, endTime: 20, text: 'A', track: 0}],
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    currentClipSignal.set({
      id: 'clip-1',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    // Simulate Delete Clip: 'sub-1' is removed from project subtitles.
    projectSignal.set({
      id: 'proj-1',
      subtitles: [], // Empty
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    currentClipSignal.set({
      id: 'gap-1',
      hasSubtitle: false,
      sourceSubtitles: []
    } as any);
    spectator.flushEffects();

    tick(300);

    // No warning because the old clip does not exist in the project anymore
    expect(toastService.warn).not.toHaveBeenCalled();
  }));

  it('does NOT show multiple warnings when the currentClip signal updates multiple times while in a gap', fakeAsync(() => {
    // Setup Project State with a note
    projectSignal.set({
      id: 'proj-1',
      subtitles: [{id: 'sub-1', type: 'srt', startTime: 10, endTime: 20, text: 'A', track: 0}],
      notes: {'sub-1': {manualNote: 'Test note'}},
      ankiExportHistory: []
    } as any);

    // Enter clip 1
    currentClipSignal.set({
      id: 'clip-1',
      hasSubtitle: true,
      sourceSubtitles: [{id: 'sub-1'}]
    } as any);
    spectator.flushEffects();

    // Leave clip 1 (enter gap)
    currentClipSignal.set({
      id: 'gap-1',
      hasSubtitle: false,
      sourceSubtitles: []
    } as any);
    spectator.flushEffects();

    // Wait for the first warning to trigger
    tick(300);
    expect(toastService.warn).toHaveBeenCalledTimes(1);

    // Simulate the currentClip signal updating again while still in the gap
    // (e.g. PlaybackManager updates clip references or transitions states)
    currentClipSignal.set({
      id: 'gap-1', // Same gap, but new object reference / signal emission
      hasSubtitle: false,
      sourceSubtitles: []
    } as any);
    spectator.flushEffects();

    // Wait to see if a second warning triggers
    tick(300);

    // It should STILL only be called once
    expect(toastService.warn).toHaveBeenCalledTimes(1);
  }));
});
