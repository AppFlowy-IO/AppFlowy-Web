import { render } from '@testing-library/react';

import { DatabaseContextState } from '@/application/database-yjs';
import { createDatabaseYjsRenderDocsFromSnapshot } from '@/application/publish-snapshot/database-yjs-render-bridge';
import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import { publishedDatabasePayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { UIVariant } from '@/application/types';
import { Database } from '@/components/database';

import { DatabaseContent } from '../DatabaseContent';

jest.mock('@/components/database', () => ({
  Database: jest.fn(() => <div data-testid="database" />),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('DatabaseContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes published database row docs into embedded publish databases', () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);

    if (snapshot.kind !== 'database') {
      throw new Error('Expected database snapshot fixture');
    }

    const { doc, rowMap } = createDatabaseYjsRenderDocsFromSnapshot(snapshot);
    const context = {
      readOnly: true,
      databaseDoc: doc,
      databasePageId: snapshot.view.viewId,
      activeViewId: snapshot.database.activeViewId,
      rowMap: null,
      workspaceId: 'publish',
      variant: UIVariant.Publish,
    } as DatabaseContextState;

    render(
      <DatabaseContent
        baseViewId={snapshot.view.viewId}
        selectedViewId={snapshot.database.activeViewId}
        hasDatabase={true}
        notFound={false}
        deletionStatus="none"
        paddingStart={0}
        paddingEnd={0}
        width={800}
        doc={doc}
        workspaceId="publish"
        onOpenRowPage={jest.fn()}
        loadViewMeta={jest.fn()}
        databaseName={snapshot.view.name}
        visibleViewIds={snapshot.database.visibleViewIds}
        onChangeView={jest.fn()}
        context={context}
      />
    );

    expect(Database).toHaveBeenCalled();
    expect((Database as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        doc,
        initialRowMap: rowMap,
        activeViewId: snapshot.database.activeViewId,
        variant: UIVariant.Publish,
      })
    );
  });
});
