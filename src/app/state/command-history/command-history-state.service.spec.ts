import {createServiceFactory, SpectatorService} from '@ngneat/spectator';
import {CommandHistoryStateService, MAX_HISTORY_SIZE} from './command-history-state.service';
import {Command} from '../../model/commands/commands.types';

let testState: { counter: number };

class MockCommand implements Command {
  executeSpy = jasmine.createSpy('executeSpy').and.callFake(() => {
    testState.counter++;
  });

  undoSpy = jasmine.createSpy('undoSpy').and.callFake(() => {
    testState.counter--;
  });

  execute(): void {
    this.executeSpy();
  }

  undo(): void {
    this.undoSpy();
  }
}

describe('CommandHistoryStateService', () => {
  const createService = createServiceFactory(CommandHistoryStateService);
  let spectator: SpectatorService<CommandHistoryStateService>;
  let service: CommandHistoryStateService;

  beforeEach(() => {
    spectator = createService();
    service = spectator.service;
    testState = {counter: 0};
  });

  describe('Command Execution', () => {
    it('executes a command and makes it available for undo', () => {
      const command = new MockCommand();
      service.execute(command);

      expect(command.executeSpy).toHaveBeenCalledTimes(1);
      expect(testState.counter).toBe(1);
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    it('clears the redo stack when a new command is executed', () => {
      const command1 = new MockCommand();
      service.execute(command1);
      service.undo();
      expect(service.canRedo()).toBe(true);

      const command2 = new MockCommand();
      service.execute(command2);

      expect(testState.counter).toBe(1); // 0 (after undo) + 1 (from command2)
      expect(service.canRedo()).toBe(false);
    });

    it('respects the MAX_HISTORY_SIZE limit by dropping the oldest commands', () => {
      // Execute more commands than the history limit
      for (let i = 0; i < MAX_HISTORY_SIZE + 5; i++) {
        service.execute(new MockCommand());
      }
      expect(testState.counter).toBe(MAX_HISTORY_SIZE + 5);

      // Undo all possible commands
      for (let i = 0; i < MAX_HISTORY_SIZE; i++) {
        service.undo();
      }

      // Assert that only MAX_HISTORY_SIZE commands were undone
      expect(testState.counter).toBe(5); // 105 - 100 = 5

      // Assert that the undo stack is now empty
      expect(service.canUndo()).toBe(false);
    });
  });

  describe('Undo/Redo Functionality', () => {
    let command: MockCommand;

    beforeEach(() => {
      command = new MockCommand();
      service.execute(command); // counter is 1
    });

    it('undoes the last command', () => {
      service.undo();

      expect(command.undoSpy).toHaveBeenCalledTimes(1);
      expect(testState.counter).toBe(0);
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(true);
    });

    it('redoes the last undone command', () => {
      service.undo(); // counter is 0
      service.redo(); // counter is 1

      expect(command.executeSpy).toHaveBeenCalledTimes(2); // Once on execute, once on redo
      expect(testState.counter).toBe(1);
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    it('handles multiple undos and redos in the correct LIFO order', () => {
      const command2 = new MockCommand();
      service.execute(command2); // counter is 2

      // Undo twice (LIFO: command2 then command1)
      service.undo();
      expect(testState.counter).toBe(1);
      expect(command2.undoSpy).toHaveBeenCalledTimes(1);

      service.undo();
      expect(testState.counter).toBe(0);
      expect(command.undoSpy).toHaveBeenCalledTimes(1);
      expect(service.canUndo()).toBe(false);

      // Redo twice (LIFO: command1 then command2)
      service.redo();
      expect(testState.counter).toBe(1);
      expect(command.executeSpy).toHaveBeenCalledTimes(2);

      service.redo();
      expect(testState.counter).toBe(2);
      expect(command2.executeSpy).toHaveBeenCalledTimes(2);
      expect(service.canRedo()).toBe(false);
    });
  });

  describe('Command Queuing Logic', () => {
    let commands: MockCommand[];

    beforeEach(() => {
      commands = [new MockCommand(), new MockCommand(), new MockCommand()];
      commands.forEach(cmd => service.execute(cmd)); // counter is 3
      // Reset spies to only count subsequent calls
      commands.forEach(cmd => {
        cmd.executeSpy.calls.reset();
        cmd.undoSpy.calls.reset();
      });
    });

    it('executes multiple synchronous undo calls sequentially', () => {
      service.undo();
      service.undo();
      service.undo();

      expect(commands[2].undoSpy).toHaveBeenCalledTimes(1);
      expect(commands[1].undoSpy).toHaveBeenCalledTimes(1);
      expect(commands[0].undoSpy).toHaveBeenCalledTimes(1);
      expect(testState.counter).toBe(0);
    });

    it('executes multiple synchronous redo calls sequentially', () => {
      service.undo();
      service.undo();
      service.undo(); // counter is 0
      commands.forEach(cmd => cmd.executeSpy.calls.reset());

      service.redo();
      service.redo();
      service.redo();

      expect(commands[0].executeSpy).toHaveBeenCalledTimes(1);
      expect(commands[1].executeSpy).toHaveBeenCalledTimes(1);
      expect(commands[2].executeSpy).toHaveBeenCalledTimes(1);
      expect(testState.counter).toBe(3);
    });

    it('handles a mixed queue of undo and redo calls in the correct order', () => {
      // counter is 3. undoStack: [cmd0, cmd1, cmd2]
      service.undo(); // counter is 2. redoStack: [cmd2]

      // Call actions synchronously
      service.undo(); // counter becomes 1
      service.undo(); // counter becomes 0
      service.redo(); // counter becomes 1 (redoes cmd0)

      // The last undone command was cmd0, so it's the one that gets redone.
      expect(commands[0].executeSpy).toHaveBeenCalledTimes(1);

      // cmd2 was undone first, so it was not the last one and doesn't get redone here.
      expect(commands[2].executeSpy).not.toHaveBeenCalled();

      // Final state check: 3 -> undo(2) -> 2 -> undo(1) -> 1 -> undo(0) -> 0 -> redo(0) -> 1
      expect(testState.counter).toBe(1);
    });
  });

  describe('clearHistory', () => {
    it('clears both undo and redo stacks', () => {
      service.execute(new MockCommand());
      service.undo();
      expect(service.canRedo()).toBe(true);

      service.clearHistory();

      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(false);
    });
  });
});
