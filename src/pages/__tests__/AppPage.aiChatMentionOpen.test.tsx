/**
 * MEN-WEB-09: an AI chat opens in AppPage, never through `loadView`, which records every other open
 * for the mention picker's local candidates. AppPage records the chat's open itself, so the bare @
 * lifts a chat this tab created as an open, and stops lifting it a minute after.
 */
import { expect } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';

import { MentionSearchSectionKind, View, ViewLayout } from '@/application/types';
import {
  clearMentionLocalIndex,
  getMentionLocalSnapshot,
  recordMentionViewCreated,
  setMentionIndexSources,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';
import {
  buildMentionLocalLane,
  MENTION_BARE_REPLICA_STALE_MS,
  patchMentionBareSections,
} from '@/components/editor/components/panels/mention-panel/mentionLocalLane';

import AppPage from '../AppPage';

declare global {
  // eslint-disable-next-line no-var
  var __appPageChatTestState: { viewId?: string; outline?: View[]; aiEnabled?: boolean } | undefined;
}

const WORKSPACE = 'workspace-id';

jest.mock('@/components/app/app.hooks', () => {
  const handlers = {
    toView: jest.fn(),
    loadViewMeta: jest.fn(),
    createRow: jest.fn(),
    loadView: jest.fn(),
    updatePage: jest.fn(),
    addPage: jest.fn(),
    deletePage: jest.fn(),
    setWordCount: jest.fn(),
    uploadFile: jest.fn(),
  };

  return {
    useAppViewId: () => global.__appPageChatTestState?.viewId,
    useAIEnabled: () => global.__appPageChatTestState?.aiEnabled ?? true,
    useCurrentWorkspaceId: () => 'workspace-id',
    useAppOutline: () => global.__appPageChatTestState?.outline,
    useAppOperations: () => handlers,
    useAppRendered: () => false,
    useAppendBreadcrumb: () => jest.fn(),
    useOnRendered: () => jest.fn(),
    useOpenPageModal: () => jest.fn(),
    useLoadViews: () => jest.fn(),
    useEventEmitter: () => undefined,
    useGetMentionUser: () => jest.fn(),
    useLoadDatabaseRelations: () => jest.fn(),
    useScheduleDeferredCleanup: () => jest.fn(),
  };
});

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  getViewReadOnlyStatus: () => false,
  getViewCanCommentStatus: () => true,
  getViewCanWriteStatus: () => true,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'test@appflowy.io' }),
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => null,
}));

jest.mock('@/components/app/DatabaseView', () => () => null);
jest.mock('@/components/document', () => ({ Document: () => null }));
jest.mock('@/components/ai-chat', () => ({ AIChat: () => <div data-testid='ai-chat' /> }));
jest.mock('@/components/_shared/help/Help', () => () => null);
jest.mock('@/components/error/RecordNotFound', () => () => null);
jest.mock('@/components/_shared/helmet/ViewHelmet', () => () => null);

function view(viewId: string, name: string, layout: ViewLayout, extra: View['extra'] = { is_space: false }): View {
  return { view_id: viewId, name, icon: null, layout, extra, children: [], is_published: false, is_private: false };
}

const CHAT = view('chat', 'What is our Q3 plan?', ViewLayout.AIChat);
const SPACE: View = { ...view('space', 'General', ViewLayout.Document, { is_space: true }), children: [CHAT] };
const T0 = Date.parse('2026-11-11T09:00:00Z');
const MINUTE = 60_000;

/** The bare @ as an answer that arrived at `arrivedMs` lists it, with this tab's activity lifted. */
function bareTitles(arrivedMs: number) {
  const lane = buildMentionLocalLane({ snapshot: getMentionLocalSnapshot(WORKSPACE) });
  const patched = patchMentionBareSections({
    sections: [],
    lane,
    liftAfterMs: arrivedMs - MENTION_BARE_REPLICA_STALE_MS,
    personPicks: new Map(),
    presentPersonIds: new Set(),
    request: {},
    limit: 20,
    sectionTitle: (kind: MentionSearchSectionKind) => kind,
    nowMs: arrivedMs,
  });

  return patched.sections.flatMap((section) => section.items.map((item) => item.title));
}

describe('AppPage records an AI chat open for the mention picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMentionLocalIndex();
    setMentionIndexSources(WORKSPACE, { outline: [SPACE] });
  });

  afterEach(() => {
    clearMentionLocalIndex();
    jest.restoreAllMocks();
    global.__appPageChatTestState = undefined;
  });

  it('counts the open of a chat it shows, so a chat created 5 minutes ago is no longer lifted', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);

    // What Search's "Ask AI" and the sidebar's AI chat option record, then open.
    recordMentionViewCreated(WORKSPACE, {
      viewId: CHAT.view_id,
      name: CHAT.name,
      layout: ViewLayout.AIChat,
      parentViewId: SPACE.view_id,
    });
    now.mockReturnValue(T0 + 1_000);
    global.__appPageChatTestState = { viewId: CHAT.view_id, outline: [SPACE] };

    const { findByTestId } = render(<AppPage />);

    await findByTestId('ai-chat');
    await waitFor(() => {
      expect(getMentionLocalSnapshot(WORKSPACE).viewsById.get(CHAT.view_id)?.sessionOpenedAt).toBe(T0 + 1_000);
    });

    // An answer that arrived within a minute of the open still lists it first.
    expect(bareTitles(T0 + 30_000)).toEqual([CHAT.name]);
    // One that arrived 5 minutes later does not: the chat is no unopened creation.
    expect(bareTitles(T0 + 5 * MINUTE)).toEqual([]);
  });

  it('records no open while AI is off, as the chat is not shown', async () => {
    global.__appPageChatTestState = { viewId: CHAT.view_id, outline: [SPACE], aiEnabled: false };

    const { findByTestId } = render(<AppPage />);

    await findByTestId('ai-chat-disabled-view');
    expect(getMentionLocalSnapshot(WORKSPACE).viewsById.get(CHAT.view_id)?.sessionOpenedAt).toBeUndefined();
  });
});
