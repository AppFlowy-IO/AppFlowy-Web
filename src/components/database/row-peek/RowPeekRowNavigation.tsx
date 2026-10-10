import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigateToRow, useRowOrdersSelector } from '@/application/database-yjs';
import { usePublishedRowOrders } from '@/application/database-yjs/row-orders-store';
import type { Row } from '@/application/database-yjs/selector';
import { ReactComponent as DownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as UpIcon } from '@/assets/icons/alt_arrow_up.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { getModifier } from '@/utils/hotkeys';

import { hasRowPeekOverlay } from './RowPeekNavigation';

const RowPeekCardOrders = lazy(() => import('./RowPeekCardOrders'));

export function RowPeekRowNavigation({ rowId }: { rowId: string }) {
  const snapshot = usePublishedRowOrders();
  const [mounted, setMounted] = useState(false);

  // On a direct row link the view and peek mount together. Let the view
  // publish its initial (possibly loading) orders before starting a fallback.
  useLayoutEffect(() => setMounted(true), []);

  if (snapshot?.published || !mounted) return <RowNavigation rowId={rowId} rows={snapshot?.rows} />;
  if (snapshot?.presentation) {
    return (
      <Suspense fallback={<RowNavigation rowId={rowId} rows={snapshot.rows} />}>
        <RowPeekCardOrders presentation={snapshot.presentation}>
          {(rows) => <RowNavigation rowId={rowId} rows={rows} />}
        </RowPeekCardOrders>
      </Suspense>
    );
  }

  return <IndependentRowNavigation rowId={rowId} />;
}

function IndependentRowNavigation({ rowId }: { rowId: string }) {
  // A related database or a background tab switch can leave no mounted view
  // producing these orders. Do not publish this fallback as its own source.
  const rows = useRowOrdersSelector({ publish: false });

  return <RowNavigation rowId={rowId} rows={rows} />;
}

function RowNavigation({ rowId, rows }: { rowId: string; rows: Row[] | undefined }) {
  const toolbar = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const navigate = useNavigateToRow();
  const index = rows?.findIndex((row) => row.id === rowId) ?? -1;
  const previous = index > 0 ? rows?.[index - 1]?.id : undefined;
  const next = index >= 0 ? rows?.[index + 1]?.id : undefined;

  useEffect(() => {
    if (!navigate) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      const key = event.key.toLowerCase();
      // Match Desktop/Figma; retain the original Web shortcuts as aliases.
      const target = key === 'k' || key === 'p' ? previous : key === 'j' || key === 'n' ? next : undefined;

      if (!target || hasRowPeekOverlay(toolbar.current)) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(target);
    };

    // Text editors stop bubbling keys to keep the grid's shortcuts out.
    // These explicit row-navigation shortcuts still commit the focused editor.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [navigate, next, previous]);

  if (!navigate) return null;

  return (
    <div ref={toolbar} className='flex items-center gap-1'>
      {[
        { id: previous, label: t('grid.rowPage.previousRow'), Icon: UpIcon, testId: 'row-peek-previous', key: 'K' },
        { id: next, label: t('grid.rowPage.nextRow'), Icon: DownIcon, testId: 'row-peek-next', key: 'J' },
      ].map(({ id, label, Icon, testId, key }) => (
        <Tooltip key={testId}>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='row-peek-icon-button'
              aria-label={label}
              aria-keyshortcuts={`Control+Shift+${key} Meta+Shift+${key}`}
              data-testid={testId}
              disabled={!id}
              onClick={() => id && navigate(id)}
            >
              <Icon className='h-5 w-5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent className='rounded-lg'>
            {label}
            <TooltipShortcut className='text-text-tertiary'>
              {getModifier()} + Shift + {key}
            </TooltipShortcut>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
