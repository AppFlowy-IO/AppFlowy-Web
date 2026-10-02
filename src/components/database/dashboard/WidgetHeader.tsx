import { memo, ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewIcon, ViewLayout } from '@/application/types';
import { ReactComponent as BoardSvg } from '@/assets/icons/board.svg';
import { ReactComponent as CalendarSvg } from '@/assets/icons/calendar.svg';
import { ReactComponent as ChartSvg } from '@/assets/icons/chart.svg';
import { ReactComponent as DashboardSvg } from '@/assets/icons/dashboard.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as FormSvg } from '@/assets/icons/edit.svg';
import { ReactComponent as FeedSvg } from '@/assets/icons/feed.svg';
import { ReactComponent as GallerySvg } from '@/assets/icons/gallery.svg';
import { ReactComponent as GridSvg } from '@/assets/icons/grid.svg';
import { ReactComponent as ListSvg } from '@/assets/icons/list.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as TimelineSvg } from '@/assets/icons/timeline.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { DatabaseActions } from '@/components/database/components/conditions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useLongPress } from './hooks/useLongPress';
import { useWidgetSourceName } from './hooks/useWidgetSourceName';
import { widgetToolSlotClass } from './widget-tools';
import { useWidgetContext } from './WidgetContext';
import { WidgetMenu } from './WidgetMenu';
import { WidgetSettingsHost } from './WidgetSettingsHost';

interface WidgetHeaderFrameProps {
  /** Tools of the widget's own view (filter, sort, settings). */
  actions?: ReactNode;
  /** The widget's settings host; it needs the nested database's context. */
  settingsHost?: ReactNode;
}

/** The breadcrumb of the title tooltip: the source database, then the view. Mounted only while open. */
function WidgetSourceTooltipContent() {
  const { t } = useTranslation();
  const { databaseId, name, layout } = useWidgetContext();
  const databaseName = useWidgetSourceName(databaseId, true);

  return (
    <>
      {databaseName ? (
        <span className='flex min-w-0 items-center gap-1'>
          <DatabaseIcon aria-hidden='true' className='h-4 w-4 shrink-0' />
          <span className='truncate'>{databaseName}</span>
        </span>
      ) : null}
      <span className='flex min-w-0 items-center gap-1'>
        {databaseName ? <span aria-hidden='true'>└</span> : null}
        <PageIcon className='!h-4 !w-4 shrink-0 text-xs leading-4' iconSize={16} view={{ icon: null, layout }} />
        <span className='truncate'>{name || t('untitled')}</span>
      </span>
    </>
  );
}

/**
 * The title pill (accessible name "Widget options"): a quiet 12px label,
 * blue in Edit mode, with the view icon only when "Show icons in heading" is
 * on. A click, Enter or Space, or a long touch toggles the widget menu; the
 * tooltip names the source database and the view.
 */
/** The layout glyphs `PageIcon` falls back to, drawn here so the 16px glyph itself is the title icon. */
const LAYOUT_GLYPHS: Partial<Record<ViewLayout, typeof GridSvg>> = {
  [ViewLayout.Grid]: GridSvg,
  [ViewLayout.Board]: BoardSvg,
  [ViewLayout.Calendar]: CalendarSvg,
  [ViewLayout.Chart]: ChartSvg,
  [ViewLayout.List]: ListSvg,
  [ViewLayout.Gallery]: GallerySvg,
  [ViewLayout.Feed]: FeedSvg,
  [ViewLayout.Form]: FormSvg,
  [ViewLayout.Timeline]: TimelineSvg,
  [ViewLayout.Dashboard]: DashboardSvg,
};

/** The title icon ("Show icons in heading"): the view's own icon, else its layout glyph. */
function WidgetTitleIcon({ icon, layout }: { icon?: ViewIcon | null; layout: ViewLayout }) {
  const Glyph = icon?.value ? undefined : LAYOUT_GLYPHS[layout];

  if (Glyph) {
    return (
      <Glyph
        aria-hidden='true'
        className='h-4 w-4 shrink-0'
        data-parity-id='dash-widget-title-pill__icon'
        data-testid='dashboard-widget-title-icon'
      />
    );
  }

  return (
    <span
      className='flex h-4 w-4 shrink-0 items-center justify-center'
      data-parity-id='dash-widget-title-pill__icon'
      data-testid='dashboard-widget-title-icon'
    >
      <PageIcon className='!h-4 !w-4 text-xs leading-4' iconSize={16} view={{ icon, layout }} />
    </span>
  );
}

