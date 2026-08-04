import { act, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, RowMetaKey } from '@/application/database-yjs';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { YDoc, YjsEditorKey } from '@/application/types';
import { PrimaryCell } from '@/components/database/components/cell/primary/PrimaryCell';

jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/cell', () => ({
  Cell: () => <span>Row title</span>,
}));

jest.mock('@/utils/platform', () => ({
  getPlatform: () => ({ isMobile: false }),
}));

const rowId = '43ed1aeb-a8bd-4039-be1d-92f33f3c1c03';

function renderPrimaryCell(rowDoc: YDoc) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: new Y.Doc() as YDoc,
    databasePageId: 'database-page-id',
    activeViewId: 'board-view-id',
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  };

  return render(
    <DatabaseContext.Provider value={contextValue}>
      <PrimaryCell
        cell={{
          createdAt: 0,
          lastModified: 0,
          fieldType: FieldType.RichText,
          data: 'Synced row',
        }}
        rowId={rowId}
        fieldId='primary-field-id'
        readOnly={false}
        wrap
      />
    </DatabaseContext.Provider>
  );
}

describe('PrimaryCell', () => {
  it('shows the row document icon when non-empty metadata arrives remotely', async () => {
    const localRowDoc = new Y.Doc() as YDoc;
    const remoteRowDoc = new Y.Doc();
    const remoteRoot = remoteRowDoc.getMap(YjsEditorKey.data_section);
    const remoteMeta = new Y.Map<unknown>();
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    expect(isDocumentEmptyKey).toBeDefined();
    remoteMeta.set(isDocumentEmptyKey as string, false);
    remoteRoot.set(YjsEditorKey.meta, remoteMeta);

    renderPrimaryCell(localRowDoc);

    expect(screen.queryByTestId(`row-document-icon-${rowId}`)).toBeNull();

    act(() => {
      Y.applyUpdate(localRowDoc, Y.encodeStateAsUpdate(remoteRowDoc));
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(`row-document-icon-${rowId}`)).toHaveLength(1);
    });
  });
});
