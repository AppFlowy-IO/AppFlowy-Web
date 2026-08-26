import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CalculationType } from '@/application/database-yjs/database.type';
import { RollupShowAsType, RollupVisualizationOption } from '@/application/database-yjs/fields/rollup/rollup.type';
import {
  isRollupPercentCalculation,
  MAX_ROLLUP_VISUALIZATION_DIVISOR,
} from '@/application/database-yjs/fields/rollup/visualization';
import { ColorTile, ColorTileIcon } from '@/components/_shared/color-picker/ColorTile';
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { getRollupVisualizationColor } from './visualization';

type Translation = (key: string, options?: { defaultValue: string }) => string;

const colorOptions = [
  { value: 'fill-default', labelKey: 'colors.default', label: 'Default' },
  { value: 'text-color-14', labelKey: 'colors.mauve', label: 'Mauve' },
  { value: 'text-color-15', labelKey: 'colors.lavender', label: 'Lavender' },
  { value: 'text-color-16', labelKey: 'colors.lilac', label: 'Lilac' },
  { value: 'text-color-17', labelKey: 'colors.mallow', label: 'Mallow' },
  { value: 'text-color-18', labelKey: 'colors.camellia', label: 'Camellia' },
  { value: 'text-color-1', labelKey: 'colors.rose', label: 'Rose' },
  { value: 'text-color-2', labelKey: 'colors.papaya', label: 'Papaya' },
  { value: 'text-color-4', labelKey: 'colors.mango', label: 'Mango' },
  { value: 'text-color-5', labelKey: 'colors.lemon', label: 'Lemon' },
  { value: 'text-color-6', labelKey: 'colors.olive', label: 'Olive' },
  { value: 'text-color-8', labelKey: 'colors.grass', label: 'Grass' },
  { value: 'text-color-10', labelKey: 'colors.jade', label: 'Jade' },
  { value: 'text-color-12', labelKey: 'colors.azure', label: 'Azure' },
  { value: 'text-color-20', labelKey: 'colors.iron', label: 'Iron' },
] as const;

function VisualizationPreview({ type }: { type: RollupShowAsType }) {
  switch (type) {
    case RollupShowAsType.Bar:
      return (
        <span className={'flex h-7 w-9 items-center'}>
          <span className={'h-1 w-full overflow-hidden rounded-full bg-fill-secondary'}>
            <span className={'block h-full w-2/3 rounded-full bg-current'} />
          </span>
        </span>
      );
    case RollupShowAsType.Ring:
      return (
        <span
          className={'h-5 w-5 rounded-full'}
          style={{ background: 'conic-gradient(currentColor 0 67%, var(--fill-secondary) 67% 100%)' }}
        >
          <span className={'m-[3px] block h-[14px] w-[14px] rounded-full bg-fill-content'} />
        </span>
      );
    default:
      return <span className={'text-base font-semibold'}>99</span>;
  }
}

function getVisualizationLabel(t: Translation, type: RollupShowAsType) {
  switch (type) {
    case RollupShowAsType.Bar:
      return t('grid.rollup.showAsBar', { defaultValue: 'Bar' });
    case RollupShowAsType.Ring:
      return t('grid.rollup.showAsRing', { defaultValue: 'Ring' });
    default:
      return t('grid.rollup.showAsNumber', { defaultValue: 'Number' });
  }
}

function RollupDivideByInput({
  divisor,
  label,
  onChange,
}: {
  divisor: number;
  label: string;
  onChange: (divisor: number) => void;
}) {
  const [draft, setDraft] = useState(String(divisor || 100));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(divisor || 100));
  }, [divisor]);

  return (
    <Input
      aria-label={label}
      inputMode={'numeric'}
      value={draft}
      className={'h-8 w-16 text-right'}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(divisor || 100));
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '');

        if (!digits) {
          setDraft('');
          return;
        }

        const normalized = digits.replace(/^0+(?=\d)/, '');
        const value = Number(normalized);

        if (!Number.isInteger(value) || value < 1 || value > MAX_ROLLUP_VISUALIZATION_DIVISOR) return;

        setDraft(normalized);
        onChange(value);
      }}
    />
  );
}

