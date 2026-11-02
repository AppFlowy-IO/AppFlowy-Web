import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, FieldVisibility, useBoardLayoutSettings, useFieldsSelector } from '@/application/database-yjs';
import {
  isGroupCalculationFieldType,
  validGroupCalculationTypes,
} from '@/application/database-yjs/board-group-calculation';
import { useSetBoardGroupCalculation } from '@/application/database-yjs/dispatch/board';
import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { groupCalculationLabel } from '@/components/database/components/board/column/group-calculation-labels';
import { FieldTypeIcon } from '@/components/database/components/field';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** The panes of a column's "Calculate" menu: the property list, or the calculations of one property. */
export type ColumnCalculationPane = 'calculate' | { fieldId: string };

const ALL_VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];
const ROW_CLASS = cn(dropdownMenuItemVariants({ variant: 'default' }), 'min-h-7 w-full rounded-200 text-sm leading-5');

function PaneHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex min-h-7 items-center gap-1 px-1 pb-1'>
      <button
        aria-label={t('button.back', { defaultValue: 'Back' })}
        className='flex h-6 w-6 items-center justify-center rounded-200 text-icon-secondary hover:bg-fill-content-hover'
        data-testid='board-column-calculate-back'
        onClick={onBack}
        type='button'
      >
        <BackIcon aria-hidden='true' className='h-4 w-4' />
      </button>
      <span className='truncate text-sm font-medium leading-5 text-text-primary'>{title}</span>
    </div>
  );
}

function Tick({ shown }: { shown: boolean }) {
  return shown ? <TickIcon aria-hidden='true' className='ml-auto h-5 w-5 shrink-0 text-icon-info-thick' /> : null;
}

/**
 * The column `···` › Calculate panes (WP09 §1.6), 240 wide: "Count all" and
 * the supported properties in field order, then the calculations valid for
 * the chosen property. A pick writes the board-wide calculation and closes.
 */
export function ColumnCalculationMenu({
  pane,
  onPaneChange,
  onBack,
  onDone,
}: {
  pane: ColumnCalculationPane;
  onPaneChange: (pane: ColumnCalculationPane) => void;
  /** Back from the property list to the column menu. */
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const fields = useFieldsSelector(ALL_VISIBILITIES);
  const { groupCalculation } = useBoardLayoutSettings();
  const setGroupCalculation = useSetBoardGroupCalculation();
  const properties = useMemo(() => fields.filter((field) => isGroupCalculationFieldType(field.fieldType)), [fields]);

  if (pane === 'calculate') {
    return (
      <div className='flex flex-col' data-testid='board-column-calculate-menu'>
        <PaneHeader onBack={onBack} title={t('board.column.calculate')} />
        <div
          className={ROW_CLASS}
          data-checked={groupCalculation ? 'false' : 'true'}
          data-testid='board-column-calculate-count-all'
          onClick={() => {
            setGroupCalculation(null);
            onDone();
          }}
          role='menuitemradio'
          aria-checked={!groupCalculation}
        >
          <span className='truncate'>{t('grid.calculationTypeLabel.count')}</span>
          <Tick shown={!groupCalculation} />
        </div>
        <div className='-mx-2 my-1 h-px bg-border-primary' role='separator' />
        <div className='px-2 py-1 text-xs leading-4 text-text-tertiary'>{t('board.column.properties')}</div>
        {properties.map((property) => (
          <div
            className={ROW_CLASS}
            data-checked={groupCalculation?.fieldId === property.fieldId ? 'true' : 'false'}
            data-testid={`board-column-calculate-field-${property.fieldId}`}
            key={property.fieldId}
            onClick={() => onPaneChange({ fieldId: property.fieldId })}
            role='menuitem'
          >
            <FieldTypeIcon className='h-5 w-5 shrink-0 text-icon-secondary' type={property.fieldType as FieldType} />
            <span className='min-w-0 flex-1 truncate'>{property.fieldName || t('untitled')}</span>
            {groupCalculation?.fieldId === property.fieldId ? (
              <TickIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-info-thick' />
            ) : null}
            <ChevronRightIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
          </div>
        ))}
      </div>
    );
  }

  const property = properties.find((field) => field.fieldId === pane.fieldId);
  const types = validGroupCalculationTypes(property?.fieldType);

  return (
    <div className='flex flex-col' data-testid='board-column-calculate-types'>
      <PaneHeader onBack={() => onPaneChange('calculate')} title={property?.fieldName || ''} />
      {types.map((type) => {
        const current = groupCalculation?.fieldId === pane.fieldId && groupCalculation.type === type;

        return (
          <div
            aria-checked={current}
            className={ROW_CLASS}
            data-checked={current ? 'true' : 'false'}
            data-testid={`board-column-calculate-type-${type}`}
            key={type}
            onClick={() => {
              setGroupCalculation({ type, fieldId: pane.fieldId });
              onDone();
            }}
            role='menuitemradio'
          >
            <span className='truncate'>{groupCalculationLabel(t, type)}</span>
            <Tick shown={current} />
          </div>
        );
      })}
    </div>
  );
}

export default ColumnCalculationMenu;
