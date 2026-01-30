import EventEmitter from 'events';

import { AxiosInstance } from 'axios';
import { createContext, useCallback, useContext, useState } from 'react';
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
  createRow?: CreateRow;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  readSummary?: boolean;
  jumpBlockId?: string;
  onJumpedBlockId?: () => void;
  variant?: UIVariant;
  onRendered?: () => void;
  decorateState?: Record<string, Decorate>;
  addDecorate?: (range: BaseRange, class_name: string, type: string) => void;
  removeDecorate?: (type: string) => void;
  selectedBlockIds?: string[];
  setSelectedBlockIds?: React.Dispatch<React.SetStateAction<string[]>>;
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  openPageModal?: (viewId: string) => void;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  onWordCountChange?: (viewId: string, props: TextCount) => void;
  uploadFile?: (file: File) => Promise<string>;
  requestInstance?: AxiosInstance | null;
  getMoreAIContext?: () => string;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  getSubscriptions?: (() => Promise<Subscription[]>) | undefined;
  eventEmitter?: EventEmitter;
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  awareness?: Awareness;
  getDeviceId?: () => string;
  collapsedMap?: Record<string, boolean>;
  toggleCollapsed?: (blockId: string) => void;
  databaseRelations?: DatabaseRelations;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
}

export const EditorContext = createContext<EditorContextState>({
  readOnly: true,
  layoutStyle: defaultLayoutStyle,
  codeGrammars: {},
  viewId: '',
  workspaceId: '',
});

export const EditorContextProvider = ({ children, ...props }: EditorContextState & { children: React.ReactNode }) => {
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

  return (
    <EditorContext.Provider
      value={{
        ...props,
        decorateState,
        addDecorate,
        removeDecorate,
        setSelectedBlockIds,
        selectedBlockIds,
        collapsedMap,
        toggleCollapsed,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
};

export function useEditorContext() {
  return useContext(EditorContext);
}

export function useBlockSelected(blockId: string) {
  const { selectedBlockIds } = useEditorContext();

  return selectedBlockIds?.includes(blockId);
}
