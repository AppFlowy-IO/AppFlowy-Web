import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import BestMatch from '../BestMatch';

import type { ReactNode } from 'react';

const mockUseAIEnabled = jest.fn();
const mockSearchWorkspaceDocumentPage = jest.fn();
const mockGenerateSearchSummary = jest.fn();
const mockAppOutline: never[] = [];
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => mockUseAIEnabled(),
  useAppOutline: () => mockAppOutline,
  useCurrentWorkspaceId: () => 'workspace-id',
}));

jest.mock('@/application/services/domains', () => ({
  SearchService: {
    searchWorkspaceDocumentPage: (...args: unknown[]) => mockSearchWorkspaceDocumentPage(...args),
    generateSearchSummary: (...args: unknown[]) => mockGenerateSearchSummary(...args),
  },
}));

jest.mock('@/components/app/search/SearchAIOverview', () => ({
  SearchAIOverview: () => <div data-testid='ai-overview' />,
}));

jest.mock('@/components/app/search/ViewList', () => ({
  __esModule: true,
  default: ({ header }: { header?: ReactNode }) => (
    <div data-testid='view-list'>{header ? <div data-testid='search-header'>{header}</div> : null}</div>
  ),
}));

function renderBestMatch() {
  return render(<BestMatch askingAI={false} searchValue='' onAskAI={jest.fn()} onClose={jest.fn()} />);
}

describe('BestMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAIEnabled.mockReturnValue(true);
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [],
      next_offset: null,
    });
    mockGenerateSearchSummary.mockResolvedValue({ summaries: [] });
  });

  it('does not mount the AI overview header when server info disables AI', () => {
    mockUseAIEnabled.mockReturnValue(false);

    renderBestMatch();

    expect(screen.queryByTestId('search-header')).toBeNull();
    expect(screen.queryByTestId('ai-overview')).toBeNull();
  });

  it('mounts the AI overview header when AI is enabled', () => {
    renderBestMatch();

    expect(screen.getByTestId('search-header')).toBeTruthy();
    expect(screen.getByTestId('ai-overview')).toBeTruthy();
  });
});
