import { CSSProperties, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { UIVariant } from '@/application/types';
import activeIndicator from '@/assets/icons/dockable-outline/active-indicator.svg?url';
import checkIcon from '@/assets/icons/dockable-outline/check.svg?url';
import moreIcon from '@/assets/icons/dockable-outline/more.svg?url';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useInlineCommentPanelOptional } from '@/components/inline-comment/InlineCommentContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ColorEnum, renderColor, toBlockColor } from '@/utils/color';

import { useOutlineNavigation } from './OutlineNavigation';
import { flattenHeadings, nestHeadings } from './utils';
import './dockable-outline.scss';

type DisplayMode = 'always' | 'hover';
const ROW_HEIGHT = 28;
const PANEL_CHROME_HEIGHT = 72;

function MaskIcon({ asset, className }: { asset: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ maskImage: `url("${asset}")`, WebkitMaskImage: `url("${asset}")` }}
    />
  );
}

export const DockableOutline = memo(function DockableOutline() {
  const { viewId, variant } = useEditorContext();
  const navigation = useContext(AppNavigationContext);
  const comments = useInlineCommentPanelOptional();
  const { headings } = useOutlineNavigation();

  return headings.length > 2 ? (
    <DockableOutlinePanel
      key={viewId}
      published={variant === UIVariant.Publish}
      suppressed={!!navigation?.openPageModalViewId || !!comments?.isPanelOpen}
    />
  ) : null;
});

