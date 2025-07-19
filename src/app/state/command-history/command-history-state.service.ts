import {computed, Injectable, signal} from '@angular/core';
import {Command} from '../../model/commands/commands.types';

const MAX_HISTORY_SIZE = 100;

@Injectable()
export class CommandHistoryStateService {
  private readonly undoStack = signal<Command[]>([]);
  private readonly redoStack = signal<Command[]>([]);

  public canUndo = computed(() => this.undoStack().length > 0);
  public canRedo = computed(() => this.redoStack().length > 0);

  public execute(command: Command): void {
    command.execute();

    this.undoStack.update(stack => {
      const newStack = [...stack, command];
      if (newStack.length > MAX_HISTORY_SIZE) {
        return newStack.slice(1);
      }
      return newStack;
    });

    this.redoStack.set([]); // New action clears the redo stack
  }

  public undo(): void {
    const stack = this.undoStack();
    if (!stack?.length) {
      return;
    }

    const commandToUndo = stack[stack.length - 1];
    commandToUndo.undo();

    this.undoStack.set(stack.slice(0, -1));
    this.redoStack.update(redo => [commandToUndo, ...redo]);
  }

  public redo(): void {
    const stack = this.redoStack();
    if (!stack?.length) {
      return;
    }

    const commandToRedo = stack[0];
    commandToRedo.execute();

    this.redoStack.set(stack.slice(1));
    this.undoStack.update(undo => [...undo, commandToRedo]);
  }

  public clearHistory(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
  }
}
