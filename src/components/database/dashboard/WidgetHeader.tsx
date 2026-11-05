import { memo, ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewIcon, ViewLayout } from '@/application/types';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { ViewIcon as LayoutGlyph } from '@/components/_shared/view-icon/ViewIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS, WIDGET_HEADER_HEIGHT, WIDGET_HEADER_PADDING } from './constants';
import { DASHBOARD_CONTROL_CLASS, DASHBOARD_ICON_BUTTON_CLASS } from './dashboard-ui';
import { useLongPress } from './hooks/useLongPress';
import { useWidgetSourceName } from './hooks/useWidgetSourceName';
import { MobileWidgetSearchField } from './mobile/MobileWidgetSearchField';
import { WidgetActions } from './widget-tool-buttons/WidgetActions';
import { WIDGET_TOOL_SLOT_CLASS } from './widget-tools';
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
 * The title icon ("Show icons in heading"): the view's own icon, else the
 * glyph of its layout, drawn in the design system’s 20px frame (the parity probe
 * measures its svg).
 */
function WidgetTitleIcon({ icon, layout }: { icon?: ViewIcon | null; layout: ViewLayout }) {
  if (!icon?.value) {
    return (
      <LayoutGlyph
        aria-hidden='true'
        className='h-5 w-5 shrink-0 text-icon-secondary'
        data-parity-id='dash-widget-title-pill__icon'
        data-testid='dashboard-widget-title-icon'
        layout={layout}
        size='unset'
      />
    );
  }

  return (
    <span
      className='flex h-5 w-5 shrink-0 items-center justify-center text-icon-secondary'
      data-parity-id='dash-widget-title-pill__icon'
      data-testid='dashboard-widget-title-icon'
    >
      <PageIcon className='!h-5 !w-5 text-sm leading-5' iconSize={20} view={{ icon, layout }} />
    </span>
  );
}

/**
 * The widget title uses the same 14/20 typography as other controls. The
 * optional heading icon follows the view's saved setting. A click, Enter
 * or Space, or a long touch toggles the widget menu (a
 * bottom sheet on a phone); the tooltip names the source database and the
 * view, except on a phone, where nothing hovers.
 */
