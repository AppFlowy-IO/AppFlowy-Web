import { useTranslation } from 'react-i18next';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import { useRowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Desktop's hover-only `_PeekButton`: a 20x20 ghost button after the title
 * that opens the peek. It only exists while the row is hovered or focused,
 * so the title row grows by its width on hover exactly as on desktop.
 * Kept as its own component so `memo(ListRow)` does not re-render when the
 * peek layout changes.
 */
export function ListRowPeekButton({ rowId }: { rowId: string }) {
  const { t } = useTranslation();
  const context = useDatabaseContextOptional();
  const navigateToRow = context?.navigateToRow;
  const peekLayout = useRowPeekLayout();
  // Same presentation rule as the row page's OpenAction.
  const side = peekLayout?.canShow === true && !context?.openPageModalViewId;
  const label = t(side ? 'grid.rowPage.openAsSidePeekPanel' : 'grid.rowPage.openAsCenterPeekPanel');

  if (!navigateToRow) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className='ml-1.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-300 text-icon-primary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick group-hover/list-row:flex group-focus-within/list-row:flex'
          data-testid={`list-row-peek-${rowId}`}
          onClick={(event) => {
            event.stopPropagation();
            navigateToRow(rowId);
          }}
          type='button'
        >
          {side ? <SidePeekIcon aria-hidden className='h-5 w-5' /> : <CenterPeekIcon aria-hidden className='h-5 w-5' />}
        </button>
      </TooltipTrigger>
      {/* Desktop AFTooltip preferBelow: false */}
      <TooltipContent side='top'>{label}</TooltipContent>
    </Tooltip>
  );
}

export default ListRowPeekButton;
