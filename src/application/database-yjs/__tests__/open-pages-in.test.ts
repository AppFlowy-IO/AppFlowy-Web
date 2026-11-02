import { act, renderHook } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import * as Y from 'yjs';

import drillFixture from '@/application/database-yjs/__fixtures__/dashboard-parity/drill-queries.json';
import viewFixture from '@/application/database-yjs/__fixtures__/dashboard-parity/layouts/view-open-pages-in.json';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { copyDatabaseViewConfiguration } from '@/application/database-yjs/database-view-doc-ops';
import { useSetViewOpenPagesIn, useViewOpenPagesIn } from '@/application/database-yjs/dispatch/open-pages-in';
import {
  OPEN_PAGES_IN_KEY,
  OpenRecordSource,
  leavesPage,
  parseOpenPagesIn,
  readViewOpenPagesIn,
  resolveOpenPagesIn,
  resolveRecordOpening,
} from '@/application/database-yjs/open-pages-in';
import { type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const VIEW_ID = 'view-1';

function createDatabase(entries: Record<string, unknown>) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  views.set(VIEW_ID, view);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  doc.transact(() => {
    Object.entries(entries).forEach(([key, value]) => {
      view.set(key, value && typeof value === 'object' ? toY(value) : value);
    });
  });

  const context: DatabaseContextState = {
    activeViewId: VIEW_ID,
    databaseDoc: doc,
    databasePageId: VIEW_ID,
    readOnly: false,
    rowMap: null,
    workspaceId: 'workspace',
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(DatabaseContext.Provider, { value: context }, children);

  return { doc, view, views, wrapper };
}

function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();

    array.push(value.map(toY));
    return array;
  }

  if (value && typeof value === 'object') {
    const map = new Y.Map<unknown>();

    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => map.set(key, toY(item)));
    return map;
  }

  return value;
}

function viewJSON(view: YDatabaseView, keys: string[]) {
  const json = (view as unknown as Y.Map<unknown>).toJSON();

  return Object.fromEntries(keys.filter((key) => key in json).map((key) => [key, json[key]]));
}

describe('resolveOpenPagesIn (drill-queries.json open_pages_in)', () => {
  it('covers every value and source', () => {
    expect(drillFixture.open_pages_in).toHaveLength(18);
  });

  it.each(drillFixture.open_pages_in.map((row) => [String(row.raw), row.source, row.expect] as const))(
    'raw %s from %s -> %s',
    (_label, source, expected) => {
      const row = drillFixture.open_pages_in.find((item) => String(item.raw) === _label && item.source === source);

      expect(resolveOpenPagesIn(row?.raw, source as OpenRecordSource)).toBe(expected);
    }
  );

  it('parses only the three known strings', () => {
    expect(parseOpenPagesIn('side_peek')).toBe('side_peek');
    expect(parseOpenPagesIn('center_peek')).toBe('center_peek');
    expect(parseOpenPagesIn('full_page')).toBe('full_page');
    expect(parseOpenPagesIn('Side_Peek')).toBeNull();
    expect(parseOpenPagesIn(1)).toBeNull();
    expect(parseOpenPagesIn(undefined)).toBeNull();
  });
});

describe('readViewOpenPagesIn', () => {
  it('reads the key of a real view at call time', () => {
    const { doc, view } = createDatabase({});

    expect(readViewOpenPagesIn(doc, VIEW_ID)).toBeUndefined();
    view.set(OPEN_PAGES_IN_KEY, 'full_page');
    expect(readViewOpenPagesIn(doc, VIEW_ID)).toBe('full_page');
    expect(readViewOpenPagesIn(doc, 'missing')).toBeUndefined();
    expect(readViewOpenPagesIn(null, VIEW_ID)).toBeUndefined();
  });
});

describe('resolveRecordOpening for locked embeds', () => {
  it.each([false, true])('keeps full_page drill-down rows local with mobile=%s', (mobile) => {
    const opening = resolveRecordOpening({
      readOnly: true,
      isDocumentBlock: true,
      publish: false,
      mobile,
      raw: 'full_page',
      source: 'drilldown',
    });

    expect(opening).toBe('center_peek');
    // The drill-down must stay mounted beneath the local row peek.
    expect(leavesPage(opening)).toBe(false);
  });

  it.each(['center_peek', 'side_peek'] as const)('preserves an explicit %s on mobile', (raw) => {
    expect(resolveRecordOpening({
      readOnly: true,
      isDocumentBlock: true,
      publish: false,
      mobile: true,
      raw,
      source: 'dashboard_widget',
    })).toBe(raw);
  });
});

describe('layouts/view-open-pages-in.json', () => {
  it('a write sets only open_pages_in and keeps the unknown key', () => {
    const { view, wrapper } = createDatabase(viewFixture.view);
    const keys = Object.keys(viewFixture.write.expected);
    const before = (view as unknown as Y.Map<unknown>).toJSON();
    const { result } = renderHook(() => useSetViewOpenPagesIn(), { wrapper });
    const changed = new Set<string>();

    view.observe((event) => event.keysChanged.forEach((key) => changed.add(key)));
    act(() => result.current(VIEW_ID, viewFixture.write.value as 'full_page'));

    expect([...changed]).toEqual(viewFixture.write.writtenKeys);
    expect(viewJSON(view, keys)).toEqual(viewFixture.write.expected);
    const after = (view as unknown as Y.Map<unknown>).toJSON();

    Object.keys(before)
      .filter((key) => !viewFixture.write.writtenKeys.includes(key))
      .forEach((key) => expect(after[key]).toEqual(before[key]));
  });

  it('copyDatabaseViewConfiguration copies open_pages_in, and deletes it when the source has none', () => {
    const { view: source } = createDatabase(viewFixture.view);
    const { view: target } = createDatabase({});
    const { view: empty } = createDatabase({});

    copyDatabaseViewConfiguration(source, target);
    expect(target.get(OPEN_PAGES_IN_KEY)).toBe(viewFixture.duplicate.web.expected.open_pages_in);

    copyDatabaseViewConfiguration(empty, target);
    expect(target.get(OPEN_PAGES_IN_KEY)).toBeUndefined();
  });
});

describe('useViewOpenPagesIn', () => {
  it('re-renders only when open_pages_in changes', () => {
    const { view, wrapper } = createDatabase({ [OPEN_PAGES_IN_KEY]: 'center_peek' });
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useViewOpenPagesIn(VIEW_ID);
      },
      { wrapper }
    );

    expect(result.current).toBe('center_peek');
    const settled = renders;

    act(() => {
      view.set(YjsDatabaseKey.name, 'Renamed');
    });
    expect(renders).toBe(settled);

    act(() => {
      view.set(OPEN_PAGES_IN_KEY, 'full_page');
    });
    expect(result.current).toBe('full_page');
    expect(renders).toBe(settled + 1);
  });

  it('keeps an unknown stored value as it is', () => {
    const { wrapper } = createDatabase({ [OPEN_PAGES_IN_KEY]: 'bogus' });
    const { result } = renderHook(() => useViewOpenPagesIn(VIEW_ID), { wrapper });

    expect(result.current).toBe('bogus');
    expect(resolveOpenPagesIn(result.current, 'dashboard_widget')).toBe('side_peek');
  });
});
