import { FormulaError, SourcePosition } from './errors';
import { FormulaValue } from './values';

/** Browser evaluations run on the UI thread, so use a smaller limit than desktop. */
export const FORMULA_MAX_EVALUATION_WORK = 100_000;
export const FORMULA_MAX_REGEX_WORK = 50_000_000;

/** Shared by all expressions and referenced formula fields in one cell evaluation. */
export class FormulaEvaluationBudget {
  private remaining = FORMULA_MAX_EVALUATION_WORK;
  private remainingRegex = FORMULA_MAX_REGEX_WORK;

  consume(amount: number, position: SourcePosition) {
    this.remaining -= amount;
    if (this.remaining < 0) throw new FormulaError('Formula evaluation exceeded the work limit', position);
  }

  consumeRegex(amount: number, position: SourcePosition) {
    this.remainingRegex -= amount;
    if (this.remainingRegex < 0) throw new FormulaError('The regular expression is too complex', position);
  }

  /** Bound native list operations and recursive formatting before they run. */
  consumeValue(value: FormulaValue, position: SourcePosition): number {
    const textLength = value.type === 'text' ? value.value.length : 0;

    this.consume(Math.max(1, textLength), position);
    if (value.type === 'list') {
      let length = Math.max(0, value.items.length - 1) * 2;

      for (const item of value.items) length += this.consumeValue(item, position);
      this.consume(length, position);
      return length;
    }

    return textLength;
  }
}