export function DockableOutlinePanel({ published, suppressed }: { published: boolean; suppressed: boolean }) {
  const { t } = useTranslation();
  const panelId = useId();
  const { headings, activeId, color, jumpToHeading, getEditorElement } = useOutlineNavigation();
  const items = useMemo(() => flattenHeadings(nestHeadings(headings)), [headings]);
  // This reader setting lasts only while the current page is open.
  const [displayMode, setDisplayMode] = useState<DisplayMode>('always');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [temporarilyCollapsed, setTemporarilyCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string>();
  const [bounds, setBounds] = useState<{ top: number; right: number; maxHeight: number }>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const skipTriggerFocus = useRef(false);
  const keyboardInput = useRef(true);
  const expanded =
    !suppressed && (hovered || focused || menuOpen || (published && displayMode === 'always' && !temporarilyCollapsed));
  const title = t('document.plugins.outline.dockableTitle');
  const blockColor = toBlockColor(color);
  const activeIndex = Math.max(
    0,
    items.findIndex(({ heading }) => heading.blockId === activeId)
  );
  const highlightedIndex = Math.max(
    0,
    items.findIndex(({ heading }) => heading.blockId === (hoveredId ?? activeId))
  );
  const panelHeight = Math.min(items.length * ROW_HEIGHT + PANEL_CHROME_HEIGHT, bounds?.maxHeight ?? 0);

  const cancelClose = useCallback(() => {
    clearTimeout(closeTimer.current);
  }, []);
  const open = useCallback(() => {
    cancelClose();
    setTemporarilyCollapsed(false);
    setHovered(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setHovered(false);
      setHoveredId(undefined);
    }, 300);
  }, [cancelClose]);

  useEffect(() => {
    const onPointerDown = () => {
      keyboardInput.current = false;
      setFocused(false);
    };

    const onKeyDown = () => {
      keyboardInput.current = true;
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelClose();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [cancelClose]);
  useEffect(() => {
    if (!suppressed) return;
    cancelClose();
    setHovered(false);
    setFocused(false);
    setHoveredId(undefined);
    setMenuOpen(false);
    // Higher-priority panels always return the outline to its indicator.
    setTemporarilyCollapsed(true);
  }, [suppressed, cancelClose]);

  useEffect(() => {
    const root = getEditorElement();

    if (!root) return;
    const viewport = root.closest<HTMLElement>('.appflowy-layout') ?? root.parentElement;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = viewport?.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight);
      const viewportTop = Math.max(0, rect?.top ?? 0);
      // Keep eight rows visible when the viewport has room, with a 40px bottom gap.
      const top = Math.max(
        viewportTop + 64,
        Math.min(viewportTop + 200, bottom - 40 - 8 * ROW_HEIGHT - PANEL_CHROME_HEIGHT)
      );
      const next = {
        top,
        right: Math.max(0, window.innerWidth - (rect?.right ?? window.innerWidth)),
        maxHeight: Math.max(ROW_HEIGHT, bottom - top - 40),
      };

      setBounds((previous) =>
        previous?.top === next.top && previous.right === next.right && previous.maxHeight === next.maxHeight
          ? previous
          : next
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const observer = new ResizeObserver(schedule);

    if (viewport) observer.observe(viewport);
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [getEditorElement]);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="location"]');

    if (!expanded || !list || !row) return;
    // Scroll only the outline list; scrollIntoView would also move the article.
    const top = row.offsetTop;

    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight)
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
  }, [activeId, activeIndex, expanded, panelHeight]);

  const changeDisplayMode = (mode: string) => {
    if (mode !== 'always' && mode !== 'hover') return;
    setDisplayMode(mode);
    setTemporarilyCollapsed(false);
  };

  if (!bounds || suppressed) return null;
  const indicatorHeight = Math.min(items.length * ROW_HEIGHT, bounds.maxHeight);
  const indicatorOffset = items.length <= 1 ? 0 : (activeIndex / (items.length - 1)) * (indicatorHeight - ROW_HEIGHT);
  const style = {
    top: bounds.top,
    right: bounds.right + 28,
    height: Math.max(indicatorHeight, panelHeight),
    '--outline-accent': renderColor(blockColor.icon),
    '--outline-hover':
      color && color !== ColorEnum.Tint10
        ? `color-mix(in srgb, ${renderColor(blockColor.bgHover)} 60%, transparent)`
        : 'var(--fill-content-hover)',
  } as CSSProperties;

  return createPortal(
    <div
      className='dockable-outline'
      data-testid='dockable-outline'
      data-expanded={expanded}
      style={style}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocusCapture={() => setFocused(keyboardInput.current)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
          scheduleClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          setFocused(true);
          return;
        }

        if (menuOpen) return;
        event.stopPropagation();
        cancelClose();
        setHovered(false);
        setFocused(false);
        setTemporarilyCollapsed(true);
        if (document.activeElement !== triggerRef.current) {
          skipTriggerFocus.current = true;
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={triggerRef}
        type='button'
        className='dockable-outline-trigger'
        data-testid='dockable-outline-trigger'
        aria-label={t('document.plugins.outline.showOutline')}
        aria-expanded={expanded}
        aria-controls={panelId}
        tabIndex={expanded ? -1 : 0}
        style={{ height: indicatorHeight }}
        onClick={open}
        onFocus={() => {
          if (skipTriggerFocus.current) {
            skipTriggerFocus.current = false;
            setFocused(false);
          } else open();
        }}
      >
        <span className='dockable-outline-track' />
        <span className='dockable-outline-marker-position' style={{ transform: `translateY(${indicatorOffset}px)` }}>
          <MaskIcon asset={activeIndicator} className='dockable-outline-marker' />
        </span>
      </button>
      <nav
        id={panelId}
        aria-label={title}
        aria-hidden={!expanded}
        className='dockable-outline-panel'
        style={{ height: panelHeight }}
      >
        <div className='dockable-outline-header'>
          <span className='min-w-0 flex-1 truncate text-base font-semibold leading-[22px]'>{title}</span>
          {published && (
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='dockable-outline-more'
                  aria-label={t('document.plugins.outline.displayOptions')}
                  tabIndex={expanded ? 0 : -1}
                >
                  <MaskIcon asset={moreIcon} className='dockable-outline-icon' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='rounded-xl bg-surface-layer-04'
                onMouseEnter={open}
                onMouseLeave={scheduleClose}
              >
                <DropdownMenuRadioGroup value={displayMode} onValueChange={changeDisplayMode}>
                  {(['always', 'hover'] as const).map((mode) => (
                    <DropdownMenuRadioItem
                      key={mode}
                      value={mode}
                      className='cursor-pointer gap-2 rounded-[6px] data-[state=checked]:bg-fill-content-hover'
                    >
                      <span className='flex-1'>
                        {t(`document.plugins.outline.${mode === 'always' ? 'alwaysShow' : 'showOnHover'}`)}
                      </span>
                      {displayMode === mode && (
                        <MaskIcon asset={checkIcon} className='dockable-outline-icon text-icon-info-thick' />
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div
          ref={listRef}
          className='dockable-outline-list appflowy-scroller'
          onMouseLeave={() => setHoveredId(undefined)}
        >
          <div className='dockable-outline-list-content'>
            <span className='dockable-outline-list-track' />
            <span
              className='dockable-outline-list-marker'
              style={{ transform: `translateY(${highlightedIndex * ROW_HEIGHT}px)` }}
            >
              <MaskIcon asset={activeIndicator} className='dockable-outline-marker' />
            </span>
            {items.map(({ heading, indent }) => (
              <button
                key={heading.blockId}
                type='button'
                aria-current={heading.blockId === activeId ? 'location' : undefined}
                title={heading.data.text || t('document.plugins.outline.untitledHeading')}
                className='dockable-outline-item'
                style={{ paddingLeft: 8 + indent * 12 }}
                tabIndex={expanded ? 0 : -1}
                onMouseEnter={() => setHoveredId(heading.blockId)}
                onClick={() => jumpToHeading(heading)}
              >
                <span className='truncate'>{heading.data.text || t('document.plugins.outline.untitledHeading')}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </div>,
    document.body
  );
}
