import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import {
  contextOf,
  createDrillFixture,
  DatabaseWrapper,
} from '@/components/database/chart/drill/__tests__/drillTestFixture';

import { DatabaseRowSidePeek } from '../DatabaseRowSidePeek';
import { clampSidePeekWidth, defaultSidePeekWidth, SIDE_PEEK_WIDTH_STORAGE_KEY } from '../useSidePeekWidth';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const mockRowRenders = jest.fn();

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: ({ rowId }: { rowId: string }) => {
    mockRowRenders();
    return <div data-testid='database-row-body'>{rowId}</div>;
  },
}));

jest.mock('@/components/app/DatabaseRestoreNotice', () => ({
  useDatabaseRestoreNotice: () => undefined,
}));

const SIDE_PEEK = DASHBOARD_GEOMETRY.sidePeek;

function pointer(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });

  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function renderPeek(props: Partial<React.ComponentProps<typeof DatabaseRowSidePeek>> = {}, readOnly = false) {
  const onOpenChange = jest.fn();
  const openPage = jest.fn();
  const onSwitchToCenter = jest.fn();
  const fixture = createDrillFixture();

  render(
    <DatabaseWrapper value={contextOf(fixture, { readOnly })}>
      <DatabaseRowSidePeek
        onOpenChange={onOpenChange}
        onSwitchToCenter={onSwitchToCenter}
        open
        openPage={openPage}
        rowId='r2'
        {...props}
      />
    </DatabaseWrapper>
  );
  return { onOpenChange, openPage, onSwitchToCenter };
}

const peek = () => screen.getByTestId('row-side-peek');

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1440;
});

describe('side peek width', () => {
  it('defaults to min(640, 45% of the viewport) within [420, min(1000, viewport − 240)]', () => {
    expect(defaultSidePeekWidth(1440)).toBe(640);
    expect(defaultSidePeekWidth(1280)).toBe(576);
    expect(defaultSidePeekWidth(800)).toBe(SIDE_PEEK.minWidth);
    expect(clampSidePeekWidth(2000, 1440)).toBe(SIDE_PEEK.maxWidth);
    expect(clampSidePeekWidth(1100, 1200)).toBe(960);
    expect(clampSidePeekWidth(100, 1440)).toBe(SIDE_PEEK.minWidth);
  });
});

describe('DatabaseRowSidePeek', () => {
  it('opens at its default width under the app header, labelled with the row title', () => {
    renderPeek();

    expect(peek().style.width).toBe('640px');
    expect(peek().style.top).toBe(`${SIDE_PEEK.webTop}px`);
    expect(peek().getAttribute('role')).toBe('dialog');
    expect(peek().getAttribute('aria-modal')).toBe('false');
    expect(peek().getAttribute('aria-label')).toBe('Crash on photo upload');
    expect(peek().getAttribute('data-parity-id')).toBe('dash-side-peek');
    expect(peek().className).toContain('shadow-dash-side-peek');
    expect(within(peek()).getByTestId('database-row-body').textContent).toBe('r2');
  });

  it('defaults to 576px in a 1280px window', () => {
    window.innerWidth = 1280;
    renderPeek();
    expect(peek().style.width).toBe('576px');
  });

  it('starts from the remembered width, clamped', () => {
    window.localStorage.setItem(SIDE_PEEK_WIDTH_STORAGE_KEY, '300');
    renderPeek();
    expect(peek().style.width).toBe(`${SIDE_PEEK.minWidth}px`);
  });

  it('resizes from the left edge and remembers the width', () => {
    renderPeek();
    const resizer = screen.getByTestId('row-side-peek-resizer');

    expect(resizer.getAttribute('role')).toBe('separator');
    expect(resizer.getAttribute('aria-orientation')).toBe('vertical');
    expect(resizer.getAttribute('aria-valuenow')).toBe('640');
    expect(resizer.style.width).toBe(`${SIDE_PEEK.resizeHit}px`);
    mockRowRenders.mockClear();
    fireEvent(resizer, pointer('pointerdown', 800));
    fireEvent(resizer, pointer('pointermove', 750));
    fireEvent(resizer, pointer('pointermove', 700));
    expect(peek().style.width).toBe('740px');
    fireEvent(resizer, pointer('pointerup', 700));
    expect(window.localStorage.getItem(SIDE_PEEK_WIDTH_STORAGE_KEY)).toBe('740');
    // The pointer-up commits the width (the resizer reports it); the drag itself re-rendered no record.
    expect(resizer.getAttribute('aria-valuenow')).toBe('740');
    expect(mockRowRenders).not.toHaveBeenCalled();
  });

  it('resizes with ←/→ in 20px steps', () => {
    renderPeek();
    const resizer = screen.getByTestId('row-side-peek-resizer');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(peek().style.width).toBe('660px');
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(peek().style.width).toBe('620px');
    expect(window.localStorage.getItem(SIDE_PEEK_WIDTH_STORAGE_KEY)).toBe('620');
  });

  it('tolerates a throwing localStorage', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    try {
      renderPeek();
      expect(peek().style.width).toBe('640px');
      fireEvent.keyDown(screen.getByTestId('row-side-peek-resizer'), { key: 'ArrowLeft' });
      expect(peek().style.width).toBe('660px');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('re-clamps when the window shrinks', () => {
    renderPeek();
    fireEvent.keyDown(screen.getByTestId('row-side-peek-resizer'), { key: 'ArrowLeft' });
    expect(peek().style.width).toBe('660px');
    act(() => {
      window.innerWidth = 800;
      window.dispatchEvent(new Event('resize'));
    });
    expect(peek().style.width).toBe('560px');
  });

  it('closes on Esc and on a press outside', () => {
    const { onOpenChange } = renderPeek();

    fireEvent.keyDown(peek(), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;

    expect(backdrop.className).toContain('MuiBackdrop-invisible');
    fireEvent.click(backdrop);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes from Close, expands to a full page, and switches to the centre peek', () => {
    const { onOpenChange, openPage, onSwitchToCenter } = renderPeek();

    fireEvent.click(screen.getByTestId('row-side-peek-full-page'));
    expect(openPage).toHaveBeenCalledWith('r2');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByTestId('row-side-peek-center'));
    expect(onSwitchToCenter).toHaveBeenCalledTimes(1);
    onOpenChange.mockClear();
    fireEvent.click(screen.getByTestId('row-side-peek-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the row actions with their test ids, for writers only', () => {
    renderPeek();
    expect(screen.getByTestId('row-detail-more-actions')).toBeTruthy();
  });

  it('has no row actions for readers', () => {
    renderPeek({}, true);
    expect(screen.queryByTestId('row-detail-more-actions')).toBeNull();
  });

  it('fills the width without a resizer in a mobile context', () => {
    renderPeek({ fullWidth: true });
    expect(peek().style.width).toBe('100vw');
    expect(screen.queryByTestId('row-side-peek-resizer')).toBeNull();
  });
});
