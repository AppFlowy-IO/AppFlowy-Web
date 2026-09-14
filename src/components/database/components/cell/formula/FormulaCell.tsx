import { lazy, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { CellProps, FormulaCell as FormulaCellType } from '@/application/database-yjs/cell.type';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { ReactComponent as WarningSvg } from '@/assets/icons/warning.svg';
import { ShowAsVisualization } from '@/components/database/components/cell/rollup/ShowAsVisualization';
import { getRollupVisualizationColor } from '@/components/database/components/property/rollup/visualization';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const FormulaEditorDialog = lazy(() =>
  import('@/components/database/components/property/formula/FormulaEditorDialog').then(
    ({ FormulaEditorDialog: Component }) => ({ default: Component })
  )
);

export function formulaVisualizationRatio(rawNumeric: number, divisor: number) {
  if (!Number.isFinite(rawNumeric) || rawNumeric <= 0) return 0;
  return Math.min(rawNumeric / (divisor > 0 ? divisor : 100), 1);
}

export function FormulaCell({
  cell,
  style,
  placeholder,
  rowId,
  fieldId,
  wrap,
  editing,
  setEditing,
  readOnly,
  isCardCell,
}: CellProps<FormulaCellType>) {
  const { t } = useTranslation();
  const value = cell?.data ?? '';
  const isBoolean = cell?.resultType === 'boolean' && !cell.error;
  const visualization = cell?.visualization;
  const canVisualize =
    !isCardCell &&
    !cell?.error &&
    cell?.resultType === 'number' &&
    cell.rawNumeric !== undefined &&
    visualization !== undefined &&
    visualization.type !== RollupShowAsType.Number;
  const isEmpty = !value && !isBoolean && !cell?.error;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setEditing?.(open);
    },
    [setEditing]
  );

  let content: React.ReactNode;

  if (cell?.error) {
    content = (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span
            className={'flex min-w-0 items-center gap-1 text-text-error'}
            data-testid={`formula-cell-error-${rowId}-${fieldId}`}
          >
            <WarningSvg className={'h-4 w-4 shrink-0'} />
            <span className={'truncate'}>{t('grid.formula.error', { defaultValue: 'Error' })}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side={'top'} className={'max-w-[320px] whitespace-pre-wrap break-words'}>
          {cell.error}
        </TooltipContent>
      </Tooltip>
    );
  } else if (isBoolean) {
    content = cell?.rawBoolean ? (
      <CheckboxCheckSvg className={'h-5 w-5 text-text-action'} data-testid={'formula-checked-icon'} />
    ) : (
      <CheckboxUncheckSvg className={'h-5 w-5 text-border-primary'} data-testid={'formula-unchecked-icon'} />
    );
  } else if (canVisualize && cell && visualization) {
    content = (
      <ShowAsVisualization
        type={visualization.type}
        ratio={formulaVisualizationRatio(cell.rawNumeric ?? 0, visualization.divisor)}
        color={getRollupVisualizationColor(visualization.color)}
        value={value}
        showValue={Boolean(visualization.showNumber && value)}
        testIdPrefix={'formula'}
      />
    );
  } else {
    content = value || (cell?.isBlank ? placeholder : '') || '';
  }

  return (
    <div
      style={style}
      data-testid={`formula-cell-${rowId}-${fieldId}`}
      data-result-type={cell?.resultType}
      className={cn(
        'formula-cell relative flex w-full items-center gap-1',
        isEmpty && placeholder ? 'text-text-tertiary' : '',
        cell?.resultType === 'number' && !canVisualize ? 'justify-end text-right' : '',
        wrap
          ? 'flex-wrap overflow-x-hidden whitespace-pre-wrap break-words'
          : 'appflowy-hidden-scroller h-full w-full flex-nowrap overflow-x-auto overflow-y-hidden whitespace-nowrap'
      )}
    >
      {content}
      {editing && !readOnly ? (
        <Suspense fallback={null}>
          <FormulaEditorDialog fieldId={fieldId} rowId={rowId} open={editing} onOpenChange={handleOpenChange} />
        </Suspense>
      ) : null}
    </div>
  );
}

export default FormulaCell;
