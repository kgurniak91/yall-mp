export interface Command {
  readonly label: string;
  execute(): void;
  undo(): void;
}
