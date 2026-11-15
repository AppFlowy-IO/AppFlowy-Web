import { Circle, CircleCheck } from 'lucide-react';

import { ReactComponent as RadioSelectedIcon } from '@/assets/icons/form/radio-selected.svg';
import { ReactComponent as RadioUnselectedIcon } from '@/assets/icons/form/radio-unselected.svg';
import { PublicQuestion } from '@/application/types/form';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
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
  desktopPreview?: boolean;
  mode: 'single';
  value: string | null;
  onChange: (option_id: string | null) => void;
};

type MultiProps = {
  question: PublicQuestion;
  desktopPreview?: boolean;
  mode: 'multi';
  value: string[];
  onChange: (option_ids: string[]) => void;
};

export function FormSelectInput(props: SingleProps | MultiProps) {
  const { question } = props;
  const options = question.options ?? [];

  const isSelected = (id: string) => (props.mode === 'single' ? props.value === id : props.value.includes(id));

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
      if (question.max_selections && question.max_selections > 0 && set.size >= question.max_selections) {
        return;
      }

      set.add(id);
    }

    props.onChange(Array.from(set));
  };

  // Notion-style respondent picker — indicator on the left, plain label
  // on the right. Single-select uses radio circles (only one can be
  // on), multi-select uses square checkboxes. Replaces the prior
  // bordered-button-with-fill variant, which read more like a button
  // group than a form picker (image #19 in the design spec).
  const isMulti = props.mode === 'multi';

  return (
    <div className={props.desktopPreview ? 'flex flex-col gap-2' : 'flex flex-col gap-1'}>
      {options.map((opt) => {
        const selected = isSelected(opt.id);

        return (
          <button
            key={opt.id}
            type='button'
            onClick={() => handleToggle(opt.id)}
            aria-pressed={selected}
            className={
              props.desktopPreview
                ? 'flex min-h-6 items-center gap-1 rounded py-0.5 text-left text-sm leading-5'
                : 'flex items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors hover:bg-fill-content'
            }
          >
            {isMulti ? (
              selected ? (
                <CheckboxCheckSvg className='h-5 w-5 shrink-0 text-text-action' />
              ) : (
                <CheckboxUncheckSvg className='h-5 w-5 shrink-0 text-border-primary hover:text-border-primary-hover' />
              )
            ) : props.desktopPreview ? (
              selected ? (
                <RadioSelectedIcon className='h-5 w-5 shrink-0 text-fill-theme-thick' />
              ) : (
                <RadioUnselectedIcon className='h-5 w-5 shrink-0 text-border-primary [&_path]:stroke-current' />
              )
            ) : (
              (() => {
                const Indicator = selected ? CircleCheck : Circle;

                return (
                  <Indicator
                    size={18}
                    className={cn('shrink-0', selected ? 'text-fill-default' : 'text-text-tertiary')}
                    strokeWidth={selected ? 2.5 : 2}
                  />
                );
              })()
            )}
            <span>{opt.label}</span>
          </button>
        );
      })}
      {options.length === 0 && <p className='text-sm text-text-caption'>No options available.</p>}
    </div>
  );
}
