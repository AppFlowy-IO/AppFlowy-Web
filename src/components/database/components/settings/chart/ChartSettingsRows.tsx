import { useTranslation } from 'react-i18next';

import type { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { DropdownMenuItem, DropdownMenuItemTick, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

import type { ReactNode } from 'react';

/**
 * Desktop `ChartSectionHeader`: a non-interactive `AFTextMenuItem` (8px / 6px
 * padding) with a caption-enhanced tertiary title, i.e. a 30px row.
 */
export function ChartSectionHeader({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <DropdownMenuLabel
      className='min-h-0 px-2 py-1.5 text-xs font-medium leading-[18px] text-text-tertiary'
      data-chart-settings-section-header=''
      id={id}
    >
      {children}
    </DropdownMenuLabel>
  );
}

/** Desktop's 12px hint-colored empty-state text with 8px padding. */
export function ChartSettingsHint({ children }: { children: ReactNode }) {
  return <div className='p-2 text-xs text-text-caption'>{children}</div>;
}

/**
 * Desktop `ChartFieldItem`: field-type icon, field name and a tick when
 * selected. One of a section's rows is selected at a time, so the row is a
 * `menuitemradio` and the tick is purely visual.
 */
export function ChartFieldItem({
  fieldType,
  name,
  selected,
  testId,
  onSelect,
}: {
  fieldType: FieldType;
  name: string;
  selected: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      aria-checked={selected}
      data-selected={selected ? 'true' : undefined}
      data-testid={testId}
      role='menuitemradio'
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <FieldTypeIcon className='text-icon-primary' type={fieldType} />
      <span className='min-w-0 flex-1 truncate'>{name}</span>
      {selected ? <DropdownMenuItemTick aria-hidden='true' /> : null}
    </DropdownMenuItem>
  );
}

/**
 * Desktop `ChartAggregationTypeItem` (also used for the date groupings): a
 * label and a tick, exposed as a `menuitemradio` like `ChartFieldItem`.
 */
export function ChartOptionItem({
  label,
  selected,
  testId,
  onSelect,
}: {
  label: string;
  selected: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      aria-checked={selected}
      data-selected={selected ? 'true' : undefined}
      data-testid={testId}
      role='menuitemradio'
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {selected ? <DropdownMenuItemTick aria-hidden='true' /> : null}
    </DropdownMenuItem>
  );
}

/**
 * The "Omit zero values" toggle from desktop's mobile chart settings, bound to
 * `omitEmptyValues`. The whole row is the menu item; the switch is visual only
 * so the row stays a single focusable control.
 */
export function ChartOmitZeroValuesItem({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();

  return (
    <DropdownMenuItem
      aria-checked={checked}
      data-testid='chart-omit-zero-values'
      role='menuitemcheckbox'
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
    >
      <HideIcon aria-hidden='true' className='text-icon-primary' />
      <span className='min-w-0 flex-1 truncate'>{t('chart.omitZeroValues', 'Omit zero values')}</span>
      <Switch aria-hidden='true' checked={checked} className='pointer-events-none' tabIndex={-1} />
    </DropdownMenuItem>
  );
}
