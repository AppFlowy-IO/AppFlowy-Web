import Dialog from '@mui/material/Dialog';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { ArrowRight, ChevronLeft, ChevronRight, ChevronUp, Expand, Sparkles, X } from 'lucide-react';
import { memo, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

import { getMermaidTheme } from '@/components/editor/components/blocks/code/mermaidTheme';
import { isMac } from '@/utils/hotkeys';

import { collapseBranches, expandBranch, indexMap, initialCollapsed, layoutMap, mapBranchPath } from './mindmap-layout';
import MindMapNodePopover from './MindMapNodePopover';
import MindMapToolbar from './MindMapToolbar';
import PresentationPaywall from './PresentationPaywall';
import { MapNode, MindMap, MapOrigin } from './types';
import { Action, Notice } from './ui';
import { usePresentationFullscreen } from './usePresentationFullscreen';

import type { MapBranchLine, MapStructure, MapPosition } from './mindmap-layout';

/** Whole-pixel canvas size; keeps the current state when it is unchanged or the canvas is hidden (zero-sized). */
const resizeTo = (width: number, height: number) => (old: { width: number; height: number }) => {
  const next = { width: Math.round(width), height: Math.round(height) };

  return !next.width || !next.height || (next.width === old.width && next.height === old.height) ? old : next;
};

/** Selection changes only the old and new node; camera changes leave every node intact. */
const MindMapNode = memo(function MindMapNode({
  p,
  nodeIndex,
  structure,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onMenu,
  onKey,
}: {
  p: MapPosition;
  nodeIndex: number;
  structure: MapStructure;
  selected: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onMenu: (menu: { nodeId: string; x: number; y: number }) => void;
  onKey: (event: KeyboardEvent<HTMLButtonElement>, position: MapPosition, index: number) => void;
}) {
  return (
    <div
      className={`ps-map-node ${p.depth === 0 ? 'ps-map-root' : ''} ${selected ? 'ps-map-selected' : ''}`}
      style={{ left: p.x, top: p.y }}
      data-node-id={p.node.id}
      data-side={structure === 'down' || p.side === 0 ? 'down' : p.side < 0 ? 'left' : 'right'}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ nodeId: p.node.id, x: event.clientX, y: event.clientY });
      }}
      key={p.node.id}
    >
      <button
        title={p.node.label}
        onClick={() => onSelect(p.node.id)}
        aria-pressed={selected}
        aria-haspopup='dialog'
        aria-expanded={selected}
        onKeyDown={(e) => onKey(e, p, nodeIndex)}
        data-node-index={nodeIndex}
      >
        <span>{p.node.label}</span>
      </button>
      {p.descendantCount > 0 && (
        <button
          className={`ps-map-collapse${collapsed ? ' ps-map-collapsed' : ''}`}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${p.node.label}`}
          title={collapsed ? `Expand ${p.descendantCount} hidden nodes` : 'Collapse child nodes'}
          aria-expanded={!collapsed}
          onClick={() => onToggle(p.node.id)}
        >
          {collapsed ? (
            p.descendantCount
          ) : structure === 'down' || p.side === 0 ? (
            <ChevronUp size={14} />
          ) : p.side < 0 ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronLeft size={14} />
          )}
        </button>
      )}
    </div>
  );
});

export default function MindMapViewer({
  onUpgrade,
  generationPaywall,
  map,
  origin,
  onMapChange,
  mapStyle,
  onStyleChange,
  canGenerate,
  onGenerate,
  generateLabel,
  onSlides,
  onSource,
  onClosePresentation,
}: {
  onUpgrade?: () => void;
  generationPaywall?: string;
  map: MindMap;
  origin?: MapOrigin;
  onMapChange?: (map: MindMap) => Promise<void>;
  mapStyle?: { structure: MapStructure; branchLine: MapBranchLine };
  onStyleChange?: (style: { structure: MapStructure; branchLine: MapBranchLine }) => Promise<void>;
  canGenerate: boolean;
  onGenerate: () => void;
  generateLabel?: string;
  onSlides: () => void;
  onSource: (id: string) => void;
  onClosePresentation?: () => void;
}) {
  const mac = isMac();
  const modifierLabel = mac ? '⌘' : 'Ctrl';
  const modifierKey = mac ? 'Meta' : 'Control';
  const index = useMemo(() => indexMap(map), [map]);
  const [menu, setMenu] = useState<{ nodeId?: string; x: number; y: number }>();
  const anchor = useRef<{ id: string; x: number; y: number; positionX: number; positionY: number; scale: number }>();
  const [enlarged, setEnlarged] = useState(false);
  const expanded = enlarged || !!onClosePresentation;
  const closeExpanded = () => {
    if (onClosePresentation) onClosePresentation();
    else setEnlarged(false);
  };

  const transform = useRef<ReactZoomPanPinchRef>(null);
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(index));
  const [structure, setStructure] = useState<MapStructure>(mapStyle?.structure ?? 'right');
  const [branchLine, setBranchLine] = useState<MapBranchLine>(mapStyle?.branchLine ?? 'rounded');
  const [savedStyle, setSavedStyle] = useState(mapStyle);
  const [styleError, setStyleError] = useState('');
  const styleSaving = useRef(false);

  // Adopt a new saved style during render, so the map never paints or fits with the previous style first.
  if (savedStyle?.structure !== mapStyle?.structure || savedStyle?.branchLine !== mapStyle?.branchLine) {
    setSavedStyle(mapStyle);
    setStructure(mapStyle?.structure ?? 'right');
    setBranchLine(mapStyle?.branchLine ?? 'rounded');
  }

  async function changeStyle(next: { structure: MapStructure; branchLine: MapBranchLine }) {
    if (styleSaving.current) return;
    styleSaving.current = true;
    setStyleError('');
    try {
      await onStyleChange?.(next);
      setStructure(next.structure);
      setBranchLine(next.branchLine);
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : 'Unable to save map style.');
    } finally {
      styleSaving.current = false;
    }
  }

  const renderedStructure = useRef(structure);
  const [selectedId, setSelectedId] = useState<string>();
  // Read the node from the current map, so saves and other map updates never leave a stale copy.
  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const clearSelection = useCallback(() => setSelectedId(undefined), []);
  const [focused, setFocused] = useState<string>();
  const host = useRef<HTMLDivElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  const renderedViewport = useRef(viewport);
  const setHost = useCallback((element: HTMLDivElement | null) => {
    host.current = element;
    setCanvasElement(element);
    // Measure on mount, before the first paint, instead of waiting for the resize observer.
    if (element) setViewport(resizeTo(element.clientWidth, element.clientHeight));
  }, []);
  const fullscreen = usePresentationFullscreen(host);

  useEffect(() => {
    if (!canvasElement) return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport(resizeTo(entry.contentRect.width, entry.contentRect.height))
    );

    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [canvasElement]);
  useEffect(() => {
    if (host.current) host.current.dataset.controlsVisible = 'false';
    if (fullscreen.active) host.current?.focus();
  }, [fullscreen.active]);
  useEffect(() => {
    host.current?.focus({ preventScroll: true });
  }, [focused]);
  const layout = useMemo(() => layoutMap(index, collapsed, focused, structure), [index, collapsed, focused, structure]);
  const byId = useMemo(() => new Map(layout.positions.map((p) => [p.node.id, p])), [layout]);
  const branchPaths = useMemo(
    () =>
      layout.positions.map((p) => {
        const parent = p.node.parentId ? byId.get(p.node.parentId) : undefined;

        return parent ? <path key={p.node.id} d={mapBranchPath(parent, p, structure, branchLine)} /> : null;
      }),
    [layout, byId, structure, branchLine]
  );
  const fitScale = Math.min(1, viewport.width / layout.width, viewport.height / layout.height) * 0.9;
  const minScale = Math.min(0.05, fitScale);
  const fit = () => transform.current?.centerView(fitScale, 200);
  const breadcrumbs: MapNode[] = [];
  let ancestor: MapNode | undefined = layout.root;

  while (ancestor) {
    breadcrumbs.unshift(ancestor);
    ancestor = ancestor.parentId ? index.byId.get(ancestor.parentId) : undefined;
  }

  // Retain the clicked node's screen position and the user's zoom when folding.
  useLayoutEffect(() => {
    if (renderedStructure.current !== structure || renderedViewport.current !== viewport) {
      renderedStructure.current = structure;
      renderedViewport.current = viewport;
      anchor.current = undefined;
      // A new structure resizes the canvas, and a resized viewport needs a new fit; refit in
      // place instead of remounting. The pan/zoom resize observer cancels animations, so
      // apply the complete fit before it observes the new bounds.
      transform.current?.centerView(fitScale, 0);
      return;
    }

    const pending = anchor.current;
    const node = pending && layout.positions.find((p) => p.node.id === pending.id);

    if (pending && node) {
      transform.current?.setTransform(
        pending.positionX + (pending.x - node.x) * pending.scale,
        pending.positionY + (pending.y - node.y) * pending.scale,
        pending.scale,
        0
      );
    }

    anchor.current = undefined;
  }, [layout, structure, fitScale, viewport]);

  const anchorNode = useCallback(
    (id: string) => {
      const node = byId.get(id);
      const state = transform.current?.instance.transformState;

      if (node && state) anchor.current = { id, x: node.x, y: node.y, ...state };
    },
    [byId]
  );

  const toggleBranch = useCallback(
    (id: string) => {
      anchorNode(id);
      setCollapsed((old) => (old.has(id) ? expandBranch(index, old, id) : new Set([...old, id])));
      setSelectedId((old) => (old && index.descendants.get(id)?.includes(old) ? undefined : old));
      setMenu(undefined);
    },
    [anchorNode, index]
  );

  const drillDown = useCallback(
    (id: string) => {
      anchor.current = undefined;
      setFocused(id === index.root.id ? undefined : id);
      setSelectedId(undefined);
      setMenu(undefined);
      setCollapsed((old) => {
        const next = new Set(old);

        next.delete(id);
        return next;
      });
    },
    [index]
  );

  const selectNode = useCallback((id: string) => setSelectedId((old) => (old === id ? undefined : id)), []);
  const nodeKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, p: MapPosition, nodeIndex: number) => {
      if (e.altKey && e.key === 'Enter') {
        e.preventDefault();
        drillDown(p.node.id);
        return;
      }

      const vertical = structure === 'down' || p.side === 0;
      const outwardKey = vertical ? 'ArrowDown' : p.side < 0 ? 'ArrowLeft' : 'ArrowRight';
      const inwardKey = vertical ? 'ArrowUp' : p.side < 0 ? 'ArrowRight' : 'ArrowLeft';

      if (e.key === outwardKey || e.key === inwardKey) {
        e.preventDefault();
        const outward = e.key === outwardKey;

        if (outward && collapsed.has(p.node.id)) toggleBranch(p.node.id);
        else if (!outward && p.descendantCount && !collapsed.has(p.node.id)) toggleBranch(p.node.id);
        else {
          const targetId = outward ? index.children.get(p.node.id)?.[0]?.id : p.node.parentId;
          const targetIndex = layout.positions.findIndex((position) => position.node.id === targetId);

          host.current?.querySelector<HTMLButtonElement>(`[data-node-index="${targetIndex}"]`)?.focus();
        }

        return;
      }

      const nextKey = vertical ? 'ArrowRight' : 'ArrowDown';
      const previousKey = vertical ? 'ArrowLeft' : 'ArrowUp';

      if (e.key === nextKey || e.key === previousKey) {
        e.preventDefault();
        const target =
          layout.positions[
            (nodeIndex + (e.key === nextKey ? 1 : layout.positions.length - 1)) % layout.positions.length
          ];

        host.current
          ?.querySelector<HTMLButtonElement>(`[data-node-index="${layout.positions.indexOf(target)}"]`)
          ?.focus();
      }
    },
    [structure, collapsed, index, layout, drillDown, toggleBranch]
  );

  const changeAllBranches = (collapse: boolean) => {
    anchorNode(layout.root.id);
    setCollapsed((old) =>
      collapse ? collapseBranches(index, old, layout.root.id) : expandBranch(index, old, layout.root.id)
    );
    setSelectedId(undefined);
    setMenu(undefined);
  };

  const menuNode = menu?.nodeId ? index.byId.get(menu.nodeId) : undefined;

  const originLabel =
    origin === 'ai'
      ? 'AI mind map'
      : origin === 'fixture'
      ? 'Sample map · no AI'
      : origin === 'imported'
      ? 'Imported AI response'
      : 'From page structure';

  const canvas = (
    <div
      className={`ps-map-canvas${expanded ? ' ps-map-expanded' : ''}`}
      ref={setHost}
      role='region'
      aria-label='Interactive mind map'
      tabIndex={0}
      data-structure={structure}
      data-branch-line={branchLine}
      data-presentation-escape-layer={selected ? '' : undefined}
      style={{ fontFamily: getMermaidTheme(false).themeVariables!.fontFamily }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('button, aside, nav, [role="menu"]')) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        // Only fullscreen CSS reads these bands. Set them on the element so pointer moves never render the map.
        const { dataset } = event.currentTarget;
        const rect = event.currentTarget.getBoundingClientRect();

        dataset.controlsVisible = String(event.clientY > rect.bottom - 100);
        dataset.navigationVisible = String(event.clientY < rect.top + 80);
      }}
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        const modifierPressed = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

        if (
          event.defaultPrevented ||
          !modifierPressed ||
          event.altKey ||
          event.shiftKey ||
          (event.key !== '[' && event.key !== ']') ||
          target.isContentEditable ||
          target.closest('input, textarea, select, .ps-map-style-picker')
        )
          return;

        // These keys navigate browser history by default on macOS. Keep them
        // within the map even at the root or when there is no node to drill into.
        event.preventDefault();
        event.stopPropagation();
        if (event.key === '[') {
          if (focused) drillDown(layout.root.parentId ?? index.root.id);
        } else {
          const nodeId = target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? menu?.nodeId ?? selected?.id;

          if (nodeId && nodeId !== layout.root.id && byId.has(nodeId)) drillDown(nodeId);
        }
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Escape' && selected) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
          return;
        }

        if (event.key === 'Escape' && onClosePresentation && !fullscreen.active) {
          event.preventDefault();
          event.stopPropagation();
          closeExpanded();
          return;
        }

        if (event.key === 'Escape' && focused && !fullscreen.active) {
          event.preventDefault();
          event.stopPropagation();
          drillDown(layout.root.parentId ?? index.root.id);
          return;
        }

        if (event.key === '+' || event.key === '=') transform.current?.zoomIn(0.2);
        else if (event.key === '-') transform.current?.zoomOut(0.2);
        else if (event.key === '0' || event.key.toLowerCase() === 'f') fit();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {styleError && (
        <p role='alert' className='absolute left-4 top-4 z-50'>
          {styleError}
        </p>
      )}
      <TransformWrapper
        // Remount only to fit a new drill-down root. A resized canvas refits in place.
        key={focused ?? 'all'}
        ref={transform}
        initialScale={fitScale}
        minScale={minScale}
        maxScale={4}
        centerOnInit
        limitToBounds={false}
        // Free panning must not snap back or cancel a Fit command when wheel zoom settles.
        alignmentAnimation={{ disabled: true }}
        panning={{ excluded: ['button'], velocityDisabled: true }}
        doubleClick={{ excluded: ['button'] }}
      >
        {({ zoomIn, zoomOut, centerView }) => (
          <>
            <TransformComponent
              // Pan/zoom owns the camera. A hidden overflow scroll container lets
              // browser focus scroll a heavily scaled node out of its transform.
              wrapperStyle={{ width: '100%', height: '100%', overflow: 'clip' }}
              contentStyle={{ width: layout.width, height: layout.height }}
            >
              <div className='ps-map-content' style={{ width: layout.width, height: layout.height }}>
                <svg className='ps-map-lines' width={layout.width} height={layout.height} aria-hidden='true'>
                  {branchPaths}
                </svg>
                {layout.positions.map((p, nodeIndex) => (
                  <MindMapNode
                    key={p.node.id}
                    p={p}
                    nodeIndex={nodeIndex}
                    structure={structure}
                    selected={selected?.id === p.node.id}
                    collapsed={collapsed.has(p.node.id)}
                    onSelect={selectNode}
                    onToggle={toggleBranch}
                    onMenu={setMenu}
                    onKey={nodeKey}
                  />
                ))}
              </div>
            </TransformComponent>
            <MindMapToolbar
              container={canvasElement}
              minZoom={Math.round(minScale * 100)}
              focused={!!focused}
              canDrill={!!selected && selected.id !== layout.root.id}
              fullscreen={fullscreen}
              structure={structure}
              branchLine={branchLine}
              onStructure={(value) => void changeStyle({ structure: value, branchLine })}
              onBranchLine={(value) => void changeStyle({ structure, branchLine: value })}
              onZoomOut={() => zoomOut(0.2)}
              onZoomIn={() => zoomIn(0.2)}
              onReset={() => centerView(1)}
              onFit={fit}
              onCollapse={() => changeAllBranches(true)}
              onExpand={() => changeAllBranches(false)}
              onDrill={() => selected && drillDown(selected.id)}
              onParent={() => drillDown(layout.root.parentId ?? index.root.id)}
              onShowAll={() => drillDown(index.root.id)}
            />
            {selected && (
              <MindMapNodePopover
                key={selected.id}
                container={canvasElement}
                node={selected}
                position={byId.get(selected.id)}
                sourceNumbers={index.sourceNumbers}
                canDrill={selected.id !== layout.root.id}
                canParent={!!focused}
                modifierLabel={modifierLabel}
                modifierKey={modifierKey}
                onClose={clearSelection}
                onDrill={() => drillDown(selected.id)}
                onParent={() => drillDown(layout.root.parentId ?? index.root.id)}
                onSource={onSource}
                onSave={
                  onMapChange
                    ? async (next) => {
                        await onMapChange({
                          ...map,
                          nodes: map.nodes.map((node) => (node.id === next.id ? next : node)),
                        });
                      }
                    : undefined
                }
              />
            )}
          </>
        )}
      </TransformWrapper>
      {onClosePresentation && generateLabel && (
        <Action className='absolute left-4 top-4 z-10' disabled={!canGenerate} onClick={onGenerate}>
          <Sparkles size={16} />
          {generateLabel}
        </Action>
      )}
      {expanded && (
        <Action
          className='ps-map-close'
          aria-label='Close enlarged mind map'
          title='Close (Esc)'
          onClick={closeExpanded}
        >
          <X size={20} />
        </Action>
      )}
      {focused && (
        <nav className='ps-map-breadcrumbs' aria-label='Mind map location'>
          {breadcrumbs.map((node, i) => (
            <div key={node.id}>
              {i > 0 && <ChevronRight size={13} aria-hidden='true' />}
              <button
                title={node.label}
                aria-current={node.id === layout.root.id ? 'location' : undefined}
                onClick={() => drillDown(node.id)}
              >
                {node.label}
              </button>
            </div>
          ))}
        </nav>
      )}
      {generationPaywall && onUpgrade && (
        <div className='absolute left-4 right-16 top-20 z-10 mx-auto max-w-xl'>
          <PresentationPaywall message={generationPaywall} onUpgrade={onUpgrade} />
        </div>
      )}
      {!selected && !focused && <span className='ps-map-hint'>Drag to pan · Scroll or +/− to zoom · F to fit</span>}
      <Menu
        open={!!menu}
        onClose={() => setMenu(undefined)}
        anchorReference='anchorPosition'
        anchorPosition={menu ? { left: menu.x, top: menu.y } : undefined}
        disablePortal
        disableRestoreFocus
        slotProps={{ backdrop: { style: { backgroundColor: 'transparent' } } }}
        container={canvasElement}
        MenuListProps={{ 'aria-label': menuNode ? `Actions for ${menuNode.label}` : 'Mind map actions' }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {menuNode
          ? [
              <MenuItem
                key='drill'
                disabled={menuNode.id === layout.root.id}
                aria-keyshortcuts={`${modifierKey}+]`}
                onClick={() => drillDown(menuNode.id)}
              >
                Drill down
                <kbd className='ps-map-shortcut' aria-hidden='true'>{`${modifierLabel} + ]`}</kbd>
              </MenuItem>,
              index.children.has(menuNode.id) && (
                <MenuItem key='fold' onClick={() => toggleBranch(menuNode.id)}>
                  {collapsed.has(menuNode.id) ? 'Expand child nodes' : 'Collapse child nodes'}
                </MenuItem>
              ),
              <MenuItem
                key='details'
                onClick={() => {
                  setSelectedId(menuNode.id);
                  setMenu(undefined);
                }}
              >
                View details and source
              </MenuItem>,
            ]
          : [
              <MenuItem key='collapse' onClick={() => changeAllBranches(true)}>
                Collapse all
              </MenuItem>,
              <MenuItem key='expand' onClick={() => changeAllBranches(false)}>
                Expand all
              </MenuItem>,
              <MenuItem
                key='fit'
                onClick={() => {
                  fit();
                  setMenu(undefined);
                }}
              >
                Fit to screen
              </MenuItem>,
            ]}
      </Menu>
    </div>
  );

  const preview = (
    <Dialog open fullScreen onClose={closeExpanded} PaperProps={{ className: 'ps-root ps-map-preview-dialog' }}>
      {canvas}
    </Dialog>
  );

  // A presentation fills the caller's full-screen surface, where this canvas replaces the loading state in
  // place; a dialog of its own would open as a second page.
  if (onClosePresentation) return canvas;

  return (
    <div className='ps-map-page'>
      <div className='ps-page-heading'>
        <div>
          <span className='ps-eyebrow'>A DIFFERENT PERSPECTIVE</span>
          <h1>See how it all connects.</h1>
          <p>
            {origin === 'ai'
              ? 'Generated from this document. Explore each theme and its source.'
              : origin === 'fixture'
              ? 'Sample output for testing the viewer. No AI model was used.'
              : origin === 'imported'
              ? 'Imported response · Review each branch against its source.'
              : 'Explore your page structure, or let AI summarize and organize its ideas.'}
          </p>
        </div>
        <Action primary disabled={!canGenerate} onClick={onGenerate}>
          <Sparkles size={16} />
          {generateLabel ?? (origin === 'ai' ? 'Regenerate with AI' : 'Generate with AI')}
        </Action>
      </div>
      <div className='ps-map-toolbar'>
        <div className='ps-inline'>
          <span className='ps-tag'>{originLabel}</span>
          <span className='ps-muted'>
            {layout.positions.length} of {map.nodes.length} nodes visible
          </span>
        </div>
        <div className='ps-inline ps-wrap'>
          <Action onClick={() => setEnlarged(true)}>
            <Expand size={15} />
            Enlarge mind map
          </Action>
          <Action onClick={onSlides}>
            Create AI Slides from this mind map
            <ArrowRight size={15} />
          </Action>
        </div>
      </div>
      {styleError && <p role='alert'>{styleError}</p>}
      {map.warnings.map((warning) => (
        <Notice key={warning}>{warning}</Notice>
      ))}
      {expanded ? preview : canvas}
    </div>
  );
}
