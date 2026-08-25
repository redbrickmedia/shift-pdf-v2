export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
}

export class BoundedHistory<T> {
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];

  constructor(
    private readonly clone: (state: T) => T,
    private readonly limit = 20
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('History limit must be a positive integer.');
    }
  }

  get status(): HistoryStatus {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  snapshot(state: T): void {
    this.undoStack.push(this.clone(state));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(current: T): T | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;

    this.redoStack.push(this.clone(current));
    return this.clone(previous);
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (!next) return null;

    this.undoStack.push(this.clone(current));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    return this.clone(next);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
