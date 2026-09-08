import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useRowMap, useRowOrdersSelector, useSortsSelector } from '@/application/database-yjs';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { readRowCreatedAt, useFeedRowOrders } from '../useFeedRowOrders';

jest.mock('@/application/database-yjs', () => ({
  useRowMap: jest.fn(),
  useRowOrdersSelector: jest.fn(),
  useSortsSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/hooks/useBackgroundRowDocLoader', () => ({
  useBackgroundRowDocLoader: jest.fn(),
}));

const mockUseRowMap = useRowMap as jest.MockedFunction<typeof useRowMap>;
const mockUseRowOrdersSelector = useRowOrdersSelector as jest.MockedFunction<typeof useRowOrdersSelector>;
const mockUseSortsSelector = useSortsSelector as jest.MockedFunction<typeof useSortsSelector>;
const mockUseBackgroundRowDocLoader = useBackgroundRowDocLoader as jest.MockedFunction<
  typeof useBackgroundRowDocLoader
>;

function createRowDoc(createdAt?: string): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const row = new Y.Map();

  if (createdAt !== undefined) row.set(YjsDatabaseKey.created_at, createdAt);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
  return doc;
}

const rows = [
  { id: 'a', height: 36 },
  { id: 'b', height: 36 },
  { id: 'c', height: 36 },
];

describe('useFeedRowOrders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSortsSelector.mockReturnValue([]);
    mockUseBackgroundRowDocLoader.mockReturnValue({ cachedRowDocs: {} } as ReturnType<
      typeof useBackgroundRowDocLoader
    >);
  });

  it('returns newest-first order from row created_at when the view has no sorts', () => {
    mockUseRowOrdersSelector.mockReturnValue(rows);
    mockUseRowMap.mockReturnValue({ a: createRowDoc('100'), b: createRowDoc('300'), c: createRowDoc('200') });

    const { result } = renderHook(() => useFeedRowOrders());

    expect(result.current?.map((row) => row.id)).toEqual(['b', 'c', 'a']);
    expect(mockUseBackgroundRowDocLoader).toHaveBeenCalledWith(true, 'feed');
  });

  it('uses background-loaded docs for rows missing from the row map', () => {
    mockUseRowOrdersSelector.mockReturnValue(rows);
    mockUseRowMap.mockReturnValue({ a: createRowDoc('100') });
    mockUseBackgroundRowDocLoader.mockReturnValue({
      cachedRowDocs: { b: createRowDoc('300') },
    } as unknown as ReturnType<typeof useBackgroundRowDocLoader>);

    const { result } = renderHook(() => useFeedRowOrders());

    expect(result.current?.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps the view order untouched when sorts are active and stops background hydration', () => {
    mockUseRowOrdersSelector.mockReturnValue(rows);
    mockUseSortsSelector.mockReturnValue([{ id: 'sort', fieldId: 'field' }]);
    mockUseRowMap.mockReturnValue({ a: createRowDoc('100'), b: createRowDoc('300'), c: createRowDoc('200') });

    const { result } = renderHook(() => useFeedRowOrders());

    expect(result.current).toBe(rows);
    expect(mockUseBackgroundRowDocLoader).toHaveBeenCalledWith(false, 'feed');
  });

  it('passes through the loading state', () => {
    mockUseRowOrdersSelector.mockReturnValue(undefined);
    mockUseRowMap.mockReturnValue({});

    const { result } = renderHook(() => useFeedRowOrders());

    expect(result.current).toBeUndefined();
    expect(mockUseBackgroundRowDocLoader).toHaveBeenCalledWith(false, 'feed');
  });

  it('reads created_at only from hydrated row docs', () => {
    expect(readRowCreatedAt(undefined)).toBeUndefined();
    expect(readRowCreatedAt(new Y.Doc() as unknown as YDoc)).toBeUndefined();
    expect(readRowCreatedAt(createRowDoc())).toBeUndefined();
    expect(readRowCreatedAt(createRowDoc('1700000000'))).toBe(1700000000);
  });
});
