import {computed, Injectable, signal} from '@angular/core';
import {CommandHistoryStateService} from '../../../state/command-history/command-history-state.service';
import {ProjectActionService} from '../../../features/project-details/services/project-action/project-action.service';
import {KeyboardAction} from '../../../model/video.types';

/**
 * Allows a component-scoped service (like CommandHistoryStateService)
 * to register itself when its component is active, and clear itself when destroyed.
 * This lets global components (like the Header) interact with the currently active project details service.
 */
@Injectable({
  providedIn: 'root'
})
export class HeaderCurrentProjectActionBridgeService {
  private readonly _commandHistory = signal<CommandHistoryStateService | null>(null);
  private readonly _projectActionService = signal<ProjectActionService | null>(null);
  private readonly _canGoToNextMedia = signal(false);
  private readonly _canGoToPrevMedia = signal(false);
  private _openOffsetDialogCallback: (() => void) | null = null;

  public readonly canUndo = computed(() => this._commandHistory()?.canUndo() ?? false);
  public readonly canRedo = computed(() => this._commandHistory()?.canRedo() ?? false);
  public readonly canGoToNextMedia = this._canGoToNextMedia.asReadonly();
  public readonly canGoToPrevMedia = this._canGoToPrevMedia.asReadonly();

  public register(
    commandHistoryService: CommandHistoryStateService,
    projectActionService: ProjectActionService
  ): void {
    this._commandHistory.set(commandHistoryService);
    this._projectActionService.set(projectActionService);
  }

  public updateMediaNavigationState(canGoNext: boolean, canGoPrev: boolean): void {
    this._canGoToNextMedia.set(canGoNext);
    this._canGoToPrevMedia.set(canGoPrev);
  }

  public clear(): void {
    this._commandHistory.set(null);
    this._projectActionService.set(null);
    this._canGoToNextMedia.set(false);
    this._canGoToPrevMedia.set(false);
    this._openOffsetDialogCallback = null;
  }

  public undo(): void {
    this._commandHistory()?.undo();
  }

  public redo(): void {
    this._commandHistory()?.redo();
  }

  public openDictionary(): void {
    this._projectActionService()?.dispatch(KeyboardAction.OpenDictionary);
  }

  public searchInSubtitles(): void {
    this._projectActionService()?.dispatch(KeyboardAction.FindInSubtitles);
  }

  public registerOffsetDialogOpener(fn: () => void): void {
    this._openOffsetDialogCallback = fn;
  }

  public openSubtitleOffsetDialog(): void {
    this._openOffsetDialogCallback?.();
  }

  public goToNextMediaFile(): void {
    this._projectActionService()?.dispatch(KeyboardAction.NextMediaFile);
  }

  public goToPreviousMediaFile(): void {
    this._projectActionService()?.dispatch(KeyboardAction.PreviousMediaFile);
  }
}
