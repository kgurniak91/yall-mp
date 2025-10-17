import {DestroyRef, inject, Injectable} from '@angular/core';
import {VideoStateService} from '../../../../state/video/video-state.service';
import {KeyboardAction, SeekDirection} from '../../../../model/video.types';
import {ClipsStateService} from '../../../../state/clips/clips-state.service';
import {CommandHistoryStateService} from '../../../../state/command-history/command-history-state.service';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {filter, Subject, throttleTime} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {CONTINUOUS_ACTIONS, SINGLE_SHOT_ACTIONS} from './project-action.types';

@Injectable()
export class ProjectActionService {
  private videoStateService = inject(VideoStateService);
  private clipsStateService = inject(ClipsStateService);
  private globalSettingsStateService = inject(GlobalSettingsStateService);
  private commandHistoryStateService = inject(CommandHistoryStateService);
  private action$ = new Subject<KeyboardAction>();
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Handle Single-Shot Actions (UI clicks or Keyboard presses)
    // throttleTime(250ms) ensures that rapid clicking on UI buttons doesn't spam.
    // leading: true executes immediately. trailing: false ignores subsequent triggers within 250ms.
    this.action$.pipe(
      filter(action => SINGLE_SHOT_ACTIONS.has(action)),
      throttleTime(250, undefined, {leading: true, trailing: false}),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(action => this.executeAction(action));

    // Handle Continuous Actions (UI clicks or OS Keyboard repeats)
    // throttleTime(150ms) regulates the speed of seeking/adjusting.
    // leading: true executes immediately. trailing: true ensures the final inputs aren't lost.
    this.action$.pipe(
      filter(action => CONTINUOUS_ACTIONS.has(action)),
      throttleTime(150, undefined, {leading: true, trailing: true}),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(action => this.executeAction(action));
  }

  public dispatch(action: KeyboardAction): void {
    this.action$.next(action);
  }

  private executeAction(action: KeyboardAction): void {
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
        this.videoStateService.toggleSettings();
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
    }
  }
}
