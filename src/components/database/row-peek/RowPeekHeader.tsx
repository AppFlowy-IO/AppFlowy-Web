import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as PromoteIcon } from '@/assets/icons/database_fullscreen.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/double_arrow_right.svg';
import { ReactComponent as FullPageIcon } from '@/assets/icons/full_page.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import { ReactComponent as TabIcon } from '@/assets/icons/tab.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { RowPeekDocumentActions } from './RowPeekDocumentActions';
import { useRowPeekBannerActions } from './RowPeekBannerActions';
import { RowPeekRowNavigation } from './RowPeekRowNavigation';

import type { RowPeekMode } from './RowPeekSurface';
import type { ReactNode } from 'react';

function ToolbarDivider() {
  return <span aria-hidden className='row-peek-toolbar-divider' />;
}

export function RowPeekHeader({
  rowId,
  side,
  canShowSide,
  nested,
  onClose,
  onModeChange,
  onOpenFullPage,
  onOpenNewTab,
  prepare,
  shareUrl,
  children,
}: {
  rowId: string;
  side: boolean;
  canShowSide: boolean;
  nested: boolean;
  onClose: () => void;
  onModeChange: (mode: RowPeekMode) => void;
  onOpenFullPage?: () => void;
  onOpenNewTab?: () => void;
  prepare: () => Promise<boolean>;
  shareUrl?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const bannerActions = useRowPeekBannerActions();
  const promote = onOpenFullPage ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid='row-detail-open-full-page'
          size='icon'
          variant='ghost'
          className='row-peek-icon-button'
          aria-label={t('grid.rowPage.openAsFullPage')}
          onClick={onOpenFullPage}
        >
          <PromoteIcon className='h-5 w-5' />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('grid.rowPage.openAsFullPage')}</TooltipContent>
    </Tooltip>
  ) : null;
  const modeMenu = (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='row-peek-icon-button'
          data-testid='row-peek-mode-menu'
          aria-label={t('grid.rowPage.switchPeekMode')}
        >
          {side ? <SidePeekIcon className='h-5 w-5' /> : <CenterPeekIcon className='h-5 w-5' />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-80 max-w-[calc(100vw-16px)] rounded-xl'>
        <DropdownMenuLabel className='text-xs font-medium leading-[18px] tracking-[0.1px] text-text-tertiary'>
          {t('grid.rowPage.openPageIn')}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={!canShowSide} data-testid='row-peek-mode-side' onSelect={() => onModeChange('side')}>
          <SidePeekIcon className='h-5 w-5' />
          {t('grid.rowPage.sidePeek')}
          {side ? <CheckIcon className='ml-auto h-5 w-5 text-icon-info-thick' /> : null}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid='row-peek-mode-center' onSelect={() => onModeChange('center')}>
          <CenterPeekIcon className='h-5 w-5' />
          {t('grid.rowPage.centerPeek')}
          {!side ? <CheckIcon className='ml-auto h-5 w-5 text-icon-info-thick' /> : null}
        </DropdownMenuItem>
        {onOpenFullPage ? (
          <DropdownMenuItem onSelect={onOpenFullPage}>
            <FullPageIcon className='h-5 w-5' />
            {t('grid.rowPage.fullPage')}
          </DropdownMenuItem>
        ) : null}
        {onOpenNewTab ? (
          <DropdownMenuItem data-testid='row-peek-new-tab' onSelect={onOpenNewTab}>
            <TabIcon className='h-5 w-5' />
            {t('grid.rowPage.newTab')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div data-testid='row-detail-header' className='row-peek-header'>
      <div className='row-peek-left-cluster flex min-w-0 flex-1 items-center gap-1' data-menu-open={menuOpen}>
        {side || nested ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='row-peek-icon-button'
                data-testid='row-detail-close'
                aria-label={t('button.close')}
                onClick={onClose}
              >
                {nested ? <ArrowLeftIcon className='h-5 w-5' /> : <CloseIcon className='h-5 w-5' />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('button.close')}</TooltipContent>
          </Tooltip>
        ) : null}
        <div className='row-peek-optional-actions'>
          {side ? (
            <>
              {promote}
              {promote ? <ToolbarDivider /> : null}
              {modeMenu}
              <ToolbarDivider />
            </>
          ) : null}
          {side ? <RowPeekRowNavigation rowId={rowId} /> : null}
        </div>
        {!side ? <div ref={bannerActions?.headerRef} className='row-peek-banner-actions h-8 min-w-0 flex-1' /> : null}
      </div>
      <div className='row-peek-right-cluster flex min-w-0 items-center gap-1'>
        <RowPeekDocumentActions rowId={rowId} prepare={prepare} shareUrl={shareUrl}>
          {!side ? (
            <>
              {promote}
              <ToolbarDivider />
              {modeMenu}
              <ToolbarDivider />
              <RowPeekRowNavigation rowId={rowId} />
              <ToolbarDivider />
            </>
          ) : null}
        </RowPeekDocumentActions>
        {children}
      </div>
    </div>
  );
}
