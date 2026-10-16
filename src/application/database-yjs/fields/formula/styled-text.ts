import { FormulaTextColor, FormulaTextRun, FormulaTextStyle, FormulaTextValue, text } from './values';

const COLORS: FormulaTextColor[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const STYLES: FormulaTextStyle[] = [
  'b',
  'i',
  'u',
  's',
  'c',
  ...COLORS,
  ...COLORS.map((color): FormulaTextStyle => `${color}_background`),
];
const supportedStyles = new Set<string>(STYLES);
const foreground = new Set<string>(COLORS);

/** Desktop sorts tokens lexically; equivalent adjacent spans can then merge. */
function normalizeStyles(names: readonly string[]): FormulaTextStyle[] {
  const styles = new Set<FormulaTextStyle>();
  let color: FormulaTextStyle | undefined;
  let background: FormulaTextStyle | undefined;

  for (const name of names) {
    if (!supportedStyles.has(name)) continue;
    const style = name as FormulaTextStyle;

    if (foreground.has(style)) color = style;
    else if (style.endsWith('_background')) background = style;
    else styles.add(style);
  }

  if (color) styles.add(color);
  if (background) styles.add(background);
  return [...styles].sort();
}

/** Include copied attributes as well as text and run slots in the work budget. */
export function textWork(value: FormulaTextValue): number {
  return value.value.length + (value.runs?.reduce((total, run) => total + 1 + run.styles.length, 0) ?? 0);
}

function runsOf(value: FormulaTextValue): FormulaTextRun[] {
  return value.runs ?? [{ text: value.value, styles: [] }];
}

/** Merge runs once, without repeatedly copying a growing string. */
function fromRuns(runs: Iterable<FormulaTextRun>): FormulaTextValue {
  const groups: Array<{ parts: string[]; styles: FormulaTextStyle[] }> = [];

  for (const run of runs) {
    if (!run.text) continue;
    const previous = groups[groups.length - 1];

    if (
      previous &&
      previous.styles.length === run.styles.length &&
      previous.styles.every((s, i) => s === run.styles[i])
    ) {
      previous.parts.push(run.text);
    } else {
      groups.push({ parts: [run.text], styles: [...run.styles] });
    }
  }

  const normalized = groups.map(({ parts, styles }) => ({ text: parts.join(''), styles }));
  const value = normalized.map((run) => run.text).join('');

  return normalized.some((run) => run.styles.length) ? { type: 'text', value, runs: normalized } : text(value);
}

/** Apply only recognized tokens; arbitrary formula text never becomes CSS. */
export function styleText(
  value: FormulaTextValue,
  names: readonly string[],
  consumeWork?: (amount: number) => void
): FormulaTextValue {
  const additions = normalizeStyles(names);

  if (!additions.length) return value;
  // Recoloring can coalesce thousands of runs. Reserve the temporary attribute
  // expansion before mapping them; charging only the final value misses it.
  consumeWork?.(additions.length * (value.runs?.length ?? (value.value ? 1 : 0)));
  return fromRuns(
    runsOf(value).map((run) => ({ text: run.text, styles: normalizeStyles([...run.styles, ...additions]) }))
  );
}

export function unstyleText(value: FormulaTextValue, names: readonly string[]): FormulaTextValue {
  if (!value.runs || names.length === 0) return text(value.value);
  const removed = new Set(names);

  return fromRuns(
    value.runs.map((run) => ({ text: run.text, styles: run.styles.filter((style) => !removed.has(style)) }))
  );
}

/** Bound output text and span copies before allocating a joined result. */
export function joinText(
  values: readonly FormulaTextValue[],
  separator: FormulaTextValue = text(''),
  consumeWork?: (amount: number) => void
): FormulaTextValue {
  const separatorCount = Math.max(0, values.length - 1);

  consumeWork?.(values.reduce((total, value) => total + textWork(value), separatorCount * textWork(separator)));
  if (!separator.runs && values.every((value) => !value.runs)) {
    return text(values.map((value) => value.value).join(separator.value));
  }

  function* runs(): Iterable<FormulaTextRun> {
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0) yield* runsOf(separator);
      yield* runsOf(values[index]);
    }
  }

  return fromRuns(runs());
}

export function repeatText(
  value: FormulaTextValue,
  count: number,
  consumeWork: (amount: number) => void
): FormulaTextValue {
  consumeWork(textWork(value) * count);
  if (!value.runs) return text(value.value.repeat(count));

  function* runs(): Iterable<FormulaTextRun> {
    for (let index = 0; index < count; index += 1) yield* runsOf(value);
  }

  return fromRuns(runs());
}
