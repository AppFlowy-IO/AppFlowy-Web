import { act, fireEvent, render, screen } from '@testing-library/react';
import { CSSProperties, useRef, useState, useSyncExternalStore } from 'react';

import {
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardWidget,
} from '@/application/database-yjs/dashboard.type';

import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '../constants';
import { ROW_HEIGHT_CSS_VARIABLE, useRowHeightResize } from '../hooks/useRowHeightResize';
import { applyWidthPreview, useWidthResize } from '../hooks/useWidthResize';

// jsdom has no PointerEvent (and `fireEvent.pointerDown` would drop the
// coordinates); a MouseEvent named after the pointer event carries them.
function pointer(type: string, init: { clientX?: number; clientY?: number; pointerId?: number; button?: number } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });

  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  return event;
}

function movePointer(clientX: number, clientY = 0, pointerId = 1) {
  act(() => {
    document.dispatchEvent(pointer('pointermove', { clientX, clientY, pointerId }));
  });
}

function releasePointer(pointerId = 1) {
  act(() => {
    document.dispatchEvent(pointer('pointerup', { pointerId }));
  });
}

function widgets(...widths: number[]): DashboardWidget[] {
  return widths.map((width, index) => ({ id: `w${index}`, viewId: `v${index}`, databaseId: 'db', width }));
}

// A 1824 px track with 12 px gaps: with three widgets one column pitch is
// exactly 150 px, and the resize minimum is 2 columns (240 px is 1.6 columns).
const ROW_WIDTH = 1824;

function WidthProbe({
  items,
  enabled = true,
  rowWidth = ROW_WIDTH,
  onCommit,
}: {
  items: DashboardWidget[];
  enabled?: boolean;
  rowWidth?: number;
  onCommit: (index: number, delta: number, minColumns: number) => void;
}) {
  const { preview, startResize, handleKeyDown } = useWidthResize({
    widgets: items,
    enabled,
    getRowElement: () => ({ getBoundingClientRect: () => ({ width: rowWidth }) } as HTMLElement),
    onCommit,
  });

  return (
    <div>
      <output data-testid='widths'>{applyWidthPreview(items, preview).join(',')}</output>
      <div
        data-testid='handle'
        onKeyDown={(event) => handleKeyDown(0, event)}
        onPointerDown={(event) => startResize(0, event)}
        role='separator'
        tabIndex={0}
      />
    </div>
  );
}

function HeightProbe({
  height,
  enabled = true,
  onCommit,
}: {
  height: number;
  enabled?: boolean;
  onCommit: (height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const resize = useRowHeightResize({ height, enabled, onCommit, getRowElement: () => rowRef.current });
  const preview = useSyncExternalStore(resize.preview.subscribe, resize.preview.get);
  // Like DashboardRow: the style prop only seeds the variable, the hook owns it.
  const [initialHeight] = useState(height);

  return (
    <div data-testid='row' ref={rowRef} style={{ [ROW_HEIGHT_CSS_VARIABLE]: `${initialHeight}px` } as CSSProperties}>
      <output data-testid='height'>{preview ?? height}</output>
      <output data-testid='previewing'>{String(resize.dragging)}</output>
      <div
        data-testid='handle'
        onKeyDown={resize.handleKeyDown}
        onPointerDown={resize.startResize}
        role='separator'
        tabIndex={0}
      />
    </div>
  );
}

/** Persists every commit, as the dashboard's layout store does. */
function PersistingHeightProbe({
  initialHeight,
  onCommit,
}: {
  initialHeight: number;
  onCommit: (height: number) => void;
}) {
  const [height, setHeight] = useState(initialHeight);

  return (
    <HeightProbe
      height={height}
      onCommit={(next) => {
        onCommit(next);
        setHeight(next);
      }}
    />
  );
}

const rowHeightVariable = () => screen.getByTestId('row').style.getPropertyValue(ROW_HEIGHT_CSS_VARIABLE);

function pressHandle(clientX = 0, clientY = 0, button = 0) {
  fireEvent(screen.getByTestId('handle'), pointer('pointerdown', { button, clientX, clientY }));
}

afterEach(() => {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('applyWidthPreview', () => {
  it('returns the stored widths without a preview', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), null)).toEqual([6, 3, 3]);
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 0, delta: 0, minColumns: 1 })).toEqual([6, 3, 3]);
  });

  it('moves columns across the previewed boundary only', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 0, delta: -2, minColumns: 1 })).toEqual([4, 5, 3]);
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 1, delta: 1, minColumns: 1 })).toEqual([6, 4, 2]);
  });

  it('clamps a stale preview to the current widths', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 1, delta: 5, minColumns: 1 })).toEqual([6, 5, 1]);
  });

  it('keeps both neighbours at the preview minimum', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 1, delta: 5, minColumns: 3 })).toEqual([6, 3, 3]);
    expect(applyWidthPreview(widgets(4, 4, 4), { index: 0, delta: 2, minColumns: 3 })).toEqual([5, 3, 4]);
  });
});

