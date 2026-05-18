import { Check } from 'lucide-react';

import { PublicQuestion } from '@/application/types/form';
import { cn } from '@/lib/utils';

/**
 * Single- and multi-select questions. Renders the options as a vertical
 * list of pill-style buttons; selected options pick up the fill color
 * (and a check for multi-select, mirroring Notion).
 *
 * Discriminated by `mode` so TypeScript narrows the `value` and
 * `onChange` signatures — single returns `string | null`, multi returns
 * `string[]`.
 */
type SingleProps = {
  question: PublicQuestion;
  mode: 'single';
  value: string | null;
  onChange: (option_id: string | null) => void;
};

type MultiProps = {
  question: PublicQuestion;
  mode: 'multi';
  value: string[];
  onChange: (option_ids: string[]) => void;
};

export function FormSelectInput(props: SingleProps | MultiProps) {
  const { question } = props;
  const options = question.options ?? [];

  const isSelected = (id: string) =>
    props.mode === 'single' ? props.value === id : props.value.includes(id);

  const handleToggle = (id: string) => {
    if (props.mode === 'single') {
      // Single-select: tap-the-selected = clear, matching most form UIs.
      props.onChange(props.value === id ? null : id);
      return;
    }

    const set = new Set(props.value);

    if (set.has(id)) {
      set.delete(id);
    } else {
      // Honor `max_selections` (Notion's "Respondents can select up to N").
      // 0/undefined = unlimited.
      if (
        question.max_selections &&
        question.max_selections > 0 &&
        set.size >= question.max_selections
      ) {
        return;
      }

      set.add(id);
    }

    props.onChange(Array.from(set));
  };

  return (
    <div className='flex flex-col gap-1.5'>
      {options.map((opt) => {
        const selected = isSelected(opt.id);

        return (
          <button
            key={opt.id}
            type='button'
            onClick={() => handleToggle(opt.id)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
              selected
                ? 'border-fill-default bg-fill-default/10'
                : 'border-line-divider hover:border-fill-default',
            )}
          >
            <span>{opt.label}</span>
            {selected && (
              <Check size={14} className='text-fill-default' strokeWidth={3} />
            )}
          </button>
        );
      })}
      {options.length === 0 && (
        <p className='text-sm text-text-caption'>No options available.</p>
      )}
    </div>
  );
}
