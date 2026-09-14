/** Source position of a token or node, 1-based like Notion's `[line, column]` hint. */
export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export class FormulaError extends Error {
  readonly position?: SourcePosition;

  constructor(message: string, position?: SourcePosition) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }

  /** "Unknown function foo. [1,4]" */
  get displayMessage(): string {
    return this.position ? `${this.message} [${this.position.line},${this.position.column}]` : this.message;
  }
}

export function isFormulaError(error: unknown): error is FormulaError {
  return error instanceof FormulaError;
}
