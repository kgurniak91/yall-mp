import {computed, Injectable, signal} from '@angular/core';
import {CommandHistoryStateService} from '../../../state/command-history/command-history-state.service';

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
  public readonly canUndo = computed(() => this._commandHistory()?.canUndo() ?? false);
  public readonly canRedo = computed(() => this._commandHistory()?.canRedo() ?? false);

  public register(commandHistoryService: CommandHistoryStateService): void {
    this._commandHistory.set(commandHistoryService);
  }

  public clear(): void {
    this._commandHistory.set(null);
  }

  public undo(): void {
    this._commandHistory()?.undo();
  }

  public redo(): void {
    this._commandHistory()?.redo();
  }
}
