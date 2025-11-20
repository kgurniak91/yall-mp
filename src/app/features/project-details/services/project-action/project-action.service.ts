import {DestroyRef, inject, Injectable} from '@angular/core';
import {VideoStateService} from '../../../../state/video/video-state.service';
import {KeyboardAction, SeekDirection} from '../../../../model/video.types';
import {ClipsStateService} from '../../../../state/clips/clips-state.service';
import {CommandHistoryStateService} from '../../../../state/command-history/command-history-state.service';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {filter, Subject, throttleTime} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {
  KeyboardShortcutsHelperService
} from '../../../../core/services/keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {ActionType} from '../../../../model/keyboard-shortcuts.types';
import {FileOpenIntentService} from '../../../../core/services/file-open-intent/file-open-intent.service';

@Injectable()
export class ProjectActionService {
  private videoStateService = inject(VideoStateService);
  private clipsStateService = inject(ClipsStateService);
  private globalSettingsStateService = inject(GlobalSettingsStateService);
  private projectSettingsStateService = inject(ProjectSettingsStateService);
  private commandHistoryStateService = inject(CommandHistoryStateService);
  private keyboardShortcutsHelperService = inject(KeyboardShortcutsHelperService);
  private fileOpenIntentService = inject(FileOpenIntentService);
  private action$ = new Subject<KeyboardAction>();
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Instant actions with no throttling
    this.action$.pipe(
      filter(action => this.keyboardShortcutsHelperService.getActionType(action) === ActionType.Instant),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(action => this.executeAction(action));

    // Handle Single-Shot Actions (UI clicks or Keyboard presses)
    // throttleTime(250ms) ensures that rapid clicking on UI buttons doesn't spam.
    // leading: true executes immediately. trailing: false ignores subsequent triggers within 250ms.
    this.action$.pipe(
      filter(action => this.keyboardShortcutsHelperService.getActionType(action) === ActionType.SingleShot),
      throttleTime(250, undefined, {leading: true, trailing: false}),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(action => this.executeAction(action));

    // Handle Continuous Actions (UI clicks or OS Keyboard repeats)
    // throttleTime(150ms) regulates the speed of seeking/adjusting.
    // leading: true executes immediately. trailing: true ensures the final inputs aren't lost.
    this.action$.pipe(
      filter(action => this.keyboardShortcutsHelperService.getActionType(action) === ActionType.Continuous),
      throttleTime(150, undefined, {leading: true, trailing: true}),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(action => this.executeAction(action));
  }

  public dispatch(action: KeyboardAction): void {
    this.action$.next(action);
  }

  private executeAction(action: KeyboardAction): void {
    if (action.startsWith('SwitchToTrack')) {
      const trackNumber = parseInt(action.replace('SwitchToTrack', ''), 10);
      if (!isNaN(trackNumber) && trackNumber >= 1 && trackNumber <= 9) {
        this.clipsStateService.setActiveTrack(trackNumber - 1); // track index is 0-based
        return; // Action is handled, exit the function
      }
    }

    switch (action) {
      case KeyboardAction.ToggleSubtitles:
        this.videoStateService.toggleSubtitlesVisible();
        break;
      case KeyboardAction.SeekBackward:
        this.videoStateService.seekRelative(-this.globalSettingsStateService.seekAmountSeconds());
        break;
      case KeyboardAction.SeekForward:
        this.videoStateService.seekRelative(this.globalSettingsStateService.seekAmountSeconds());
        break;
      case KeyboardAction.PreviousSubtitledClip:
        this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Previous);
        break;
      case KeyboardAction.NextSubtitledClip:
        this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Next);
        break;
      case KeyboardAction.RepeatCurrentClip:
        this.videoStateService.repeatCurrentClip();
        break;
      case KeyboardAction.ForceContinue:
        this.videoStateService.forceContinue();
        break;
      case KeyboardAction.TogglePlayPause:
        this.videoStateService.togglePlayPause();
        break;
      case KeyboardAction.AdjustClipStartLeft:
        this.clipsStateService.adjustCurrentClipBoundary('start', 'left');
        break;
      case KeyboardAction.AdjustClipStartRight:
        this.clipsStateService.adjustCurrentClipBoundary('start', 'right');
        break;
      case KeyboardAction.AdjustClipEndLeft:
        this.clipsStateService.adjustCurrentClipBoundary('end', 'left');
        break;
      case KeyboardAction.AdjustClipEndRight:
        this.clipsStateService.adjustCurrentClipBoundary('end', 'right');
        break;
      case KeyboardAction.ToggleSettings:
        this.projectSettingsStateService.setSettingsDrawerOpen(!this.projectSettingsStateService.isSettingsDrawerOpen());
        break;
      case KeyboardAction.EditCurrentSubtitles:
        this.videoStateService.requestEditSubtitles();
        break;
      case KeyboardAction.Undo:
        this.commandHistoryStateService.undo();
        break;
      case KeyboardAction.Redo:
        this.commandHistoryStateService.redo();
        break;
      case KeyboardAction.SplitClip:
        this.clipsStateService.splitCurrentSubtitledClip();
        break;
      case KeyboardAction.DeleteClip:
        this.clipsStateService.deleteCurrentClip();
        break;
      case KeyboardAction.CreateClip:
        this.clipsStateService.createNewSubtitledClipAtCurrentTime();
        break;
      case KeyboardAction.ExportToAnki:
        this.videoStateService.requestAnkiExport();
        break;
      case KeyboardAction.ZoomIn:
        this.videoStateService.requestZoomIn();
        break;
      case KeyboardAction.ZoomOut:
        this.videoStateService.requestZoomOut();
        break;
      case KeyboardAction.NextMediaFile:
        const nextMediaFilePath = this.videoStateService.nextMediaPath();
        if (nextMediaFilePath) {
          this.fileOpenIntentService.openMedia(nextMediaFilePath);
        }
        break;
      case KeyboardAction.PreviousMediaFile:
        const prevMediaFilePath = this.videoStateService.prevMediaPath();
        if (prevMediaFilePath) {
          this.fileOpenIntentService.openMedia(prevMediaFilePath);
        }
        break;
    }
  }
}
