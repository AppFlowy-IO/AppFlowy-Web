import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { RecentOverviewTopic } from '@/application/services/domains/search';
import type { View } from '@/application/types';

import RecentOverviews from '../RecentOverviews';

const mockRead = jest.fn();
const mockGetViews = jest.fn();
const mockNavigate = jest.fn();
const mockOutline = [{ view_id: 'known', name: 'Approved decision', children: [] }] as unknown as View[];

jest.mock('@/application/services/domains', () => ({
  SearchService: { getRecentOverviews: (...args: unknown[]) => mockRead(...args) },
  ViewService: { getMultiple: (...args: unknown[]) => mockGetViews(...args) },
}));
jest.mock('@/components/app/app.hooks', () => ({ useAppOutline: () => mockOutline, useToView: () => mockNavigate }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: { time?: string; defaultValue?: string }) =>
      options?.time ? `Generated ${options.time}` : options?.defaultValue || key,
  }),
}));
jest.mock('@appflowyinc/editor', () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/chat/components/chat-messages/answer-md', () => ({
  AnswerMd: ({ mdContent }: { mdContent: string }) => <p>{mdContent}</p>,
}));
jest.mock('@/components/_shared/view-icon/PageIcon', () => ({ __esModule: true, default: () => null }));

function topic(title: string, sources: string[] = []): RecentOverviewTopic {
  return { title, generated_at: '2026-11-19T07:30:00Z', summary: { content: `Saved answer for ${title}`, sources } };
}

describe('cached search overviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetViews.mockResolvedValue([]);
  });

  it('opens the first valid topic in server order, lets the reader select another and caps the list at three', async () => {
    mockRead.mockResolvedValue({
      topics: [topic('Decision', ['known']), topic('Milestones'), topic('Tasks'), topic('Overflow')],
    });
    const onClose = jest.fn();
    const onAvailabilityChange = jest.fn();

    const { unmount } = render(
      <RecentOverviews workspaceId='a' onClose={onClose} onAvailabilityChange={onAvailabilityChange} />
    );

    expect(await screen.findByText('Saved answer for Decision')).toBeTruthy();
    expect(screen.getAllByText('Generated', { exact: false })[0].tagName).toBe('TIME');
    expect(screen.queryByText('Saved answer for Milestones')).toBeNull();
    expect(screen.queryByText('Overflow')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reference sources' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approved decision' }));
    expect(mockNavigate).toHaveBeenCalledWith('known', undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Milestones/ }));
    expect(await screen.findByText('Saved answer for Milestones')).toBeTruthy();
    expect(screen.queryByText('Saved answer for Decision')).toBeNull();
    expect(screen.getByRole('button', { name: /Milestones/ }).getAttribute('aria-expanded')).toBe('true');
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false);
  });

  it.each([404, 500, 'empty'])('silently leaves Recent available for %s', async (outcome) => {
    if (outcome === 'empty') mockRead.mockResolvedValue({ topics: [] });
    else mockRead.mockRejectedValue({ status: outcome });
    const { container } = render(<RecentOverviews workspaceId='a' onClose={jest.fn()} />);

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    expect(container.childElementCount).toBe(0);
  });

  it('aborts a closed workspace read and ignores it even if the response arrives later', async () => {
    let resolve!: (value: { topics: RecentOverviewTopic[] }) => void;

    mockRead
      .mockReturnValueOnce(
        new Promise((accept) => {
          resolve = accept;
        })
      )
      .mockResolvedValueOnce({ topics: [topic('Current workspace')] });
    const { rerender } = render(<RecentOverviews key='a' workspaceId='a' onClose={jest.fn()} />);

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    const signal = mockRead.mock.calls[0][1] as AbortSignal;

    rerender(<RecentOverviews key='b' workspaceId='b' onClose={jest.fn()} />);
    expect(signal.aborted).toBe(true);
    expect(await screen.findByText('Saved answer for Current workspace')).toBeTruthy();
    await act(async () => resolve({ topics: [topic('Obsolete workspace')] }));
    expect(screen.queryByText('Obsolete workspace')).toBeNull();
  });
});
