import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useRowMap } from '@/application/database-yjs/context';
import {
  addRowReaction,
  parseRowReactions,
  readRowReactions,
  removeRowReaction,
  ROW_REACTIONS_META_KEY,
  serializeRowReactions,
  toggleRowReaction,
} from '@/application/database-yjs/row_reaction';
import { useRowReactions, useToggleRowReactionDispatch } from '@/application/database-yjs/row_reaction_selector';
import { YDoc, YjsEditorKey } from '@/application/types';

jest.mock('@/application/database-yjs/context', () => ({
  useRowMap: jest.fn(),
}));

const mockUseRowMap = useRowMap as jest.MockedFunction<typeof useRowMap>;

const BIG_UID = '3287416529874165123';
const OTHER_UID = '42';

function createRowDoc(): { rowDoc: YDoc; meta: Y.Map<unknown> } {
  const rowDoc = new Y.Doc() as unknown as YDoc;
  const meta = new Y.Map<unknown>();

  rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.meta, meta);
  return { rowDoc, meta };
}

describe('row reaction serialization', () => {
  it('parses Desktop i64 user ids without losing precision', () => {
    expect(parseRowReactions(`{"👍":[${BIG_UID},${OTHER_UID}],"🎉":[${OTHER_UID}]}`)).toEqual({
      '👍': [BIG_UID, OTHER_UID],
      '🎉': [OTHER_UID],
    });
  });

  it('drops malformed payloads, empty lists, and invalid ids', () => {
    expect(parseRowReactions(undefined)).toEqual({});
    expect(parseRowReactions('not json')).toEqual({});
    expect(parseRowReactions('[1,2]')).toEqual({});
    expect(parseRowReactions('{"👍":[],"🎉":["abc",0,-5],"🚀":[7,7]}')).toEqual({ '🚀': ['7'] });
  });

  it('serializes unquoted integer ids that Desktop can deserialize', () => {
    const serialized = serializeRowReactions({ '👍': [BIG_UID, OTHER_UID], '🎉': ['uuid-not-numeric'] });

    expect(serialized).toBe(`{"👍":[${BIG_UID},${OTHER_UID}]}`);
    expect(parseRowReactions(serialized)).toEqual({ '👍': [BIG_UID, OTHER_UID] });
  });
});

describe('row reaction writes', () => {
  it('adds, toggles, and removes reactions on the row meta map', () => {
    const { rowDoc, meta } = createRowDoc();

    expect(addRowReaction(rowDoc, '👍', BIG_UID)).toBe(true);
    expect(addRowReaction(rowDoc, '👍', BIG_UID)).toBe(false);
    expect(addRowReaction(rowDoc, '👍', Number(OTHER_UID))).toBe(true);
    expect(meta.get(ROW_REACTIONS_META_KEY)).toBe(`{"👍":[${BIG_UID},${OTHER_UID}]}`);

    toggleRowReaction(rowDoc, '👍', BIG_UID);
    expect(readRowReactions(rowDoc)).toEqual({ '👍': [OTHER_UID] });

    toggleRowReaction(rowDoc, '🎉', BIG_UID);
    expect(readRowReactions(rowDoc)).toEqual({ '👍': [OTHER_UID], '🎉': [BIG_UID] });

    expect(removeRowReaction(rowDoc, '👍', OTHER_UID)).toBe(true);
    expect(removeRowReaction(rowDoc, '👍', OTHER_UID)).toBe(false);
    expect(readRowReactions(rowDoc)).toEqual({ '🎉': [BIG_UID] });
  });

  it('ignores reactions from users without a canonical uid', () => {
    const { rowDoc, meta } = createRowDoc();

    expect(addRowReaction(rowDoc, '👍', 'not-a-uid')).toBe(false);
    expect(addRowReaction(rowDoc, '', BIG_UID)).toBe(false);
    expect(meta.has(ROW_REACTIONS_META_KEY)).toBe(false);
  });

  it('creates the meta map when a row doc has none yet', () => {
    const rowDoc = new Y.Doc() as unknown as YDoc;

    expect(addRowReaction(rowDoc, '👍', BIG_UID)).toBe(true);
    expect(readRowReactions(rowDoc)).toEqual({ '👍': [BIG_UID] });
  });
});

describe('useRowReactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty map without creating meta on an empty row', () => {
    const rowDoc = new Y.Doc() as unknown as YDoc;

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });

    const { result } = renderHook(() => useRowReactions('row-1'));

    expect(result.current).toEqual({});
    expect(rowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.meta)).toBe(false);
  });

  it('observes meta reaction changes, including a meta map added later', () => {
    const rowDoc = new Y.Doc() as unknown as YDoc;

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });

    const { result } = renderHook(() => useRowReactions('row-1'));

    act(() => {
      addRowReaction(rowDoc, '👍', BIG_UID);
    });
    expect(result.current).toEqual({ '👍': [BIG_UID] });

    act(() => {
      toggleRowReaction(rowDoc, '👍', BIG_UID);
    });
    expect(result.current).toEqual({});
  });

  it('keeps a stable reference when the serialized reactions do not change', () => {
    const { rowDoc, meta } = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    addRowReaction(rowDoc, '👍', BIG_UID);

    const { result } = renderHook(() => useRowReactions('row-1'));
    const first = result.current;

    act(() => {
      meta.set('unrelated', 'value');
    });
    expect(result.current).toBe(first);
  });

  it('toggles through the dispatch hook', () => {
    const { rowDoc } = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });

    const { result } = renderHook(() => useToggleRowReactionDispatch('row-1'));

    act(() => {
      result.current('🎉', BIG_UID);
    });
    expect(readRowReactions(rowDoc)).toEqual({ '🎉': [BIG_UID] });
  });
});
