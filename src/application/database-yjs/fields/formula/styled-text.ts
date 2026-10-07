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
const styleOrder = new Map<string, number>(STYLES.map((style, index) => [style, index]));
const foreground = new Set<string>(COLORS);

/** Canonical order makes equivalent adjacent spans cheap to merge. */
function normalizeStyles(names: readonly string[]): FormulaTextStyle[] {
  const styles = new Set<FormulaTextStyle>();
  let color: FormulaTextStyle | undefined;
  let background: FormulaTextStyle | undefined;

  for (const name of names) {
    if (!styleOrder.has(name)) continue;
    const style = name as FormulaTextStyle;

    if (foreground.has(style)) color = style;
    else if (style.endsWith('_background')) background = style;
    else styles.add(style);
  }

  if (color) styles.add(color);
  if (background) styles.add(background);
  return [...styles].sort((a, b) => styleOrder.get(a)! - styleOrder.get(b)!);
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
export function styleText(value: FormulaTextValue, names: readonly string[]): FormulaTextValue {
  const additions = normalizeStyles(names);

  if (!additions.length) return value;
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
  const work = (value: FormulaTextValue) => value.value.length + (value.runs?.length ?? 0);

  consumeWork?.(values.reduce((total, value) => total + work(value), separatorCount * work(separator)));
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
  consumeWork((value.value.length + (value.runs?.length ?? 0)) * count);
  if (!value.runs) return text(value.value.repeat(count));

  function* runs(): Iterable<FormulaTextRun> {
    for (let index = 0; index < count; index += 1) yield* runsOf(value);
  }

  return fromRuns(runs());
}
