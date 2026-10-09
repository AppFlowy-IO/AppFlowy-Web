import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  FieldType,
  useDatabaseContext,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';
import { GalleryCardPreview, GalleryCardSize } from '@/application/types';

import { GalleryCard } from '../GalleryCard';

jest.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({ combine: jest.fn() }));
jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: jest.fn(),
  dropTargetForElements: jest.fn(),
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge', () => ({
  attachClosestEdge: jest.fn(),
  extractClosestEdge: jest.fn(),
}));

jest.mock('@/application/database-yjs', () => ({
  FieldType: {
    Person: 15,
    Relation: 10,
    RichText: 0,
  },
  useCellSelector: jest.fn(() => ({ data: 'Title' })),
  useDatabaseContext: jest.fn(),
  useIsRowLoaded: jest.fn(),
  useReadOnly: jest.fn(),
  useRowCommentCount: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: () => <span>Title</span>,
}));

jest.mock('@/components/database/list/ListCell', () => ({
  ListCell: () => <button type='button'>Property action</button>,
}));
jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  ClearSortingConfirm: () => null,
}));
jest.mock('../GalleryCardToolbar', () => () => null);
jest.mock('../GalleryPreview', () => ({
  __esModule: true,
  default: ({ rowId }: { rowId: string }) => <div data-testid={`mounted-gallery-preview-${rowId}`} />,
}));
jest.mock('../GallerySortState', () => ({ useGalleryHasSorts: () => false }));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseIsRowLoaded = useIsRowLoaded as jest.MockedFunction<typeof useIsRowLoaded>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowCommentCount = useRowCommentCount as jest.MockedFunction<typeof useRowCommentCount>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;
const mockDraggable = draggable as jest.MockedFunction<typeof draggable>;
const mockDropTargetForElements = dropTargetForElements as jest.MockedFunction<typeof dropTargetForElements>;
const mockExtractClosestEdge = extractClosestEdge as jest.MockedFunction<typeof extractClosestEdge>;

const fields = [
  { fieldId: 'title', fieldType: FieldType.RichText, isPrimary: true },
  { fieldId: 'property', fieldType: FieldType.Person, isPrimary: false },
] as Column[];

