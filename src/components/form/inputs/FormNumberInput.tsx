import { useState } from 'react';

import { Input } from '@/components/ui/input';

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
  const [text, setText] = useState<string>(value !== null ? String(value) : '');

  // Re-derive text whenever the controlled `value` prop changes externally
  // (e.g. "Submit another response" reset). Setting state during render is
  // React's documented escape hatch for cases where state-as-snapshot
  // genuinely needs to track a prop — cheaper than a useEffect because it
  // happens in the same commit, with no extra render.
  const [lastSyncedValue, setLastSyncedValue] = useState(value);

  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setText(value !== null ? String(value) : '');
  }

  return (
    <Input
      className='w-full'
      type='text'
      inputMode='decimal'
      value={text}
      onChange={(e) => {
        const raw = e.target.value;

        // Allow only digits, one optional leading minus, and one dot.
        if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;

        setText(raw);

        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          onChange(null);
          return;
        }

        const parsed = Number(raw);

        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
      placeholder="Respondent's answer"
    />
  );
}