function WidgetTitle() {
  const { t } = useTranslation();
  const { name, icon, layout, editing, showIcon, menuOpen, setMenuOpen, titleRef } = useWidgetContext();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const labelId = useId();
  const longPress = useLongPress(() => setMenuOpen(true));
  const label = name || t('untitled');

  return (
    <Tooltip onOpenChange={setTooltipOpen} open={menuOpen ? false : tooltipOpen}>
      <TooltipTrigger asChild>
        <button
          aria-describedby={labelId}
          aria-expanded={menuOpen}
          aria-haspopup='menu'
          aria-label={t('dashboard.widget.menu', { defaultValue: 'Widget options' })}
          className={cn(
            'inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-600 px-2.5 py-1 text-left text-xs font-medium leading-4 text-dash-title outline-none',
            'transition-colors duration-150 ease-in-out hover:bg-dash-hover-fill focus-visible:ring-2 focus-visible:ring-border-theme-thick data-[state=open]:bg-dash-hover-fill motion-reduce:transition-none',
            editing && 'text-dash-edit-title'
          )}
          data-parity-id='dash-widget-title-pill'
          data-state={menuOpen ? 'open' : 'closed'}
          data-testid='dashboard-widget-title-button'
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          ref={titleRef}
          type='button'
          {...longPress}
        >
          {showIcon ? <WidgetTitleIcon icon={icon} layout={layout} /> : null}
          <span
            className='truncate'
            data-parity-id='dash-widget-title-pill__label'
            data-testid='dashboard-widget-title'
            id={labelId}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      {tooltipOpen && !menuOpen ? (
        <TooltipContent
          align='start'
          className='!rounded-300 px-2.5 py-1.5 text-xs leading-4'
          data-testid='dashboard-widget-source-tooltip'
          side='bottom'
          sideOffset={4}
        >
          <WidgetSourceTooltipContent />
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

/**
 * Header of a dashboard widget. Also rendered for placeholders (no nested
 * database), so it only depends on `WidgetContext`; the view's tools come in
 * through `actions`.
 *
 * - Titles shown: a 40px band above the card, the same in View and Edit
 *   mode, with the title pill at the start and the tools at the end. In Edit
 *   mode the band is the drag handle.
 * - Titles hidden: a capsule floating in the card's top-right corner, with
 *   the tools and a "Widget options" button that opens the menu.
 * - A right-click anywhere on the widget box opens the menu (handled by the box).
 */
export function WidgetHeaderFrame({ actions, settingsHost }: WidgetHeaderFrameProps) {
  const { t } = useTranslation();
  const { editing, showWidgetTitles, setDragHandle, isDragging, menuOpen, setMenuOpen, optionsRef } = useWidgetContext();

  if (!showWidgetTitles) {
    return (
      <div
        className={cn(
          'absolute right-2 top-2 z-10 flex items-center rounded-300 border border-border-primary bg-surface-primary p-0.5 shadow-card',
          editing ? 'cursor-grab opacity-100' : widgetToolSlotClass(),
          menuOpen && 'opacity-100',
          isDragging && 'cursor-grabbing'
        )}
        data-parity-id='dash-widget-capsule'
        data-testid='dashboard-widget-tool-capsule'
        ref={editing ? setDragHandle : undefined}
      >
        {actions}
        <div className='relative flex'>
          <Button
            aria-expanded={menuOpen}
            aria-haspopup='menu'
            aria-label={t('dashboard.widget.menu', { defaultValue: 'Widget options' })}
            className='!rounded-200 text-dash-tool-icon [&_svg]:h-4 [&_svg]:w-4'
            data-parity-id='dash-widget-options-button'
            data-state={menuOpen ? 'open' : 'closed'}
            data-testid='dashboard-widget-options-button'
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            ref={optionsRef}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <MoreIcon aria-hidden='true' data-parity-id='dash-widget-options-button__icon' />
          </Button>
          <WidgetMenu align='end' onOpenChange={setMenuOpen} open={menuOpen}>
            <span aria-hidden='true' className='pointer-events-none absolute bottom-0 right-0 h-0 w-0' />
          </WidgetMenu>
        </div>
        {settingsHost}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-10 min-w-0 shrink-0 items-center gap-1 px-2.5 py-0.5',
        editing && 'cursor-grab',
        isDragging && 'cursor-grabbing'
      )}
      data-parity-id='dash-widget-header'
      data-testid='dashboard-widget-header'
      ref={editing ? setDragHandle : undefined}
    >
      <div className='relative flex min-w-0'>
        <WidgetTitle />
        {/* The menu opens on click (a drag that starts on the pill still moves the widget), under the pill. */}
        <WidgetMenu align='start' onOpenChange={setMenuOpen} open={menuOpen}>
          <span aria-hidden='true' className='pointer-events-none absolute bottom-0 left-0 h-0 w-0' />
        </WidgetMenu>
      </div>
      {actions ? <div className='ml-auto flex shrink-0 items-center'>{actions}</div> : null}
      {settingsHost}
    </div>
  );
}

/**
 * Widget header rendered by `DatabaseViews` in place of the tab bar.
 * Memoized: `DatabaseViews` re-renders with every row-map change of the
 * nested database, and the header only depends on `WidgetContext`.
 */
export const WidgetHeader = memo(function WidgetHeader() {
  return <WidgetHeaderFrame actions={<DatabaseActions />} settingsHost={<WidgetSettingsHost />} />;
});

export default WidgetHeader;
