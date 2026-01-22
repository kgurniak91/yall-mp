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
  public readonly canUndo = computed(() => this._commandHistory()?.canUndo() ?? false);
  public readonly canRedo = computed(() => this._commandHistory()?.canRedo() ?? false);

  public register(
    commandHistoryService: CommandHistoryStateService,
    projectActionService: ProjectActionService
  ): void {
    this._commandHistory.set(commandHistoryService);
    this._projectActionService.set(projectActionService);
  }

  public clear(): void {
    this._commandHistory.set(null);
    this._projectActionService.set(null);
  }

  public undo(): void {
    this._commandHistory()?.undo();
  }

  public redo(): void {
    this._commandHistory()?.redo();
  }

  public searchInSubtitles(): void {
    this._projectActionService()?.dispatch(KeyboardAction.FindInSubtitles);
  }
}
