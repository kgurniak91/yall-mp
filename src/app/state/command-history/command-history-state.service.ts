import {computed, inject, Injectable, signal} from '@angular/core';
import {Command} from '../../model/commands/commands.types';
import {ToastService} from '../../shared/services/toast/toast.service';

export const MAX_HISTORY_SIZE = 100;

@Injectable()
export class CommandHistoryStateService {
  public canUndo = computed(() => this.undoStack().length > 0);
  public canRedo = computed(() => this.redoStack().length > 0);
  private readonly undoStack = signal<Command[]>([]);
  private readonly redoStack = signal<Command[]>([]);
  private isProcessing = false;
  private actionQueue: (() => void)[] = [];
  private readonly toastService = inject(ToastService);

  public execute(command: Command): void {
    // New user action arrived so it should clear any pending undo/redo actions and run immediately
    this.actionQueue = [];

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
    this.actionQueue.push(() => {
      const stack = this.undoStack();
      if (!stack?.length) {
        return;
      }

      const commandToUndo = stack[stack.length - 1];
      commandToUndo.undo();

      this.toastService.info(`Undone: ${commandToUndo.label}`);

      this.undoStack.set(stack.slice(0, -1));
      this.redoStack.update(redo => [commandToUndo, ...redo]);
    });

    this.processQueue();
  }

  public redo(): void {
    this.actionQueue.push(() => {
      const stack = this.redoStack();
      if (!stack?.length) {
        return;
      }

      const commandToRedo = stack[0];
      commandToRedo.execute();

      this.toastService.info(`Redone: ${commandToRedo.label}`);

      this.redoStack.set(stack.slice(1));
      this.undoStack.update(undo => [...undo, commandToRedo]);
    });

    this.processQueue();
  }

  public cancelLastUndo(): void {
    const redoStack = this.redoStack();
    if (redoStack.length === 0) {
      return;
    }

    // Move the command that was just moved to redo stack back to the undo stack
    const command = redoStack[0];
    this.redoStack.set(redoStack.slice(1));
    this.undoStack.update(undo => [...undo, command]);
  }

  private processQueue(): void {
    if (this.isProcessing) {
      return; // A command is already running, wait for it to finish
    }

    const nextAction = this.actionQueue.shift();

    if (nextAction) {
      this.isProcessing = true;
      try {
        nextAction();
      } finally {
        this.isProcessing = false;
        // After finishing, immediately try to process the next item
        this.processQueue();
      }
    }
  }

  public clearHistory(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.actionQueue = [];
  }
}