describe('useWidthResize', () => {
  it('previews whole columns while dragging and commits once on release', () => {
    const onCommit = jest.fn();

    render(<WidthProbe items={widgets(4, 4, 4)} onCommit={onCommit} />);
    pressHandle(500);

    expect(document.body.style.cursor).toBe('col-resize');
    movePointer(540);
    expect(screen.getByTestId('widths').textContent).toBe('4,4,4');
    movePointer(800);
    expect(screen.getByTestId('widths').textContent).toBe('6,2,4');
    // The neighbour keeps its 2 minimum columns: +6 stops at +2.
    movePointer(1400);
    expect(screen.getByTestId('widths').textContent).toBe('6,2,4');
    movePointer(800);
    expect(onCommit).not.toHaveBeenCalled();

    releasePointer();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, 2, 2);
    expect(screen.getByTestId('widths').textContent).toBe('4,4,4');
    expect(document.body.style.cursor).toBe('');
  });

  it('ignores other pointers and skips no-op drags', () => {
    const onCommit = jest.fn();

    render(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);
    pressHandle(500);
    act(() => {
      document.dispatchEvent(pointer('pointermove', { clientX: 900, pointerId: 2 }));
    });
    expect(screen.getByTestId('widths').textContent).toBe('6,6');
    releasePointer(2);
    movePointer(520);
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels with Escape', () => {
    const onCommit = jest.fn();

    render(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);
    pressHandle(500);
    // Two widgets: one column pitch is 151 px.
    movePointer(198);
    expect(screen.getByTestId('widths').textContent).toBe('4,8');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('widths').textContent).toBe('6,6');
  });

  it('cancels a running drag when resizing gets disabled', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);

    pressHandle(500);
    movePointer(700);
    rerender(<WidthProbe enabled={false} items={widgets(6, 6)} onCommit={onCommit} />);
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('widths').textContent).toBe('6,6');
  });

  it('does nothing when disabled or for secondary buttons', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe enabled={false} items={widgets(6, 6)} onCommit={onCommit} />);

    pressHandle(500);
    movePointer(800);
    releasePointer();
    rerender(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);
    pressHandle(500, 0, 2);
    movePointer(800);
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('follows the grabbed pair when a collaborator inserts a widget before it', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe items={widgets(4, 4, 4)} onCommit={onCommit} />);

    pressHandle(500);
    movePointer(800);
    expect(screen.getByTestId('widths').textContent).toBe('6,2,4');

    // The grabbed w0|w1 pair is now the second boundary of the row; the stale
    // +2 is clamped to the 2-column minimum of the new neighbour.
    const inserted = [{ id: 'new', viewId: 'new-view', databaseId: 'db', width: 3 }, ...widgets(3, 3, 3)];

    rerender(<WidthProbe items={inserted} onCommit={onCommit} />);
    expect(screen.getByTestId('widths').textContent).toBe('3,4,2,3');
    // Four widgets: the pitch is 149 px, so +20 px is no column and +100 px is one.
    movePointer(520);
    expect(screen.getByTestId('widths').textContent).toBe('3,3,3,3');
    movePointer(600);
    expect(screen.getByTestId('widths').textContent).toBe('3,4,2,3');

    releasePointer();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(1, 1, 2);
  });

  it('cancels the drag when a collaborator separates the grabbed pair', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe items={widgets(4, 4, 4)} onCommit={onCommit} />);

    pressHandle(500);
    movePointer(700);
    // w1 is gone: w0 now borders w2, a pair the user never grabbed.
    const [first, , last] = widgets(4, 4, 4);

    rerender(<WidthProbe items={[{ ...first, width: 8 }, last]} onCommit={onCommit} />);
    expect(screen.getByTestId('widths').textContent).toBe('8,4');
    expect(document.body.style.cursor).toBe('');

    movePointer(800);
    releasePointer();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('widths').textContent).toBe('8,4');
  });

  it('nudges one column with the arrow keys', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowUp' });
    expect(onCommit.mock.calls).toEqual([
      [0, 1, 2],
      [0, -1, 2],
    ]);

    // At the minimum the key does nothing.
    onCommit.mockClear();
    rerender(<WidthProbe items={widgets(10, 2)} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps both neighbours at least 240 px wide on a common row (minimum 3 columns)', () => {
    const onCommit = jest.fn();

    // 1224 px, three widgets: the pitch is 100 px and 240 px is 2.4 columns.
    render(<WidthProbe items={widgets(4, 4, 4)} onCommit={onCommit} rowWidth={1224} />);
    pressHandle(500);
    movePointer(700);
    expect(screen.getByTestId('widths').textContent).toBe('5,3,4');
    releasePointer();

    expect(onCommit).toHaveBeenCalledWith(0, 1, 3);
  });

  it('allows a 2-column minimum on a wide row', () => {
    const onCommit = jest.fn();

    render(<WidthProbe items={widgets(4, 4, 4)} onCommit={onCommit} />);
    pressHandle(500);
    movePointer(950);
    expect(screen.getByTestId('widths').textContent).toBe('6,2,4');
    releasePointer();

    expect(onCommit).toHaveBeenCalledWith(0, 2, 2);
  });
});

