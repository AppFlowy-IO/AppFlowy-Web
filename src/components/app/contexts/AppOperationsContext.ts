import { createContext } from 'react';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  DuplicatePageOptions,
  CreatePagePayload,
  CreatePageResponse,
  CreateRow,
  CreateSpacePayload,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  LoadView,
  LoadViewMeta,
  Subscription,
  TestDatabasePromptConfig,
  TextCount,
  Types,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
  YDoc,
} from '@/application/types';

/**
 * Stable operations context — callbacks and infrequently-changing values.
 *
 * **Provider:** `AppBusinessLayer`
 *
 * **Change frequency:** LOW — the value object is rebuilt only when the
 * underlying callback implementations change (typically on workspace switch).
 * Individual callbacks are `useCallback`-stable.
 *
 * Contains all write/mutation operations plus data loaders that don't belong
 * in the outline or navigation contexts. This is the "kitchen sink" for
 * operations; prefer the narrower hooks when you only need a subset:
 *
 * **Narrower hooks** (read a subset of this context):
 * - `useToView()` — just the `toView` navigation callback
 * - `useGetSubscriptions()` — just `getSubscriptions`
 * - `usePublishing()` — memoized `{ publish, unpublish }`
 * - `useCollabHistory()` — memoized `{ getCollabHistory, previewCollabVersion, revertCollabVersion }`
 *
 * **Full context hook:** `useAppOperations()` — returns the entire context.
 * Use this when you need 3+ fields from different sub-groups.
 */
export interface AppOperationsContextType {
  // ── View loading / navigation ──────────────────────────────────────
  /** Navigate to a view by ID. Optionally scroll to a block and preserve search params. */
  toView: (viewId: string, blockId?: string, keepSearch?: boolean) => Promise<void>;
  /** Load metadata (name, icon, layout, etc.) for a view without loading its content. */
  loadViewMeta: LoadViewMeta;
  /** Load a view's full data (content + metadata). */
  loadView: LoadView;
  /** Create a new row in a database view. */
  createRow?: CreateRow;
  /** Bind a Yjs document to the WebSocket sync layer. Returns a SyncContext or null. */
  bindViewSync?: (doc: YDoc) => SyncContext | null;

  // ── Page CRUD ──────────────────────────────────────────────────────
  /** Create a new page under the given parent. */
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  /** Open a view in a modal overlay (used by inline database creation). */
  openPageModal?: (viewId: string) => void;
  /** Soft-delete a page (move to trash). */
  deletePage?: (viewId: string) => Promise<void>;
  /** Duplicate a page, optionally refreshing its parent children in the outline. */
  duplicatePage?: (viewId: string, options?: DuplicatePageOptions) => Promise<void>;
  /** Update page properties (name, cover, etc.). */
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  /** Update just the page icon. */
  updatePageIcon?: (viewId: string, icon: { ty: ViewIconType; value: string }) => Promise<void>;
  /** Rename a page. */
  updatePageName?: (viewId: string, name: string) => Promise<void>;
  /** Move a page to a new parent, optionally before a sibling. */
  movePage?: (viewId: string, parentId: string, prevViewId?: string) => Promise<void>;
  /** Permanently delete a trashed page (or all trash if viewId is omitted). */
  deleteTrash?: (viewId?: string) => Promise<void>;
  /** Restore a page from trash. */
  restorePage?: (viewId?: string) => Promise<void>;

  // ── Space operations ───────────────────────────────────────────────
  /** Create a new workspace space (top-level folder). */
  createSpace?: (payload: CreateSpacePayload) => Promise<string>;
  /** Update space properties. */
  updateSpace?: (payload: UpdateSpacePayload) => Promise<void>;
  /** Create a new database view (Grid/Board/Calendar tab) within an existing database. */
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;

  // ── File operations ────────────────────────────────────────────────
  /** Upload a file attachment and return its URL. */
  uploadFile?: (viewId: string, file: File, onProgress?: (n: number) => void) => Promise<string>;

  // ── Billing / Subscriptions ────────────────────────────────────────
  /** Fetch the workspace's active subscriptions. Hook: `useGetSubscriptions()`. */
  getSubscriptions?: () => Promise<Subscription[]>;

  // ── Publishing ─────────────────────────────────────────────────────
  /** Publish a view to the web. Hook: `usePublishing()`. */
  publish?: (view: View, publishName?: string, visibleViewIds?: string[]) => Promise<void>;
  /** Unpublish a previously published view. Hook: `usePublishing()`. */
  unpublish?: (viewId: string) => Promise<void>;

  // ── AI operations ──────────────────────────────────────────────────
  /** Generate an AI summary for a database row. */
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  /** Generate an AI translation for a database row. */
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;

  // ── Database operations ────────────────────────────────────────────
  /** Create an orphaned view (e.g. for inline database within a document). */
  createOrphanedView?: (payload: { document_id: string }) => Promise<Uint8Array>;
  /** Load AI prompt templates for a database. */
  loadDatabasePrompts?: LoadDatabasePrompts;
  /** Test an AI prompt config against a database. */
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  /** Check whether a row document exists (for inline row detail). */
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  /** Load an existing row document. */
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  /** Create a new row document (returns encoded initial state). */
  createRowDocument?: (documentId: string) => Promise<Uint8Array | null>;
  /** Fire-and-forget: ask the server to duplicate the row document with inline DB deep copy. */
  duplicateRowDocument?: (databaseId: string, sourceRowId: string, newRowId: string, clientDocStateB64?: string) => Promise<void>;
  /** Resolve a database ID to its primary view ID. */
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;

  // ── Word count ─────────────────────────────────────────────────────
  /** Get the cached word/character count for a document. */
  getWordCount?: (viewId: string) => TextCount | undefined;
  /** Update the cached word/character count for a document. */
  setWordCount?: (viewId: string, count: TextCount) => void;

  // ── Collaboration history ──────────────────────────────────────────
  /** Fetch version history records for a document. Hook: `useCollabHistory()`. */
  getCollabHistory?: (viewId: string) => Promise<CollabVersionRecord[]>;
  /** Load a Yjs doc snapshot for a specific version. Hook: `useCollabHistory()`. */
  previewCollabVersion?: (viewId: string, versionId: string, collabType: Types) => Promise<YDoc | undefined>;
  /** Revert a document to a specific version. Hook: `useCollabHistory()`. */
  revertCollabVersion?: (viewId: string, versionId: string) => Promise<void>;

  // ── Workspace ──────────────────────────────────────────────────────
  /** Switch the active workspace. */
  onChangeWorkspace?: (workspaceId: string) => Promise<void>;
}

export const AppOperationsContext = createContext<AppOperationsContextType | null>(null);