function WidgetTitle() {
  const { t } = useTranslation();
  const { name, icon, layout, showIcon, menuOpen, setMenuOpen, titleRef, mobileContext } = useWidgetContext();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const labelId = useId();
  const longPress = useLongPress(() => setMenuOpen(true));
  const label = name || t('untitled');
  const showTooltip = tooltipOpen && !menuOpen && !mobileContext;

  return (
    <Tooltip onOpenChange={setTooltipOpen} open={showTooltip}>
      <TooltipTrigger asChild>
        <Button
          aria-describedby={labelId}
          aria-expanded={menuOpen}
          aria-haspopup={mobileContext ? 'dialog' : 'menu'}
          aria-label={t('dashboard.widget.menu', { defaultValue: 'Widget options' })}
          className={cn(
            DASHBOARD_CONTROL_CLASS,
            'min-w-0 max-w-full justify-start gap-1.5 px-2 text-left text-text-primary',
            'transition-colors hover:bg-fill-content-hover data-[state=open]:bg-fill-content-hover motion-reduce:transition-none',
            DASHBOARD_MOTION_FAST_CLASS,
            mobileContext && 'h-10 !rounded-300 text-base leading-6'
          )}
          data-parity-id='dash-widget-title-pill'
          data-state={menuOpen ? 'open' : 'closed'}
          data-testid='dashboard-widget-title-button'
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          ref={titleRef}
          variant='ghost'
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
        </Button>
      </TooltipTrigger>
      {showTooltip ? (
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

// The band is the size container of its tools: the expanded search field is
// `min(200px, 45cqw)` wide, 45% of the band (WP09 §1.2).
const HEADER_BAND_STYLE = {
  height: WIDGET_HEADER_HEIGHT,
  padding: WIDGET_HEADER_PADDING,
  containerType: 'inline-size',
} as const;

/** Expanded search fills the available capsule width and measures its own field against it. */
const WIDGET_SEARCH_ACTIVE_CLASS =
  'has-[[data-search-active=true]]:opacity-100 has-[[data-search-active=true]]:w-[calc(100%-16px)] has-[[data-search-active=true]]:[container-type:inline-size]';

/**
 * Header of a dashboard widget. Also rendered for placeholders (no nested
 * database), so it only depends on `WidgetContext`; the view's tools come in
 * through `actions`.
 *
 * - Titles shown: a 40px band inside the card, the same in View and Edit
 *   mode, with the title pill at the start and the tools at the end. In Edit
 *   mode the band is the drag handle.
 * - Titles hidden: a capsule floating in the card's top-right corner, with
 *   the tools and a "Widget options" button that opens the menu.
 * - A right-click anywhere on the widget box opens the menu (handled by the box).
 * - On a phone (WP14 §1.4): the tools always show, nothing drags, the menu is
 *   a bottom sheet, and the expanded search field takes the title's place.
 */
export function WidgetHeaderFrame({ actions, settingsHost }: WidgetHeaderFrameProps) {
  const { t } = useTranslation();
  const {
    editing,
    showWidgetTitles,
    setDragHandle,
    isDragging,
    menuOpen,
    setMenuOpen,
    optionsRef,
    mobileContext,
    searchActive,
  } = useWidgetContext();
  // A phone never drags (and never edits).
  const dragHandleRef = editing && !mobileContext ? setDragHandle : undefined;
  const mobileSearch = mobileContext && searchActive;

  if (!showWidgetTitles) {
    return (
      <div
        className={cn(
          'absolute right-2 top-2 z-10 flex max-w-[calc(100%-16px)] items-center rounded-400 border border-border-primary bg-surface-layer-04 p-1 shadow-toolbar',
          editing ? 'cursor-grab opacity-100' : WIDGET_TOOL_SLOT_CLASS,
          // An expanded search field keeps the capsule, and every tool in it, shown (WP09).
          !editing && WIDGET_SEARCH_ACTIVE_CLASS,
          (menuOpen || mobileContext) && 'opacity-100',
          isDragging && 'cursor-grabbing'
        )}
        data-mobile={mobileContext ? 'true' : undefined}
        data-parity-id='dash-widget-capsule'
        data-search-active={mobileSearch ? 'true' : undefined}
        data-testid='dashboard-widget-tool-capsule'
        ref={dragHandleRef}
      >
        {mobileSearch ? <MobileWidgetSearchField className='w-[min(200px,55vw)] flex-none' /> : null}
        {actions ? <div className='flex min-w-0 flex-1 items-center'>{actions}</div> : null}
        <div className='relative flex'>
          <Button
            aria-expanded={menuOpen}
            aria-haspopup='menu'
            aria-label={t('dashboard.widget.menu', { defaultValue: 'Widget options' })}
            className={DASHBOARD_ICON_BUTTON_CLASS}
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
        'flex min-w-0 shrink-0 items-center gap-1 shadow-[inset_0_-1px_0_0_var(--border-primary)]',
        mobileContext && 'gap-2',
        dragHandleRef && 'cursor-grab',
        isDragging && 'cursor-grabbing'
      )}
      data-mobile={mobileContext ? 'true' : undefined}
      data-parity-id='dash-widget-header'
      data-search-active={mobileSearch ? 'true' : undefined}
      data-testid='dashboard-widget-header'
      ref={dragHandleRef}
      style={mobileContext ? { ...HEADER_BAND_STYLE, padding: '0 8px' } : HEADER_BAND_STYLE}
    >
      {mobileSearch ? (
        <>
          {/* The field takes the title's place; the menu still opens from a right-click on the box. */}
          <MobileWidgetSearchField />
          <WidgetMenu align='start' onOpenChange={setMenuOpen} open={menuOpen}>
            <span aria-hidden='true' className='pointer-events-none absolute bottom-0 left-0 h-0 w-0' />
          </WidgetMenu>
        </>
      ) : (
        <div className='relative flex min-w-0'>
          <WidgetTitle />
          {/* The menu opens on click (a drag that starts on the pill still moves the widget), under the pill. */}
          <WidgetMenu align='start' onOpenChange={setMenuOpen} open={menuOpen}>
            <span aria-hidden='true' className='pointer-events-none absolute bottom-0 left-0 h-0 w-0' />
          </WidgetMenu>
        </div>
      )}
      {actions ? <div className='ml-auto flex shrink-0 items-center'>{actions}</div> : null}
      {settingsHost}
    </div>
  );
}

/**
 * Widget header rendered by `WidgetDatabaseViews` in place of the tab bar,
 * with the widget's tools (`WidgetActions`) where the toolbar would be.
 * Memoized: `DatabaseViews` re-renders with every row-map change of the
 * nested database, and the header only depends on `WidgetContext`.
 */
export const WidgetHeader = memo(function WidgetHeader() {
  return <WidgetHeaderFrame actions={<WidgetActions />} settingsHost={<WidgetSettingsHost />} />;
});

export default WidgetHeader;