export function RollupVisualizationSettings({
  option,
  calculationType,
  onChange,
}: {
  option: RollupVisualizationOption;
  calculationType: CalculationType;
  onChange: (option: RollupVisualizationOption) => void;
}) {
  const { t } = useTranslation();
  const showNumberId = useId();
  const selectedColor = colorOptions.find((color) => color.value === option.color);
  const isNumber = option.type === RollupShowAsType.Number;

  return (
    <>
      <DropdownMenuSeparator className={'my-2'} />
      <DropdownMenuGroup className={'w-[280px] px-2 pb-1'} data-testid={'rollup-visualization-settings'}>
        <DropdownMenuLabel className={'px-2'}>{t('grid.rollup.showAs', { defaultValue: 'Show as' })}</DropdownMenuLabel>
        <div className={'grid grid-cols-3 gap-2 px-1 pb-2'}>
          {[RollupShowAsType.Number, RollupShowAsType.Bar, RollupShowAsType.Ring].map((type) => {
            const selected = option.type === type;

            return (
              <button
                key={type}
                type={'button'}
                data-testid={`rollup-visualization-${type}`}
                aria-pressed={selected}
                className={cn(
                  'flex min-w-0 flex-col items-center rounded-md border px-2 py-2 text-xs font-medium',
                  selected
                    ? 'border-border-theme-thick text-text-action'
                    : 'border-border-primary text-text-tertiary hover:border-border-primary-hover'
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange({ ...option, type });
                }}
              >
                <VisualizationPreview type={type} />
                <span>{getVisualizationLabel(t, type)}</span>
              </button>
            );
          })}
        </div>

        {!isNumber ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={'w-full'}>
                <ColorTileIcon value={getRollupVisualizationColor(option.color)} />
                <span>{t('grid.rollup.color', { defaultValue: 'Color' })}</span>
                <span className={'ml-auto truncate text-xs text-text-secondary'}>
                  {selectedColor ? t(selectedColor.labelKey, { defaultValue: selectedColor.label }) : option.color}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className={'w-[224px] p-3'}>
                  <div className={'grid grid-cols-5 gap-2'}>
                    {colorOptions.map((color) => (
                      <button
                        key={color.value}
                        type={'button'}
                        aria-label={t(color.labelKey, { defaultValue: color.label })}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onChange({ ...option, color: color.value });
                        }}
                      >
                        <ColorTile
                          value={getRollupVisualizationColor(color.value)}
                          active={color.value === option.color}
                          onClick={undefined}
                        />
                      </button>
                    ))}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            {!isRollupPercentCalculation(calculationType) ? (
              <div className={'flex h-10 items-center gap-2 rounded-md px-2 text-sm'}>
                <span className={'flex h-5 w-5 items-center justify-center text-xs'}>%</span>
                <span>{t('grid.rollup.divideBy', { defaultValue: 'Divide by' })}</span>
                <span className={'ml-auto'}>
                  <RollupDivideByInput
                    divisor={option.divisor}
                    label={t('grid.rollup.divideBy', { defaultValue: 'Divide by' })}
                    onChange={(divisor) => onChange({ ...option, divisor })}
                  />
                </span>
              </div>
            ) : null}

            <div className={'flex h-10 items-center gap-2 rounded-md px-2 text-sm'}>
              <span className={'flex h-5 w-5 items-center justify-center text-[10px]'}>123</span>
              <label htmlFor={showNumberId}>{t('grid.rollup.showNumber', { defaultValue: 'Show number' })}</label>
              <Switch
                id={showNumberId}
                className={'ml-auto'}
                checked={option.showNumber}
                onCheckedChange={(showNumber) => onChange({ ...option, showNumber })}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </>
        ) : null}
      </DropdownMenuGroup>
    </>
  );
}