describe('useRowHeightResize', () => {
  it('previews the dragged height and commits it on release', () => {
    const onCommit = jest.fn();

    render(<HeightProbe height={360} onCommit={onCommit} />);
    pressHandle(0, 100);

    expect(document.body.style.cursor).toBe('row-resize');
    movePointer(0, 220);
    expect(screen.getByTestId('height').textContent).toBe('480');
    expect(screen.getByTestId('previewing').textContent).toBe('true');
    // The row resizes through its CSS variable, written by the drag itself.
    expect(rowHeightVariable()).toBe('480px');

    releasePointer();
    expect(onCommit).toHaveBeenCalledWith(480);
    expect(screen.getByTestId('previewing').textContent).toBe('false');
    expect(screen.getByTestId('height').textContent).toBe('360');
    expect(rowHeightVariable()).toBe('360px');
  });

  it('writes the committed height to the row once the drag ends', () => {
    const onCommit = jest.fn();

    render(<PersistingHeightProbe initialHeight={360} onCommit={onCommit} />);
    pressHandle(0, 100);
    movePointer(0, 220);
    releasePointer();

    // The row re-rendered throughout the drag, so its style prop has nothing
    // new to write: the committed height must come from the hook.
    expect(onCommit).toHaveBeenCalledWith(480);
    expect(screen.getByTestId('height').textContent).toBe('480');
    expect(rowHeightVariable()).toBe('480px');

    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowDown' });
    expect(rowHeightVariable()).toBe(`${480 + DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP}px`);
  });

  it('keeps the preview over a collaborator height until the drag ends', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<HeightProbe height={360} onCommit={onCommit} />);

    pressHandle(0, 100);
    movePointer(0, 220);
    rerender(<HeightProbe height={300} onCommit={onCommit} />);
    expect(rowHeightVariable()).toBe('480px');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(rowHeightVariable()).toBe('300px');

    rerender(<HeightProbe height={420} onCommit={onCommit} />);
    expect(rowHeightVariable()).toBe('420px');
  });

  it('snaps the preview to 20 px and commits the snapped height', () => {
    const onCommit = jest.fn();

    render(<HeightProbe height={360} onCommit={onCommit} />);
    pressHandle(0, 100);
    movePointer(0, 150);
    expect(screen.getByTestId('height').textContent).toBe('420');
    expect(rowHeightVariable()).toBe('420px');
    movePointer(0, 211);
    expect(screen.getByTestId('height').textContent).toBe('480');
    releasePointer();

    expect(onCommit).toHaveBeenCalledWith(480);
  });

  it('does not commit a drag that snaps back to the start height', () => {
    const onCommit = jest.fn();

    render(<HeightProbe height={360} onCommit={onCommit} />);
    pressHandle(0, 100);
    movePointer(0, 125);
    expect(screen.getByTestId('height').textContent).toBe('380');
    movePointer(0, 109);
    expect(screen.getByTestId('height').textContent).toBe('360');
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clamps the preview to the supported range', () => {
    const onCommit = jest.fn();

    render(<HeightProbe height={360} onCommit={onCommit} />);
    pressHandle(0, 100);
    movePointer(0, -900);
    expect(screen.getByTestId('height').textContent).toBe(String(DASHBOARD_MIN_ROW_HEIGHT));
    movePointer(0, 5000);
    expect(screen.getByTestId('height').textContent).toBe(String(DASHBOARD_MAX_ROW_HEIGHT));
    releasePointer();

    expect(onCommit).toHaveBeenCalledWith(DASHBOARD_MAX_ROW_HEIGHT);
  });

  it('does not commit an unchanged or cancelled drag', () => {
    const onCommit = jest.fn();

    render(<HeightProbe height={360} onCommit={onCommit} />);
    pressHandle(0, 100);
    movePointer(0, 100);
    releasePointer();

    pressHandle(0, 100);
    movePointer(0, 300);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    releasePointer();

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('height').textContent).toBe('360');
  });

  it('steps with the arrow keys within the range', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<HeightProbe height={360} onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowUp' });
    expect(onCommit.mock.calls).toEqual([
      [360 + DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP],
      [360 - DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP],
    ]);

    onCommit.mockClear();
    rerender(<HeightProbe height={DASHBOARD_MIN_ROW_HEIGHT} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowUp' });
    rerender(<HeightProbe enabled={false} height={360} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowDown' });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
