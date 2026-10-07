import { CSSProperties } from 'react';

import { FormulaTextRun } from '@/application/database-yjs/fields/formula';

// Reuse the editor's theme palettes so named formula colors adapt to dark mode.
const COLOR_PALETTE: Record<string, number> = {
  gray: 19,
  brown: 2,
  orange: 3,
  yellow: 5,
  green: 9,
  blue: 12,
  purple: 15,
  pink: 18,
  red: 1,
};

function runStyle(run: FormulaTextRun): CSSProperties {
  const style: CSSProperties = {};
  const decorations: string[] = [];

  for (const token of run.styles) {
    switch (token) {
      case 'b':
        style.fontWeight = 'bold';
        break;
      case 'i':
        style.fontStyle = 'italic';
        break;
      case 'u':
        decorations.push('underline');
        break;
      case 's':
        decorations.push('line-through');
        break;
      default: {
        const background = token.endsWith('_background');
        const color = background ? token.slice(0, -'_background'.length) : token;
        const palette = COLOR_PALETTE[color];

        if (palette === undefined) break;
        if (background) style.backgroundColor = `var(--palette-bg-color-${palette})`;
        else style.color = `var(--palette-text-color-${palette})`;
      }
    }
  }

  if (decorations.length > 0) style.textDecorationLine = decorations.join(' ');
  return style;
}

/** Cells and draft previews paint the same inline runs, without an editor per result. */
export function FormulaTextContent({ text, runs }: { text: string; runs?: FormulaTextRun[] }) {
  if (!runs?.length) return <>{text}</>;

  // One inline container keeps a cell's flex gap from inserting spaces between runs.
  return (
    <span>
      {runs.map((run, index) => (
        <span
          key={index}
          style={runStyle(run)}
          className={run.styles.includes('c') ? 'rounded-100 bg-fill-secondary font-mono' : undefined}
        >
          {run.text}
        </span>
      ))}
    </span>
  );
}
