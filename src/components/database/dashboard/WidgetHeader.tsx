import { MouseEvent, ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { DatabaseActions } from '@/components/database/components/conditions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WIDGET_EDIT_HEADER_HEIGHT, WIDGET_TITLE_HEIGHT } from './constants';
import { useWidgetContext } from './WidgetContext';
import { WidgetMenu } from './WidgetMenu';

interface WidgetHeaderFrameProps {
  /** Toolbar of the widget's own view (filters, sorts, settings, open as page). */
  actions?: ReactNode;
}

/** The icon and name; clicking it opens the widget menu, like Notion. */
function WidgetTitle({ className, onOpenMenu }: { className?: string; onOpenMenu: () => void }) {
  const { t } = useTranslation();
  const { name, icon, layout } = useWidgetContext();

  return (
    <button
      aria-haspopup='menu'
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 rounded-200 text-left outline-none',
        'hover:text-text-primary focus-visible:ring-1 focus-visible:ring-border-theme-thick',
        className
      )}
      data-testid='dashboard-widget-title-button'
      onClick={(event) => {
        event.stopPropagation();
        onOpenMenu();
      }}
      type='button'
    >
      <PageIcon className='!h-5 !w-5 shrink-0 text-base leading-[1.3rem]' iconSize={16} view={{ icon, layout }} />
      <span className='truncate' data-testid='dashboard-widget-title' title={name}>
        {name || t('untitled')}
      </span>
    </button>
  );
}

/**
 * Header of a dashboard widget. Also rendered for placeholders (no nested
 * database), so it only depends on `WidgetContext`; the view toolbar comes in
 * through `actions`.
 *
 * - Edit mode: tinted bar inside the card; the bar is the drag handle and
 *   carries the options button.
 * - View mode: a quiet title above the card with the toolbar on hover, or,
 *   when titles are hidden, only the toolbar floating over the card.
 * - Right-click opens the options menu (View mode offers "Open view" only).
 */
export function WidgetHeaderFrame({ actions }: WidgetHeaderFrameProps) {
  const { t } = useTranslation();
  const { isEditing, canEdit, showTitle, setDragHandle, isDragging } = useWidgetContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const editing = isEditing && canEdit;

  const handleContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(true);
  }, []);
  const openMenu = useCallback(() => setMenuOpen(true), []);

  if (editing) {
    return (
      <div
        className={cn(
          'flex shrink-0 cursor-grab items-center gap-1 border-b border-border-primary bg-fill-content-hover pl-1 pr-1.5 text-sm font-medium text-text-primary',
          isDragging && 'cursor-grabbing'
        )}
        data-testid='dashboard-widget-header'
        onContextMenu={handleContextMenu}
        ref={setDragHandle}
        style={{ height: WIDGET_EDIT_HEADER_HEIGHT }}
        title={t('dashboard.widget.dragHandle', { defaultValue: 'Drag to move' })}
      >
        <DragIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-tertiary' />
        <WidgetTitle onOpenMenu={openMenu} />
        {actions ? <div className='flex shrink-0 items-center'>{actions}</div> : null}
        <WidgetMenu onOpenChange={setMenuOpen} open={menuOpen}>
          <Button
            aria-label={t('dashboard.widget.menu', { defaultValue: 'Widget options' })}
            className='shrink-0'
            data-testid='dashboard-widget-menu-button'
            onClick={(event) => event.stopPropagation()}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <MoreIcon aria-hidden='true' className='h-5 w-5' />
          </Button>
        </WidgetMenu>
      </div>
    );
  }

  const menuAnchor = (
    <WidgetMenu onOpenChange={setMenuOpen} open={menuOpen}>
      <span aria-hidden='true' className='pointer-events-none h-0 w-0 self-end' />
    </WidgetMenu>
  );

  if (!showTitle) {
    return (
      <div
        className={cn(
          'pointer-events-none absolute right-2 top-2 z-10 flex items-center opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/widget:opacity-100 has-[[data-state=open]]:opacity-100'
        )}
        data-testid='dashboard-widget-header'
        onContextMenu={handleContextMenu}
      >
        {actions ? (
          <div className='pointer-events-auto flex items-center rounded-300 border border-border-primary bg-surface-primary p-0.5 shadow-card'>
            {actions}
          </div>
        ) : null}
        {menuAnchor}
      </div>
    );
  }

  return (
    <div
      className='flex shrink-0 items-center gap-1 px-1 text-sm font-medium text-text-secondary'
      data-testid='dashboard-widget-header'
      onContextMenu={handleContextMenu}
      style={{ height: WIDGET_TITLE_HEIGHT }}
    >
      <WidgetTitle onOpenMenu={openMenu} />
      {actions ? (
        <div
          className={cn(
            'flex shrink-0 items-center opacity-0 transition-opacity',
            'focus-within:opacity-100 group-hover/widget:opacity-100 has-[[data-state=open]]:opacity-100'
          )}
        >
          {actions}
        </div>
      ) : null}
      {menuAnchor}
    </div>
  );
}

/** Widget header rendered by `DatabaseViews` in place of the tab bar. */
export function WidgetHeader() {
  return <WidgetHeaderFrame actions={<DatabaseActions />} />;
}

export default WidgetHeader;
