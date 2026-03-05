import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import promptsData from '@/components/chat/data/built_in_prompts.json';
import { parsePromptData } from '@/components/chat/lib/utils';
import {
  AiPrompt,
  AiPromptCategory,
  PromptDatabaseField,
  RawPromptData,
} from '@/components/chat/types/prompt';

const STORAGE_KEY = 'appflowy_prompt_db_config';

function getBuiltInPrompts(): AiPrompt[] {
  try {
    if (Array.isArray(promptsData.prompts)) {
      return parsePromptData(promptsData.prompts);
    }

    throw new Error(
      'Invalid JSON structure: "prompts" array not found in imported data.',
    );
  } catch (err) {
    console.error('Failed to load prompts:', err);
    return [];
  }
}

export interface PromptDatabaseConfiguration {
  databaseViewId: string;
  titleFieldId: string;
  contentFieldId: string;
  exampleFieldId: string | null;
  categoryFieldId: string | null;
}

interface PromptModalContextTypes {
  isOpen: boolean;
  currentPromptId: string | null;
  updateCurrentPromptId: (id: string | null) => void;
  prompts: AiPrompt[];
  openModal: () => void;
  closeModal: () => void;
  databaseConfig: PromptDatabaseConfiguration | null;
  fields: Array<PromptDatabaseField> | null;
  reloadDatabasePrompts: () => void;
  testDatabasePromptConfig?: (databaseViewId: string) => Promise<{
    config: PromptDatabaseConfiguration;
    fields: PromptDatabaseField[];
  }>;
  saveDatabaseConfig: (config: PromptDatabaseConfiguration) => void;
}

export const PromptModalContext = createContext<
  PromptModalContextTypes | undefined
>(undefined);

export function usePromptModal() {
  const context = useContext(PromptModalContext);

  if (!context) {
    throw new Error(
      'usePromptModal: usePromptModal must be used within a PromptModalProvider',
    );
  }

  return context;
}

export const PromptModalProvider = ({
  workspaceId,
  loadDatabasePrompts,
  testDatabasePromptConfig,
  children,
}: {
  workspaceId: string;
  loadDatabasePrompts?: (config: PromptDatabaseConfiguration) => Promise<{
    rawDatabasePrompts: RawPromptData[];
    fields: PromptDatabaseField[];
  }>;
  testDatabasePromptConfig?: (databaseViewId: string) => Promise<{
    config: PromptDatabaseConfiguration;
    fields: PromptDatabaseField[];
  }>;
  children: ReactNode;
}) => {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<AiPrompt[]>(getBuiltInPrompts);
  const [currentDatabaseConfig, setCurrentDatabaseConfig] =
    useState<PromptDatabaseConfiguration | null>(null);
  const [fields, setFields] = useState<PromptDatabaseField[]>([]);
  const promptLoadRequestIdRef = useRef(0);

  const applyPromptState = useCallback(
    (
      nextPrompts: AiPrompt[],
      nextDatabaseConfig: PromptDatabaseConfiguration | null,
      nextFields: PromptDatabaseField[],
    ) => {
      setPrompts(nextPrompts);
      setCurrentDatabaseConfig(nextDatabaseConfig);
      setFields(nextFields);
      setCurrentPromptId((prevPromptId) => {
        return nextPrompts.some((prompt) => prompt.id === prevPromptId)
          ? prevPromptId
          : null;
      });
    },
    [],
  );

  const fetchCustomPrompts = useCallback(async () => {
    const requestId = promptLoadRequestIdRef.current + 1;

    promptLoadRequestIdRef.current = requestId;

    const applyPromptStateIfCurrent = (
      nextPrompts: AiPrompt[],
      nextDatabaseConfig: PromptDatabaseConfiguration | null,
      nextFields: PromptDatabaseField[],
    ) => {
      if (promptLoadRequestIdRef.current !== requestId) {
        return;
      }

      applyPromptState(nextPrompts, nextDatabaseConfig, nextFields);
    };

    if (!loadDatabasePrompts) {
      applyPromptStateIfCurrent(getBuiltInPrompts(), null, []);
      return;
    }

    const storageKey = `${STORAGE_KEY}_${workspaceId}`;
    const savedConfig = localStorage.getItem(storageKey);

    if (!savedConfig) {
      applyPromptStateIfCurrent(getBuiltInPrompts(), null, []);
      return;
    }

    const config = JSON.parse(savedConfig) as PromptDatabaseConfiguration;

    try {
      const { rawDatabasePrompts, fields: loadedFields } =
        await loadDatabasePrompts(config);

      const categories = new Map(
        Object.values(AiPromptCategory).map((category) => [
          category,
          t(`chat.customPrompt.${category}`),
        ]),
      );

      const databasePrompts = parsePromptData(rawDatabasePrompts, categories);
      const builtInPrompts = getBuiltInPrompts();
      const nextPrompts = [
        ...builtInPrompts,
        ...databasePrompts.map((p) => ({
          ...p,
          isCustom: true,
          isFeatured: false,
        })),
      ];

      applyPromptStateIfCurrent(nextPrompts, config, loadedFields);
    } catch (err) {
      console.error(
        'Failed to load custom prompts using database config:',
        err,
      );
      applyPromptStateIfCurrent(getBuiltInPrompts(), null, []);
    }
  }, [applyPromptState, loadDatabasePrompts, t, workspaceId]);

  const saveDatabaseConfig = useCallback(
    (config: PromptDatabaseConfiguration) => {
      try {
        const storageKey = `${STORAGE_KEY}_${workspaceId}`;

        localStorage.setItem(storageKey, JSON.stringify(config));
        void fetchCustomPrompts();
      } catch (err) {
        console.error('Failed to save database config:', err);
      }
    },
    [fetchCustomPrompts, workspaceId],
  );

  useEffect(() => {
    void fetchCustomPrompts();
  }, [fetchCustomPrompts]);

  useEffect(() => {
    return () => {
      promptLoadRequestIdRef.current += 1;
    };
  }, []);

  const openModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  const contextValue = useMemo(
    () => ({
      isOpen,
      currentPromptId,
      updateCurrentPromptId: setCurrentPromptId,
      prompts,
      openModal,
      closeModal,
      databaseConfig: currentDatabaseConfig,
      fields,
      testDatabasePromptConfig,
      saveDatabaseConfig,
      reloadDatabasePrompts: fetchCustomPrompts,
    }),
    [
      isOpen,
      currentPromptId,
      prompts,
      openModal,
      closeModal,
      currentDatabaseConfig,
      fields,
      testDatabasePromptConfig,
      saveDatabaseConfig,
      fetchCustomPrompts,
    ],
  );

  return (
    <PromptModalContext.Provider value={contextValue}>
      {children}
    </PromptModalContext.Provider>
  );
};
