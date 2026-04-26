import EventEmitter from 'events';

import { AxiosInstance } from 'axios';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BaseRange, Range } from 'slate';
import { Awareness } from 'y-protocols/awareness';

import {
  CreateRow,
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
  DuplicatePageOptions,
  TextCount,
  LoadDatabasePrompts,
  TestDatabasePromptConfig,
  Subscription,
  MentionablePerson,
  DatabaseRelations,
  YDoc,
} from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';

export interface EditorLayoutStyle {
  fontLayout: FontLayout;
  font: string;
  lineHeightLayout: LineHeightLayout;
}

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
  workspaceId: string;
  viewId: string;
  readOnly: boolean;
  layoutStyle?: EditorLayoutStyle;
  codeGrammars?: Record<string, string>;
  addCodeGrammars?: (blockId: string, grammar: string) => void;
  navigateToView?: (viewId: string, blockOrRowId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  loadView?: LoadView;
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  createRow?: CreateRow;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  readSummary?: boolean;
  jumpBlockId?: string;
  onJumpedBlockId?: () => void;
  variant?: UIVariant;
  onRendered?: () => void;
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  duplicatePage?: (viewId: string, options?: DuplicatePageOptions) => Promise<void>;
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
  awareness?: Awareness;
  getDeviceId?: () => string;
  databaseRelations?: DatabaseRelations;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
}

export const EditorContext = createContext<EditorContextState | undefined>(undefined);
export const EditorLocalStateContext = createContext<EditorLocalState | undefined>(undefined);

export const EditorContextProvider = ({
  children,
  fullWidth,
  workspaceId,
  viewId,
  readOnly,
  layoutStyle,
  codeGrammars,
  addCodeGrammars,
  navigateToView,
  loadViewMeta,
  loadView,
  loadRowDocument,
  createRow,
  bindViewSync,
  readSummary,
  jumpBlockId,
  onJumpedBlockId,
  variant,
  onRendered,
  addPage,
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
      workspaceId,
      viewId,
      readOnly,
      layoutStyle,
      codeGrammars,
      addCodeGrammars,
      navigateToView,
      loadViewMeta,
      loadView,
      loadRowDocument,
      createRow,
      bindViewSync,
      readSummary,
      jumpBlockId,
      onJumpedBlockId,
      variant,
      onRendered,
      addPage,
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
      awareness,
      getDeviceId,
      databaseRelations,
      getViewIdFromDatabaseId,
      loadDatabaseRelations,
    }),
    [
      fullWidth,
      workspaceId,
      viewId,
      readOnly,
      layoutStyle,
      codeGrammars,
      addCodeGrammars,
      navigateToView,
      loadViewMeta,
      loadView,
      loadRowDocument,
      createRow,
      bindViewSync,
      readSummary,
      jumpBlockId,
      onJumpedBlockId,
      variant,
      onRendered,
      addPage,
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
      <EditorLocalStateContext.Provider value={localStateValue}>
        {children}
      </EditorLocalStateContext.Provider>
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
