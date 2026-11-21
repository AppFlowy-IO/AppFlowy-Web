export type Item = { id: string; name: string };
export function Select({
  label,
  value,
  options,
  change,
  multiple = false,
}: {
  label: string;
  value: string | string[];
  options: Item[];
  change: (ids: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <label className='flex flex-col gap-1 text-sm'>
      {label}
      <select
        aria-label={label}
        multiple={multiple}
        className='rounded-300 border border-border-primary bg-surface-primary px-2 py-1'
        value={value}
        onChange={(e) => change(Array.from(e.currentTarget.selectedOptions, (x) => x.value))}
      >
        {!multiple && <option value=''>—</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
