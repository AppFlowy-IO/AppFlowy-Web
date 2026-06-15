import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { UIVariant, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import {
  publishedDatabasePayload,
  publishedDocumentPayload,
  publishedRowDocumentId,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import type { StaticEditorProps } from '@/components/editor/StaticEditor';
import StaticEditor from '@/components/editor/StaticEditor';
import type { DatabaseProps } from '@/components/publish/DatabaseView';
import DatabaseView from '@/components/publish/DatabaseView';
import PublishSnapshotView from '@/components/publish-render/PublishSnapshotView';

jest.mock('@/components/editor/StaticEditor', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: jest.fn((props: StaticEditorProps) => {
      const firstBlock = props.value[0] as { children?: { children?: { text?: string }[] }[] } | undefined;
      const firstText = firstBlock?.children?.[0]?.children?.[0]?.text ?? '';

      return React.createElement('div', { 'data-testid': 'static-editor' }, firstText);
    }),
  };
});

jest.mock('@/components/publish/DatabaseView', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: jest.fn((props: DatabaseProps) =>
      React.createElement('div', { 'data-testid': 'database-view' }, props.viewMeta.name)
    ),
  };
});

jest.mock('@/components/view-meta/ViewMetaPreview', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: jest.fn((props: { name?: string }) =>
      React.createElement('div', { 'data-testid': 'view-meta-preview' }, props.name)
    ),
  };
});

const mockStaticEditor = StaticEditor as unknown as jest.Mock;
const mockDatabaseView = DatabaseView as unknown as jest.Mock;

describe('PublishSnapshotView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a normalized document JSON snapshot through the shared static editor UI', () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);

    if (snapshot.kind !== 'document') {
      throw new Error('Expected document snapshot fixture');
    }

    render(
      <MemoryRouter>
        <PublishSnapshotView snapshot={snapshot} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('view-meta-preview').parentElement?.className).toContain('min-h-[calc(100vh-48px)]');
    expect(screen.getByTestId('view-meta-preview').parentElement?.className).not.toContain('h-full');
    expect(screen.getByTestId('view-meta-preview').textContent).toBe('Published document');
    expect(screen.getByTestId('static-editor').textContent).toBe('Published document body');
    expect(mockStaticEditor).toHaveBeenCalledTimes(1);

    const staticEditorProps = mockStaticEditor.mock.calls[0][0] as StaticEditorProps;

    expect(staticEditorProps.workspaceId).toBe('publish');
    expect(staticEditorProps.viewId).toBe(snapshot.view.viewId);
    expect(staticEditorProps.value).toBe(snapshot.document.children);
    expect(staticEditorProps.databaseRelations).toEqual({
      'related-database-id': 'related-database-view-id',
    });
  });

  it('renders a normalized database JSON snapshot through the shared database UI bridge', async () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);

    if (snapshot.kind !== 'database') {
      throw new Error('Expected database snapshot fixture');
    }

    render(
      <MemoryRouter>
        <PublishSnapshotView snapshot={snapshot} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('database-view').textContent).toBe('Published database');
    expect(mockDatabaseView).toHaveBeenCalledTimes(1);

    const databaseProps = mockDatabaseView.mock.calls[0][0] as DatabaseProps;
    const database = databaseProps.doc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database);

    expect(databaseProps.workspaceId).toBe('publish');
    expect(databaseProps.variant).toBe(UIVariant.Publish);
    expect(databaseProps.doc.guid).toBe(snapshot.database.databaseId);
    expect(databaseProps.doc.object_id).toBe(snapshot.database.databaseId);
    expect(databaseProps.doc.view_id).toBe(snapshot.view.viewId);
    expect(databaseProps.viewMeta).toMatchObject({
      name: snapshot.view.name,
      viewId: snapshot.view.viewId,
      layout: snapshot.view.layout,
      visibleViewIds: snapshot.database.visibleViewIds,
      database_relations: {},
    });
    expect(database?.get(YjsDatabaseKey.id)).toBe(snapshot.database.databaseId);
    expect(Object.keys(databaseProps.initialRowMap ?? {})).toEqual(['published-row-id']);

    const rowDocument = await databaseProps.loadRowDocument?.(publishedRowDocumentId);
    const rowDocumentContent = rowDocument ? yDocToSlateContent(rowDocument) : undefined;
    const firstRowDocumentBlock = rowDocumentContent?.children[0] as {
      children?: Array<{ children?: Array<{ text?: string }> }>;
    } | undefined;

    expect(firstRowDocumentBlock?.children?.[0]?.children?.[0]?.text).toBe('Published row document body');
  });
});