describe('GalleryCard rendering lifecycle', () => {
  const navigateToRow = jest.fn();
  let intersectionCallback: IntersectionObserverCallback;
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalIntersectionObserver = globalThis.IntersectionObserver;
    mockUseDatabaseContext.mockReturnValue({ navigateToRow } as ReturnType<typeof useDatabaseContext>);
    mockUseIsRowLoaded.mockReturnValue(true);
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowCommentCount.mockReturnValue(0);
    mockUseRowMetaSelector.mockReturnValue(undefined);

    class MockIntersectionObserver {
      disconnect = jest.fn();
      observe = jest.fn();
      takeRecords = jest.fn(() => []);
      unobserve = jest.fn();
      root = null;
      rootMargin = '';
      thresholds = [];

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver as typeof IntersectionObserver;
  });

  function renderCard(cardFields: Column[] = fields) {
    return render(
      <GalleryCard
        cardPreview={GalleryCardPreview.PageCover}
        cardSize={GalleryCardSize.Medium}
        fields={cardFields}
        fitImage={false}
        reorderable={false}
        rowId='row-1'
      />
    );
  }

  it('provides a separate keyboard-focusable opener without swallowing nested controls', () => {
    renderCard();

    const opener = screen.getByRole('button', { name: 'Open row Title' });
    const tile = screen.getByTestId('gallery-tile-row-1');
    const card = screen.getByTestId('gallery-card-row-1');
    const title = screen.getByTestId('gallery-card-title-row-1');
    const titleSurface = screen.getByTestId('gallery-card-title-surface-row-1');

    expect(opener.querySelector('button')).toBeNull();
    expect(opener.getAttribute('aria-labelledby')).toBe('gallery-card-open-label-row-1 gallery-card-title-label-row-1');
    expect(title.id).toBe('gallery-card-title-label-row-1');
    expect(tile.style.contentVisibility).toBe('auto');
    expect(tile.style.containIntrinsicSize).toContain('198px');
    expect(card.className).toContain('border-[rgba(31,35,41,0.14)]');
    expect(card.className).toContain('[[data-dark-mode=true]_&]:border-[#59647A]');
    expect(card.className).toContain('[--gallery-card-surface:#FFFFFF]');
    expect(card.className).toContain('[[data-dark-mode=true]_&]:[--gallery-card-surface:#1A202C]');
    expect(card.className).toContain('hover:border-[rgba(0,188,240,0.65)]');
    expect(card.className).toContain('[transition-duration:120ms]');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('text-[var(--gallery-card-title)]');
    expect(titleSurface.className).toContain('bg-[rgba(31,35,41,0.06)]');
    expect(titleSurface.className).toContain('[[data-dark-mode=true]_&]:bg-[rgba(0,0,0,0.12)]');

    opener.focus();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');

    navigateToRow.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Property action' }));
    expect(navigateToRow).not.toHaveBeenCalled();
  });

  it('mounts the expensive preview once when the card nears the viewport and keeps it mounted', () => {
    renderCard();

    expect(screen.queryByTestId('mounted-gallery-preview-row-1')).toBeNull();
    expect(screen.getByTestId('gallery-card-preview-row-1').className).toContain('bg-[rgba(31,35,41,0.08)]');
    expect(screen.getByTestId('gallery-card-preview-row-1').className).toContain(
      '[[data-dark-mode=true]_&]:bg-[rgba(89,100,122,0.25)]'
    );

    act(() => {
      intersectionCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(screen.getByTestId('mounted-gallery-preview-row-1')).toBeTruthy();

    act(() => {
      intersectionCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(screen.getByTestId('mounted-gallery-preview-row-1')).toBeTruthy();
  });

  it('supports keyboard row reordering without changing the visible card UI', () => {
    const onDropRow = jest.fn();
    const onKeyboardMoveRow = jest.fn();

    render(
      <GalleryCard
        cardPreview={GalleryCardPreview.PageCover}
        cardSize={GalleryCardSize.Medium}
        fields={fields}
        fitImage={false}
        onDropRow={onDropRow}
        onKeyboardMoveRow={onKeyboardMoveRow}
        reorderable
        rowId='row-1'
      />
    );

    const opener = screen.getByRole('button', { name: 'Open row Title' });

    expect(mockDraggable).toHaveBeenCalledWith(expect.objectContaining({ element: opener }));
    expect(opener.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowLeft Alt+ArrowRight');
    fireEvent.keyDown(opener, { altKey: true, key: 'ArrowRight' });
    expect(onKeyboardMoveRow).toHaveBeenCalledWith('row-1', 1);
    expect(navigateToRow).not.toHaveBeenCalled();
  });

  it('reorders from the draggable final drop location', () => {
    const onDropRow = jest.fn();

    mockExtractClosestEdge.mockReturnValue('right');
    render(
      <GalleryCard
        cardPreview={GalleryCardPreview.PageCover}
        cardSize={GalleryCardSize.Medium}
        fields={fields}
        fitImage={false}
        onDropRow={onDropRow}
        reorderable
        rowId='row-1'
      />
    );

    const draggableRegistration = mockDraggable.mock.calls[0][0];
    const dropTargetRegistration = mockDropTargetForElements.mock.calls[0][0];

    act(() => {
      dropTargetRegistration.onDragEnter?.({
        self: { data: { rowId: 'row-1', type: 'database-gallery-row' } },
      } as Parameters<NonNullable<typeof dropTargetRegistration.onDragEnter>>[0]);
    });

    expect(screen.getByTestId('gallery-tile-row-1').className).not.toContain('scale-[0.98]');
    expect(screen.getByTestId('gallery-card-row-1').className).toContain('scale-[0.98]');

    act(() => {
      draggableRegistration.onDrop?.({
        location: {
          current: {
            dropTargets: [
              {
                data: { rowId: 'row-2', type: 'database-gallery-row' },
              },
            ],
          },
        },
      } as Parameters<NonNullable<typeof draggableRegistration.onDrop>>[0]);
    });

    expect(onDropRow).toHaveBeenCalledTimes(1);
    expect(onDropRow).toHaveBeenCalledWith('row-1', 'row-2', 'right');
  });
});
