import EventEmitter from 'events';

import { AxiosInstance } from 'axios';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BaseRange, Range } from 'slate';
import { Awareness } from 'y-protocols/awareness';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateRow,
  CreateRowDocument,
  DuplicateRowDocument,
  FontLayout,
  LineHeightLayout,
  LoadView,
  LoadViewMeta,
  UIVariant,
  View,
  CreatePagePayload,
  CreatePageResponse,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  DuplicatePageOperationOptions,
  TextCount,
  LoadDatabasePrompts,
  LoadRowDocument,
  TestDatabasePromptConfig,
  Subscription,
  MentionablePerson,
  MentionSearchContext,
  SearchMentions,
  DatabaseRelations,
  UpdatePagePayload,
  YDoc,
} from '@/application/types';

export interface EditorLayoutStyle {
  fontLayout: FontLayout;
  font: string;
  lineHeightLayout: LineHeightLayout;
}

export type EditorContentPadding = 'page' | 'template';

export const defaultLayoutStyle: EditorLayoutStyle = {
  fontLayout: FontLayout.normal,
  font: '',
  lineHeightLayout: LineHeightLayout.normal,
};

export interface Decorate {
  range: BaseRange;
  class_name: string;
}

/**
 * Local editor state managed within the EditorContextProvider.
 * Split into a separate context so consumers that only need config props
 * don't re-render when local state (decorateState, selectedBlockIds, collapsedMap) changes.
 */
export interface EditorLocalState {
  decorateState: Record<string, Decorate>;
  addDecorate: (range: BaseRange, class_name: string, type: string) => void;
  removeDecorate: (type: string) => void;
  selectedBlockIds: string[];
  setSelectedBlockIds: React.Dispatch<React.SetStateAction<string[]>>;
  collapsedMap: Record<string, boolean>;
  toggleCollapsed: (blockId: string) => void;
}

/**
 * Config props passed from the parent into the editor.
 * These change infrequently compared to local state.
 */
