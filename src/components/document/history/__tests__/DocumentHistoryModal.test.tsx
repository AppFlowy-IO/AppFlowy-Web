import { expect } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DocumentHistoryModal } from '../DocumentHistoryModal';

/**
 * Regression test for the "embedded database infinitely loads in Version history" bug.
 *
 * Root cause: the version-history preview rendered an <Editor/> without forwarding
 * `loadView` / `bindViewSync` from the editor context. Embedded databases load their
 * own collab doc via `loadView`; when it was missing, `useDocumentLoader` bailed and
 * the database block spun forever.
 *
 * This test asserts those two functions are passed through to the preview <Editor/>.
 */

// Capture the props the preview Editor is rendered with.
let lastEditorProps: Record<string, unknown> | null = null;

jest.mock('@/components/editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    lastEditorProps = props;
    return null;
  },
}));

jest.mock('@/components/_shared/progress/ComponentLoading', () => () => null);
jest.mock('../DocumentHistoryVersionList', () => ({ VersionList: () => null }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const loadView = jest.fn();
const bindViewSync = jest.fn();
const loadViewMeta = jest.fn();
const createRow = jest.fn();
const getViewIdFromDatabaseId = jest.fn();
const getMentionUser = jest.fn();
const loadDatabaseRelations = jest.fn();

const getCollabHistory = jest.fn();
const previewCollabVersion = jest.fn();
const revertCollabVersion = jest.fn();

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    loadViewMeta,
    createRow,
    getViewIdFromDatabaseId,
    loadView,
    bindViewSync,
  }),
  useCollabHistory: () => ({ getCollabHistory, previewCollabVersion, revertCollabVersion }),
  useGetSubscriptions: () => jest.fn(),
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => ({ on: jest.fn(), off: jest.fn() }),
  useGetMentionUser: () => getMentionUser,
  useLoadDatabaseRelations: () => loadDatabaseRelations,
}));

jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: () => ({ isPro: false }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: '1' }),
}));

describe('DocumentHistoryModal version preview', () => {
  beforeEach(() => {
    lastEditorProps = null;
    jest.clearAllMocks();

    getCollabHistory.mockResolvedValue([
      {
        versionId: 'version-1',
        parentId: null,
        name: 'Version 1',
        createdAt: new Date('2026-05-21T09:38:06Z'),
        deletedAt: null,
        editors: [1],
      },
    ]);
    previewCollabVersion.mockResolvedValue(new Y.Doc());
  });

  it('forwards loadView and bindViewSync to the preview Editor so embedded databases can load', async () => {
    render(
      <DocumentHistoryModal
        open
        onOpenChange={jest.fn()}
        viewId="view-1"
        view={{ name: 'Project Tracker 2', icon: null }}
      />
    );

    await waitFor(() => {
      expect(lastEditorProps).not.toBeNull();
    });

    // The regression: these were previously omitted, leaving embedded databases
    // stuck on an infinite loading spinner.
    expect(lastEditorProps?.loadView).toBe(loadView);
    expect(lastEditorProps?.bindViewSync).toBe(bindViewSync);

    // The rest of the editor context should still be forwarded.
    expect(lastEditorProps?.loadViewMeta).toBe(loadViewMeta);
    expect(lastEditorProps?.createRow).toBe(createRow);
    expect(lastEditorProps?.getViewIdFromDatabaseId).toBe(getViewIdFromDatabaseId);
    expect(lastEditorProps?.loadDatabaseRelations).toBe(loadDatabaseRelations);
    expect(lastEditorProps?.readOnly).toBe(true);
  });
});
