import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTransformEffect, type ReactZoomPanPinchContextState } from 'react-zoom-pan-pinch';

import { ReactComponent as BackIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as DrillIcon } from '@/assets/icons/arrow_right.svg';

import { overlapArea, positionMapPopover } from './mindmap-popover';
import { Action } from './ui';

import type { MapPosition } from './mindmap-layout';
import type { MapRect, MapPopoverSide } from './mindmap-popover';
import type { MapNode } from './types';

/** Map controls the card must not cover. */
const mapOverlays = '.ps-map-controls, .ps-map-breadcrumbs, .ps-map-close';

export default function MindMapNodePopover({
  container,
  node,
  position,
  sourceNumbers,
  canDrill,
  canParent,
  modifierLabel,
  modifierKey,
  onClose,
  onDrill,
  onParent,
  onSource,
  onSave,
}: {
  container: HTMLElement | null;
  node: MapNode;
  /** The node's place in the current layout. A new layout can move the node or its neighbours. */
  position?: MapPosition;
  sourceNumbers: ReadonlyMap<string, number>;
  canDrill: boolean;
  canParent: boolean;
  modifierLabel: string;
  modifierKey: string;
  onClose: () => void;
  onDrill: () => void;
  onParent: () => void;
  onSource: (id: string) => void;
  onSave?: (node: MapNode) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [summary, setSummary] = useState(node.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement>();
  const frame = useRef<number>();
  const heading = useId();
  const update = useCallback(() => {
    if (!container || !panel.current) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>('.ps-map-node'));
    const selected = elements.find((el) => el.dataset.nodeId === node.id);

    anchor.current = selected;
    if (!selected) {
      panel.current.style.visibility = 'hidden';
      return;
    }

    const origin = container.getBoundingClientRect();
    const originX = origin.left + container.clientLeft;
    const originY = origin.top + container.clientTop;
    const rect = (el: Element): MapRect => {
      const box = el.getBoundingClientRect();

      return { x: box.left - originX, y: box.top - originY, width: box.width, height: box.height };
    };

    const bounds = {
      x: Math.max(12, 12 - originX),
      y: Math.max(12, 12 - originY),
      width: 0,
      height: 0,
    };

    bounds.width = Math.max(1, Math.min(container.clientWidth, innerWidth - originX) - bounds.x - 12);
    bounds.height = Math.max(1, Math.min(container.clientHeight, innerHeight - originY) - bounds.y - 12);
    const visibleBounds = { ...bounds };
    const controls = container.querySelector('.ps-map-controls');
    const toolbar = controls && rect(controls);

    const selectedRect = rect(selected);

    if (!overlapArea(selectedRect, visibleBounds)) {
      panel.current.style.visibility = 'hidden';
      return;
    }

    const width = Math.min(300, bounds.width);
    const horizontalRoom =
      Math.max(selectedRect.x - bounds.x, bounds.x + bounds.width - selectedRect.x - selectedRect.width) - 16;

    // On narrow screens use the space above the toolbar. On wide screens the
    // card can sit beside it; keep those lower corner positions available.
    if (horizontalRoom < width && toolbar?.height) {
      bounds.height = Math.max(1, Math.min(bounds.height, toolbar.y - bounds.y - 12));
    }

    // Batch reads before positioning; only this overlay changes during pan/zoom.
    const obstacles = [...elements.filter((el) => el !== selected), ...container.querySelectorAll(mapOverlays)]
      .map(rect)
      .filter((box) => box.width && box.height && overlapArea(box, bounds));

    panel.current.style.maxWidth = `${bounds.width}px`;
    const verticalRoom =
      Math.max(selectedRect.y - bounds.y, bounds.y + bounds.height - selectedRect.y - selectedRect.height) - 16;

    panel.current.style.maxHeight = `${Math.min(
      400,
      bounds.height,
      horizontalRoom < width ? Math.max(160, verticalRoom) : 400
    )}px`;
    const side = selected.dataset.side;
    const preferred: MapPopoverSide = side === 'down' ? 'bottom' : side === 'left' ? 'left' : 'right';
    const position = positionMapPopover(
      selectedRect,
      {
        width: panel.current.offsetWidth,
        height: panel.current.offsetHeight,
      },
      bounds,
      obstacles,
      preferred
    );

    panel.current.style.left = `${position.x}px`;
    panel.current.style.top = `${position.y}px`;
    panel.current.style.setProperty('--ps-node-arrow-x', `${position.arrowX}px`);
    panel.current.style.setProperty('--ps-node-arrow-y', `${position.arrowY}px`);
    panel.current.dataset.side = position.side;
    panel.current.style.visibility = 'visible';
  }, [container, node.id]);
  // Pan, zoom, scroll and window resize events can arrive several times per frame; place once per frame.
  const schedule = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      update();
    });
  }, [update]);
  // The transform library updates CSS directly while panning, without a React render. Its
  // animations already step once per frame, so follow those steps without a frame's delay.
  const follow = useCallback(
    ({ instance }: ReactZoomPanPinchContextState) => (instance.animation ? update() : schedule()),
    [update, schedule]
  );

  useTransformEffect(follow);
  // Place before paint when the card opens and whenever a new layout can move its node.
  useLayoutEffect(() => update(), [update, position]);
  useLayoutEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!container || !panel.current) return;
    // Size changes are reported once per frame after layout; placing now avoids a frame at the old position.
    const observer = new ResizeObserver(update);

    observer.observe(panel.current);
    observer.observe(container);
    // Fullscreen shows and hides these overlays without a React render.
    container.querySelectorAll(mapOverlays).forEach((overlay) => observer.observe(overlay));
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [container, update, schedule]);
  useEffect(() => {
    let start: { x: number; y: number } | undefined;
    const down = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };

    const up = (event: PointerEvent) => {
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const target = event.target;

      if (!(target instanceof Element) || panel.current?.contains(target)) return;
      // Keep the card open while zooming, panning, or switching to another node.
      if (
        container?.contains(target) &&
        target.closest('.ps-map-node, .ps-map-controls, .ps-map-style-picker, [role="menu"]')
      )
        return;
      onClose();
    };

    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [container, onClose]);

  const dismiss = () => {
    anchor.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    onClose();
  };

  return (
    <div
      ref={panel}
      role='dialog'
      aria-modal='false'
      aria-labelledby={heading}
      className='ps-node-detail'
      tabIndex={-1}
      data-presentation-escape-layer
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <span className='ps-node-detail-arrow' aria-hidden='true' />
      <div className='ps-node-detail-card'>
        <div className='ps-node-detail-header'>
          <h3 id={heading}>{node.label}</h3>
          <Action aria-label='Close node details' title='Close (Esc)' onClick={dismiss}>
            <X size={16} />
          </Action>
        </div>
        <div className='ps-node-detail-content'>
          {editing ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!onSave || saving || !label.trim()) return;
                setSaving(true);
                setError('');
                try {
                  await onSave({ ...node, label: node.parentId ? label.trim() : node.label, summary });
                  setEditing(false);
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : 'Unable to save node.');
                } finally {
                  setSaving(false);
                }
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <label>
                Node label
                <input
                  aria-label='Node label'
                  value={label}
                  maxLength={150}
                  disabled={!node.parentId || saving}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <label>
                Node summary
                <textarea
                  aria-label='Node summary'
                  value={summary}
                  disabled={saving}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              {error && <p role='alert'>{error}</p>}
              <button type='submit' disabled={saving || !label.trim()}>
                {saving ? 'Saving…' : 'Save node'}
              </button>
              <button type='button' disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <p>{node.summary || 'This node follows the source page structure.'}</p>
              {onSave && (
                <Action
                  onClick={() => {
                    setLabel(node.label);
                    setSummary(node.summary);
                    setEditing(true);
                  }}
                >
                  Edit node
                </Action>
              )}
            </>
          )}
        </div>
        <div className='ps-node-detail-footer'>
          <div className='ps-node-sources' role='group' aria-label='Sources'>
            {node.sourceIds.map((id) => {
              const number = sourceNumbers.get(id)!;

              return (
                <Tooltip
                  key={id}
                  placement='top'
                  disableInteractive
                  PopperProps={{ container }}
                  title={`Source ${number} · ${id}`}
                >
                  <button
                    type='button'
                    className='ps-node-source'
                    style={number >= 100 ? { fontSize: 10 } : undefined}
                    aria-label={`Open source ${number}: ${id}`}
                    onClick={() => onSource(id)}
                  >
                    {number}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <div className='ps-node-detail-nav' role='group' aria-label='Node navigation'>
            {[
              { label: 'Back to parent node', key: '[', Icon: BackIcon, enabled: canParent, action: onParent },
              { label: 'Drill down', key: ']', Icon: DrillIcon, enabled: canDrill, action: onDrill },
            ].map(({ label, key, Icon, enabled, action }) => (
              <Tooltip
                key={key}
                placement='top'
                disableInteractive
                PopperProps={{ container }}
                title={
                  <div className='ps-map-tool-tooltip'>
                    <span>{label}</span>
                    <kbd>{`${modifierLabel} + ${key}`}</kbd>
                  </div>
                }
              >
                <span className='ps-map-tool-trigger'>
                  <IconButton
                    size='small'
                    aria-label={label}
                    aria-keyshortcuts={`${modifierKey}+${key}`}
                    disabled={!enabled}
                    onClick={action}
                  >
                    <Icon className='h-5 w-5' aria-hidden='true' />
                  </IconButton>
                </span>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