export interface EditorContextState {
  fullWidth?: boolean;
  contentPadding?: EditorContentPadding;
  workspaceId: string;
  viewId: string;
  readOnly: boolean;
  canComment?: boolean;
  /** Canonical server write permission, independent from editor UI state. */
  canWrite?: boolean;
  /** Canonical server share-management permission for embedded databases. */
  canShare?: boolean;
  layoutStyle?: EditorLayoutStyle;
  codeGrammars?: Record<string, string>;
  addCodeGrammars?: (blockId: string, grammar: string) => void;
  navigateToView?: (viewId: string, blockOrRowId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  loadView?: LoadView;
  loadRowDocument?: LoadRowDocument;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  createRowDocument?: CreateRowDocument;
  duplicateRowDocument?: DuplicateRowDocument;
  createRow?: CreateRow;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  readSummary?: boolean;
  jumpBlockId?: string;
  onJumpedBlockId?: () => void;
  variant?: UIVariant;
  onRendered?: () => void;
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  deletePage?: (viewId: string) => Promise<void>;
  duplicatePage?: (viewId: string, options?: DuplicatePageOperationOptions) => Promise<void>;
  openPageModal?: (viewId: string) => void;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  onWordCountChange?: (viewId: string, props: TextCount) => void;
  uploadFile?: (file: File, onProgress?: (progress: number) => void) => Promise<string>;
  requestInstance?: AxiosInstance | null;
  getMoreAIContext?: () => string;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  getSubscriptions?: (() => Promise<Subscription[]>) | undefined;
  eventEmitter?: EventEmitter;
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  searchMentions?: SearchMentions;
  mentionContext?: MentionSearchContext;
  awareness?: Awareness;
  getDeviceId?: () => string;
  databaseRelations?: DatabaseRelations;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  loadDatabaseRelations?: (options?: { refresh?: boolean }) => Promise<DatabaseRelations | undefined>;
}

export const EditorContext = createContext<EditorContextState | undefined>(undefined);
export const EditorLocalStateContext = createContext<EditorLocalState | undefined>(undefined);

export const EditorContextProvider = ({
  children,
  fullWidth,
  contentPadding,
  workspaceId,
  viewId,
  readOnly,
  canComment,
  canWrite,
  canShare,
  layoutStyle,
  codeGrammars,
  addCodeGrammars,
  navigateToView,
  loadViewMeta,
  loadView,
  loadRowDocument,
  checkIfRowDocumentExists,
  createRowDocument,
  duplicateRowDocument,
  createRow,
  bindViewSync,
  scheduleDeferredCleanup,
  readSummary,
  jumpBlockId,
  onJumpedBlockId,
  variant,
  onRendered,
  addPage,
  updatePage,
  deletePage,
  duplicatePage,
  openPageModal,
  loadViews,
  createDatabaseView,
  onWordCountChange,
  uploadFile,
  requestInstance,
  getMoreAIContext,
  loadDatabasePrompts,
  testDatabasePromptConfig,
  getSubscriptions,
  eventEmitter,
  getMentionUser,
  searchMentions,
  mentionContext,
  awareness,
  getDeviceId,
  databaseRelations,
  getViewIdFromDatabaseId,
  loadDatabaseRelations,
}: EditorContextState & { children: React.ReactNode }) => {
  const [decorateState, setDecorateState] = useState<Record<string, Decorate>>({});
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const addDecorate = useCallback((range: BaseRange, class_name: string, type: string) => {
    setDecorateState((prev) => {
      const oldValue = prev[type];

      if (oldValue && Range.equals(oldValue.range, range) && oldValue.class_name === class_name) {
        return prev;
      }

      return {
        ...prev,
        [type]: {
          range,
          class_name,
        },
      };
    });
  }, []);

  const removeDecorate = useCallback((type: string) => {
    setDecorateState((prev) => {
      if (prev[type] === undefined) {
        return prev;
      }

      const newState = { ...prev };

      delete newState[type];
      return newState;
    });
  }, []);

  const toggleCollapsed = useCallback((blockId: string) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [blockId]: !prev[blockId],
    }));
  }, []);

  const configValue = useMemo(
    () => ({
      fullWidth,
      contentPadding,
      workspaceId,
      viewId,
      readOnly,
      canComment,
      canWrite,
      canShare,
      layoutStyle,
      codeGrammars,
      addCodeGrammars,
      navigateToView,
      loadViewMeta,
      loadView,
      loadRowDocument,
      checkIfRowDocumentExists,
      createRowDocument,
      duplicateRowDocument,
      createRow,
      bindViewSync,
      scheduleDeferredCleanup,
      readSummary,
      jumpBlockId,
      onJumpedBlockId,
      variant,
      onRendered,
      addPage,
      updatePage,
      deletePage,
      duplicatePage,
      openPageModal,
      loadViews,
      createDatabaseView,
      onWordCountChange,
      uploadFile,
      requestInstance,
      getMoreAIContext,
      loadDatabasePrompts,
      testDatabasePromptConfig,
      getSubscriptions,
      eventEmitter,
      getMentionUser,
      searchMentions,
      mentionContext,
      awareness,
      getDeviceId,
      databaseRelations,
      getViewIdFromDatabaseId,
      loadDatabaseRelations,
    }),
    [
      fullWidth,
      contentPadding,
      workspaceId,
      viewId,
      readOnly,
      canComment,
      canWrite,
      canShare,
      layoutStyle,
      codeGrammars,
      addCodeGrammars,
      navigateToView,
      loadViewMeta,
      loadView,
      loadRowDocument,
      checkIfRowDocumentExists,
      createRowDocument,
      duplicateRowDocument,
      createRow,
      bindViewSync,
      scheduleDeferredCleanup,
      readSummary,
      jumpBlockId,
      onJumpedBlockId,
      variant,
      onRendered,
      addPage,
      updatePage,
      deletePage,
      duplicatePage,
      openPageModal,
      loadViews,
      createDatabaseView,
      onWordCountChange,
      uploadFile,
      requestInstance,
      getMoreAIContext,
      loadDatabasePrompts,
      testDatabasePromptConfig,
      getSubscriptions,
      eventEmitter,
      getMentionUser,
      searchMentions,
      mentionContext,
      awareness,
      getDeviceId,
      databaseRelations,
      getViewIdFromDatabaseId,
      loadDatabaseRelations,
    ]
  );

  const localStateValue = useMemo(
    () => ({
      decorateState,
      addDecorate,
      removeDecorate,
      selectedBlockIds,
      setSelectedBlockIds,
      collapsedMap,
      toggleCollapsed,
    }),
    [decorateState, addDecorate, removeDecorate, selectedBlockIds, collapsedMap, toggleCollapsed]
  );

  return (
    <EditorContext.Provider value={configValue}>
      <EditorLocalStateContext.Provider value={localStateValue}>{children}</EditorLocalStateContext.Provider>
    </EditorContext.Provider>
  );
};

export function useEditorContext() {
  const context = useContext(EditorContext);

  if (!context) {
    throw new Error('useEditorContext must be used within an EditorContextProvider');
  }

  return context;
}

export function useEditorLocalState() {
  const context = useContext(EditorLocalStateContext);

  if (!context) {
    throw new Error('useEditorLocalState must be used within an EditorContextProvider');
  }

  return context;
}

export function useBlockSelected(blockId: string) {
  const { selectedBlockIds } = useEditorLocalState();

  return selectedBlockIds?.includes(blockId);
}
