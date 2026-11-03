import { useTranslation } from 'react-i18next';

import { ChartNumberColor, NUMBER_COLOR_NAMES } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

import { numberColorVar } from '../../widgets/numberChartUtils';

const COLOR_FALLBACKS: Record<ChartNumberColor, string> = {
  default: 'Default',
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
};

/** The translated name of a Number card color; an unknown name reads as Default. */
export function useNumberColorLabel() {
  const { t } = useTranslation();

  return (name: string) => {
    const color = (NUMBER_COLOR_NAMES as readonly string[]).includes(name) ? (name as ChartNumberColor) : 'default';

    return t(`chart.numberColor.${color}`, { defaultValue: COLOR_FALLBACKS[color] });
  };
}

export interface NumberColorChipsProps {
  selected: string | null;
  /** Chips get `${testIdPrefix}-${name}` as their test id. */
  testIdPrefix: string;
  onSelect: (color: ChartNumberColor) => void;
}

/**
 * The 2×5 grid of Number card colors (WP11 §1.12): a 32×32 chip per color
 * with an "A" in it, in Notion's order; the selected chip has a 2px border.
 */
export function NumberColorChips({ selected, testIdPrefix, onSelect }: NumberColorChipsProps) {
  const label = useNumberColorLabel();

  return (
    <div role='radiogroup' className='grid grid-cols-5 gap-2 px-2 py-1'>
      {NUMBER_COLOR_NAMES.map((name) => {
        const isSelected = selected === name;

        return (
          <button
            key={name}
            type='button'
            role='radio'
            aria-checked={isSelected}
            aria-label={label(name)}
            title={label(name)}
            data-testid={`${testIdPrefix}-${name}`}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-[6px] bg-surface-primary text-base font-semibold outline-none',
              isSelected ? 'border-2 border-text-primary' : 'border border-border-primary hover:bg-dash-hover-fill',
              'focus-visible:ring-2 focus-visible:ring-border-theme-thick'
            )}
            style={{ color: numberColorVar(name) }}
            onClick={() => onSelect(name)}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

export default NumberColorChips;
