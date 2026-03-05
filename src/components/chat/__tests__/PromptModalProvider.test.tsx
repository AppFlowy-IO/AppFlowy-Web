import { expect, describe, it, beforeEach } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react';

import { PromptDatabaseField, RawPromptData } from '@/components/chat/types/prompt';

const mockT = jest.fn((key: string) => key);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

import {
  PromptDatabaseConfiguration,
  PromptModalProvider,
  usePromptModal,
} from '../provider/prompt-modal-provider';

type PromptModalState = ReturnType<typeof usePromptModal>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve,
  };
}

describe('PromptModalProvider', () => {
  const configA: PromptDatabaseConfiguration = {
    databaseViewId: 'database-view-a',
    titleFieldId: 'title-field-a',
    contentFieldId: 'content-field-a',
    exampleFieldId: null,
    categoryFieldId: null,
  };
  const configB: PromptDatabaseConfiguration = {
    databaseViewId: 'database-view-b',
    titleFieldId: 'title-field-b',
    contentFieldId: 'content-field-b',
    exampleFieldId: null,
    categoryFieldId: null,
  };
  const fieldsA: PromptDatabaseField[] = [
    {
      id: 'title-field-a',
      name: 'Title',
      isPrimary: true,
      isSelect: false,
    },
  ];
  const fieldsB: PromptDatabaseField[] = [
    {
      id: 'title-field-b',
      name: 'Title',
      isPrimary: true,
      isSelect: false,
    },
  ];
  const rawDatabasePromptsA: RawPromptData[] = [
    {
      id: 'custom-prompt-a',
      name: 'Custom prompt A',
      category: 'writing',
      content: 'Use the custom prompt A',
      example: 'An example A',
    },
  ];
  const rawDatabasePromptsB: RawPromptData[] = [
    {
      id: 'custom-prompt-b',
      name: 'Custom prompt B',
      category: 'writing',
      content: 'Use the custom prompt B',
      example: 'An example B',
    },
  ];
  const loadDatabasePrompts = jest.fn<
    Promise<{
      rawDatabasePrompts: RawPromptData[];
      fields: PromptDatabaseField[];
    }>,
    [PromptDatabaseConfiguration]
  >();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockT.mockImplementation((key: string) => key);
    loadDatabasePrompts.mockResolvedValue({
      rawDatabasePrompts: rawDatabasePromptsA,
      fields: fieldsA,
    });
  });

  const renderProvider = (workspaceId: string) => {
    let promptModalState: PromptModalState | null = null;

    const Observer = () => {
      promptModalState = usePromptModal();
      return null;
    };

    const renderWithWorkspace = (currentWorkspaceId: string) => (
      <PromptModalProvider
        workspaceId={currentWorkspaceId}
        loadDatabasePrompts={loadDatabasePrompts}
      >
        <Observer />
      </PromptModalProvider>
    );

    const renderResult = render(renderWithWorkspace(workspaceId));

    return {
      ...renderResult,
      getPromptModalState: () => promptModalState,
      rerenderWorkspace: (nextWorkspaceId: string) => {
        renderResult.rerender(renderWithWorkspace(nextWorkspaceId));
      },
    };
  };

  it('resets custom prompts when the next workspace has no saved config', async () => {
    localStorage.setItem(
      'appflowy_prompt_db_config_workspace-a',
      JSON.stringify(configA),
    );
    const { getPromptModalState, rerenderWorkspace } = renderProvider(
      'workspace-a',
    );

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toEqual(configA);
    });

    expect(getPromptModalState()?.fields).toEqual(fieldsA);
    expect(
      getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-a'),
    ).toBe(true);

    act(() => {
      getPromptModalState()?.updateCurrentPromptId('custom-prompt-a');
    });

    rerenderWorkspace('workspace-b');

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toBeNull();
      expect(getPromptModalState()?.fields).toEqual([]);
      expect(getPromptModalState()?.currentPromptId).toBeNull();
      expect(
        getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-a'),
      ).toBe(false);
    });

    expect(loadDatabasePrompts).toHaveBeenCalledTimes(1);
  });

  it('clears stale selected prompts when switching to a workspace with different custom prompts', async () => {
    localStorage.setItem(
      'appflowy_prompt_db_config_workspace-a',
      JSON.stringify(configA),
    );
    localStorage.setItem(
      'appflowy_prompt_db_config_workspace-b',
      JSON.stringify(configB),
    );
    loadDatabasePrompts.mockImplementation(async (config) => {
      return config.databaseViewId === configA.databaseViewId
        ? {
            rawDatabasePrompts: rawDatabasePromptsA,
            fields: fieldsA,
          }
        : {
            rawDatabasePrompts: rawDatabasePromptsB,
            fields: fieldsB,
          };
    });

    const { getPromptModalState, rerenderWorkspace } = renderProvider(
      'workspace-a',
    );

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toEqual(configA);
    });

    act(() => {
      getPromptModalState()?.updateCurrentPromptId('custom-prompt-a');
    });

    rerenderWorkspace('workspace-b');

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toEqual(configB);
    });

    expect(
      getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-a'),
    ).toBe(false);
    expect(
      getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-b'),
    ).toBe(true);
    expect(getPromptModalState()?.currentPromptId).toBeNull();
    expect(loadDatabasePrompts).toHaveBeenCalledTimes(2);
  });

  it('ignores stale async prompt loads after a workspace switch', async () => {
    const deferredWorkspaceALoad = createDeferred<{
      rawDatabasePrompts: RawPromptData[];
      fields: PromptDatabaseField[];
    }>();

    localStorage.setItem(
      'appflowy_prompt_db_config_workspace-a',
      JSON.stringify(configA),
    );
    localStorage.setItem(
      'appflowy_prompt_db_config_workspace-b',
      JSON.stringify(configB),
    );
    loadDatabasePrompts.mockImplementation((config) => {
      if (config.databaseViewId === configA.databaseViewId) {
        return deferredWorkspaceALoad.promise;
      }

      return Promise.resolve({
        rawDatabasePrompts: rawDatabasePromptsB,
        fields: fieldsB,
      });
    });

    const { getPromptModalState, rerenderWorkspace } = renderProvider(
      'workspace-a',
    );

    rerenderWorkspace('workspace-b');

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toEqual(configB);
    });

    await act(async () => {
      deferredWorkspaceALoad.resolve({
        rawDatabasePrompts: rawDatabasePromptsA,
        fields: fieldsA,
      });
      await deferredWorkspaceALoad.promise;
    });

    await waitFor(() => {
      expect(getPromptModalState()?.databaseConfig).toEqual(configB);
      expect(
        getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-b'),
      ).toBe(true);
      expect(
        getPromptModalState()?.prompts.some((prompt) => prompt.id === 'custom-prompt-a'),
      ).toBe(false);
    });

    expect(loadDatabasePrompts).toHaveBeenCalledTimes(2);
  });
});
