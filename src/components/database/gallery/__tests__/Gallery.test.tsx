import { act, render, screen, waitFor } from '@testing-library/react';

import {
  useDatabaseContext,
  useDatabaseGroupFieldIdSelector,
  useFieldsSelector,
  useGalleryLayoutSettings,
  useReadOnly,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';

import { Gallery } from '../Gallery';

jest.mock('@atlaskit/pragmatic-drag-and-drop/reorder', () => ({ reorder: jest.fn() }));
jest.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index', () => ({
  getReorderDestinationIndex: jest.fn(),
}));

jest.mock('@/application/database-yjs', () => ({
  FieldVisibility: {
    AlwaysHidden: 2,
    AlwaysShown: 0,
    HideWhenEmpty: 1,
  },
  useDatabaseContext: jest.fn(),
  useDatabaseGroupFieldIdSelector: jest.fn(),
  useFieldsSelector: jest.fn(),
  useGalleryLayoutSettings: jest.fn(),
  useReadOnly: jest.fn(),
  useRowOrdersSelector: jest.fn(),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useReorderRowDispatch: () => jest.fn() }));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  useDatabaseSearch: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../GalleryCard', () => ({
  __esModule: true,
  default: ({ fields, rowId }: { fields: Array<{ fieldId: string }>; rowId: string }) => (
    <div data-field-ids={fields.map((field) => field.fieldId).join(',')} data-testid={`mock-gallery-card-${rowId}`} />
  ),
}));
jest.mock('../GalleryNewRow', () => ({
  __esModule: true,
  default: () => <button type='button'>New row</button>,
}));
jest.mock('../GallerySortState', () => ({
  GallerySortSubscription: ({ children }: { children: React.ReactNode }) => children,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseDatabaseGroupFieldIdSelector = useDatabaseGroupFieldIdSelector as jest.MockedFunction<
  typeof useDatabaseGroupFieldIdSelector
>;
const mockUseFieldsSelector = useFieldsSelector as jest.MockedFunction<typeof useFieldsSelector>;
const mockUseGalleryLayoutSettings = useGalleryLayoutSettings as jest.MockedFunction<typeof useGalleryLayoutSettings>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowOrdersSelector = useRowOrdersSelector as jest.MockedFunction<typeof useRowOrdersSelector>;
const mockUseDatabaseSearch = useDatabaseSearch as jest.MockedFunction<typeof useDatabaseSearch>;

const rows = Array.from({ length: 100 }, (_, index) => ({ height: 36, id: `row-${index}` }));

describe('Gallery pagination lifecycle', () => {
  let resizeObserverRecords: Array<{
    callback: ResizeObserverCallback;
    elements: Set<Element>;
    observer: ResizeObserver;
  }>;
  let scrollHeight: number;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let clientHeightDescriptor: PropertyDescriptor | undefined;
  let clientWidthDescriptor: PropertyDescriptor | undefined;
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    resizeObserverRecords = [];
    scrollHeight = 500;
    originalResizeObserver = globalThis.ResizeObserver;
    clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

    class MockResizeObserver {
      private readonly elements = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        resizeObserverRecords.push({
          callback,
          elements: this.elements,
          observer: this as unknown as ResizeObserver,
        });
      }

      disconnect = jest.fn(() => this.elements.clear());
      observe = jest.fn((element: Element) => this.elements.add(element));
      unobserve = jest.fn((element: Element) => this.elements.delete(element));
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1_000 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1_000 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });

    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'gallery-view',
      isDocumentBlock: false,
      onRendered: jest.fn(),
    } as ReturnType<typeof useDatabaseContext>);
    mockUseDatabaseGroupFieldIdSelector.mockReturnValue(undefined);
    mockUseFieldsSelector.mockReturnValue([]);
    mockUseGalleryLayoutSettings.mockReturnValue({
      cardPreview: GalleryCardPreview.PageCover,
      cardSize: GalleryCardSize.Medium,
      fitImage: false,
      showCover: true,
    });
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowOrdersSelector.mockReturnValue(rows);
    mockUseDatabaseSearch.mockReturnValue({ query: '', setQuery: jest.fn() });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;

    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }

    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }

    if (scrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
  });

  it('keeps loading until a non-overflowing viewport is filled', async () => {
    render(<Gallery />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(rows.length);
    });
  });

  it('loads more when a grid-only resize leaves room below the rendered cards', async () => {
    scrollHeight = 2_000;
    render(<Gallery />);

    expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(50);

    const grid = screen.getByTestId('gallery-grid');

    scrollHeight = 500;
    act(() => {
      for (const record of resizeObserverRecords) {
        if (record.elements.has(grid)) record.callback([], record.observer);
      }
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(rows.length);
    });
  });

  it('searches every row instead of limiting candidates to the current page', () => {
    scrollHeight = 2_000;
    mockUseDatabaseSearch.mockReturnValue({ query: 'only in row 99', setQuery: jest.fn() });

    render(<Gallery />);

    expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(rows.length);
  });

  it('keeps an explicit zero inset and excludes the preserved grouping field', () => {
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'gallery-view',
      isDocumentBlock: false,
      paddingEnd: 0,
      paddingStart: 0,
    } as ReturnType<typeof useDatabaseContext>);
    mockUseDatabaseGroupFieldIdSelector.mockReturnValue('status');
    mockUseFieldsSelector.mockReturnValue([
      { fieldId: 'name', isPrimary: true, visibility: 0 },
      { fieldId: 'status', isPrimary: false, visibility: 0 },
      { fieldId: 'owner', isPrimary: false, visibility: 0 },
    ] as ReturnType<typeof useFieldsSelector>);
    mockUseRowOrdersSelector.mockReturnValue(rows.slice(0, 1));

    render(<Gallery />);

    const container = screen.getByTestId('database-gallery').firstElementChild as HTMLElement;

    expect(container.style.paddingInlineStart).toBe('0');
    expect(container.style.paddingInlineEnd).toBe('0');
    expect(screen.getByTestId('mock-gallery-card-row-0').getAttribute('data-field-ids')).toBe('name,owner');
  });
});
