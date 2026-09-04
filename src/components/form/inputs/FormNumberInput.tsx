import { useState } from 'react';

import { Input } from '@/components/ui/input';

interface NumberDraft {
  text: string;
  /** Controlled value represented by `text`, including JavaScript's `-0`. */
  value: number | null;
}

/**
 * Numeric input. Empty string ⇄ `null` so the answer-map distinguishes
 * "not answered" from "0" (important for required-field validation and
 * for the server's typed `Number` cell — a NULL is missing, a 0 is a
 * deliberate zero).
 */
export function FormNumberInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  // Local string state lets the user type intermediate values like "-",
  // "1.", or "-0." that don't yet parse to a finite number, without the
  // controlled prop snapping them away on each keystroke.
  const [draft, setDraft] = useState<NumberDraft>(() => ({
    text: formatNumber(value),
    value,
  }));

  // A local draft remembers the numeric value it emitted. The controlled
  // echo therefore leaves spelling such as "-0" and "1." intact, while a
  // genuinely different prop still resets the field in the same render.
  // Object.is is intentional: unlike ===, it distinguishes -0 from +0.
  if (!Object.is(value, draft.value)) {
    setDraft({ text: formatNumber(value), value });
  }

  return (
    <Input
      className='w-full'
      type='text'
      inputMode='decimal'
      value={draft.text}
      onChange={(e) => {
        const raw = e.target.value;

        // Allow only digits, one optional leading minus, and one dot.
        if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;

        const nextValue = parseNumberDraft(raw);

        setDraft({ text: raw, value: nextValue });
        onChange(nextValue);
      }}
      placeholder="Respondent's answer"
    />
  );
}

function parseNumberDraft(raw: string): number | null {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return null;

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null): string {
  if (value === null) return '';
  if (Object.is(value, -0)) return '-0';
  return String(value);
}
