import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { memo, ReactNode, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const DIALOG_PAPER_PROPS = {
  className: cn(
    'flex !h-full !w-full overflow-hidden rounded-2xl bg-surface-layer-02',
    '!max-h-[min(920px,_calc(100vh-160px))] !min-h-[min(689px,_calc(100vh-40px))] !min-w-[min(984px,_calc(100vw-40px))] !max-w-[min(1680px,_calc(100vw-240px))]'
  ),
};

export type HistoryDateFilter = 'all' | 'last7Days' | 'last30Days' | 'last60Days';

const DATE_FILTERS: HistoryDateFilter[] = ['all', 'last7Days', 'last30Days', 'last60Days'];

// Presentation is shared; each history feature owns its data, permissions, and restore lifecycle.
export function VersionHistoryDialog({ open, onClose, title, testId, sidebar, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  testId: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth={false}
      keepMounted={false} disableRestoreFocus PaperProps={DIALOG_PAPER_PROPS}>
      <DialogContent data-testid={testId} className='flex h-full w-full flex-col overflow-hidden !p-0 md:flex-row'>
        <div className='order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-t-2xl md:order-1 md:rounded-l-2xl md:rounded-tr-none'>
          <DialogTitle id={titleId} className='border-b border-border px-6 py-4 text-base font-bold text-text-primary'>
            {title}
          </DialogTitle>
          <div className='min-h-0 flex-1 overflow-hidden'>{children}</div>
        </div>
        <aside className='order-1 flex max-h-[45%] min-h-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-r-2xl border-border-primary bg-surface-container-layer-01 md:order-2 md:max-h-none md:w-[280px] md:border-l'>
          {sidebar}
        </aside>
      </DialogContent>
    </Dialog>
  );
}

export function VersionHistoryHeader({ onClose, closeTestId, children }: {
  onClose?: () => void;
  closeTestId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setMenuContainer} className='flex shrink-0 items-center justify-center gap-1 px-4 pb-0.5 pt-3'>
      <p className='flex-1 text-start text-sm font-medium text-text-primary'>{t('versionHistory.versionHistory')}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' className='text-icon-secondary'
            aria-label={t('versionHistory.filter', 'Filter versions')}>
            <FilterIcon className='h-5 w-5' />
          </Button>
        </DropdownMenuTrigger>
        {/* Keep the menu inside MUI's focus trap and modal stacking context. */}
        <DropdownMenuContent align='end' container={menuContainer}>{children}</DropdownMenuContent>
      </DropdownMenu>
      <Button data-testid={closeTestId} variant='ghost' size='icon' className='text-icon-secondary'
        aria-label={t('button.close', 'Close')} onClick={onClose}>
        <CloseIcon className='h-5 w-5' />
      </Button>
    </div>
  );
}

export function VersionHistoryDateFilter({ value, onChange, showDateRanges = true }: {
  value: HistoryDateFilter;
  onChange: (value: HistoryDateFilter) => void;
  showDateRanges?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenuGroup>
      {DATE_FILTERS.filter((filter) => showDateRanges || filter === 'all').map((filter) => (
        <DropdownMenuItem key={filter} onSelect={(event) => {
          event.preventDefault();
          onChange(filter);
        }}>
          <TimeIcon className='h-5 w-5' />
          <span className='flex-1'>{t(`versionHistory.${filter}`)}</span>
          {value === filter && <TickIcon className='h-5 w-5 text-icon-info-thick' />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

export const VersionHistoryItem = memo(function VersionHistoryItem({
  id, title, selected, isFirst, isLast, onSelect, testId, children,
}: {
  id: string;
  title: ReactNode;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
  testId: string;
  children?: ReactNode;
}) {
  const handleSelect = useCallback(() => onSelect(id), [id, onSelect]);

  return (
    <Button data-testid={testId} type='button' variant='ghost' aria-pressed={selected} onClick={handleSelect}
      className={cn(
        'group relative flex w-full items-start justify-start gap-3 whitespace-normal rounded-400 py-0 pl-4 pr-3 text-left',
        selected && 'bg-fill-content-hover'
      )}>
      {!isFirst && <div aria-hidden className='absolute left-[25px] top-0 h-[22px] w-0.5 bg-icon-quaternary' />}
      {!isLast && <div aria-hidden className='absolute bottom-0 left-[25px] top-[22px] w-0.5 bg-icon-quaternary' />}
      <div aria-hidden className={cn(
        'absolute top-3 m-1 h-3 w-3 shrink-0 rounded-200 border-[2px] bg-surface-container-layer-01',
        selected ? 'border-border-theme-thick' : 'border-icon-tertiary'
      )}>
        <div className={cn('h-2 w-2 rounded-100', selected ? 'bg-fill-content-hover' : 'group-hover:bg-fill-content-hover')} />
      </div>
      <span className='ml-8 flex min-w-0 flex-1 flex-col items-start break-words py-3 text-sm'>
        <span className={selected ? 'font-medium text-text-info' : 'text-text-primary'}>{title}</span>
        {children}
      </span>
    </Button>
  );
});

export function VersionHistoryFooter({ onRestore, disabled, loading = false, testId, children }: {
  onRestore?: () => void;
  disabled: boolean;
  loading?: boolean;
  testId: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className='shrink-0'>
      <Separator />
      <div className='space-y-3 px-4 py-3'>
        {children}
        <div className='flex justify-end'>
          <Button data-testid={testId} className='font-medium' onClick={onRestore} disabled={disabled} loading={loading}>
            {t('versionHistory.restore')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VersionHistoryEmptyState({ children, role }: {
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return <div role={role} className='flex h-full items-center justify-center p-6 text-center text-sm text-text-tertiary'>{children}</div>;
}
