import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardWidget,
} from '@/application/database-yjs/dashboard.type';

import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '../constants';
import { useRowHeightResize } from '../hooks/useRowHeightResize';
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

// A 1184 px row with 16 px gaps: one column pitch is exactly 100 px.
const ROW_WIDTH = 1184;

function WidthProbe({
  items,
  enabled = true,
  onCommit,
}: {
  items: DashboardWidget[];
  enabled?: boolean;
  onCommit: (index: number, delta: number) => void;
}) {
  const { preview, startResize, handleKeyDown } = useWidthResize({
    widgets: items,
    enabled,
    getRowElement: () => ({ getBoundingClientRect: () => ({ width: ROW_WIDTH }) } as HTMLElement),
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
  const resize = useRowHeightResize({ height, enabled, onCommit });

  return (
    <div>
      <output data-testid='height'>{resize.height}</output>
      <output data-testid='previewing'>{String(resize.preview !== null)}</output>
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
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 0, delta: 0 })).toEqual([6, 3, 3]);
  });

  it('moves columns across the previewed boundary only', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 0, delta: -2 })).toEqual([4, 5, 3]);
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 1, delta: 1 })).toEqual([6, 4, 2]);
  });

  it('clamps a stale preview to the current widths', () => {
    expect(applyWidthPreview(widgets(6, 3, 3), { index: 1, delta: 5 })).toEqual([6, 5, 1]);
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
    movePointer(700);
    expect(screen.getByTestId('widths').textContent).toBe('6,2,4');
    // Beyond the neighbour's last column the preview stops.
    movePointer(1200);
    expect(screen.getByTestId('widths').textContent).toBe('7,1,4');
    movePointer(700);
    expect(onCommit).not.toHaveBeenCalled();

    releasePointer();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, 2);
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
    movePointer(300);
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

  it('nudges one column with the arrow keys', () => {
    const onCommit = jest.fn();
    const { rerender } = render(<WidthProbe items={widgets(6, 6)} onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowUp' });
    expect(onCommit.mock.calls).toEqual([
      [0, 1],
      [0, -1],
    ]);

    onCommit.mockClear();
    rerender(<WidthProbe items={widgets(11, 1)} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' });
    expect(onCommit).not.toHaveBeenCalled();
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

    releasePointer();
    expect(onCommit).toHaveBeenCalledWith(480);
    expect(screen.getByTestId('previewing').textContent).toBe('false');
    expect(screen.getByTestId('height').textContent).toBe('360');
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
