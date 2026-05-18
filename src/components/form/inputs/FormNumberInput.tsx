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
  return (
    <Input
      type='number'
      inputMode='decimal'
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;

        if (raw === '') {
          onChange(null);
          return;
        }

        const parsed = Number(raw);

        // Surface NaN as null rather than poisoning the answer map. The
        // <input type="number"> blocks most non-numeric entry, but paste
        // of "abc" can still reach onChange in some browsers.
        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
      placeholder="Respondent's answer"
    />
  );
}
