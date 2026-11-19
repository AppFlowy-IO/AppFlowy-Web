import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';

import type { Suggestions } from '@/components/chat/types/request';

import { SuggestionsProvider, useSuggestionsContext } from '../suggestions-provider';

const mockGetSuggestions = jest.fn();
const mockToastError = jest.fn();

jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ chatId: 'chat', requestInstance: { getSuggestions: mockGetSuggestions } }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const wrapper = ({ children }: { children: ReactNode }) => <SuggestionsProvider>{children}</SuggestionsProvider>;

describe('answer-owned suggestions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps an obsolete answer response from replacing the new answer suggestions', async () => {
    const older = deferred<Suggestions>();
    const newer: Suggestions = { message_id: '20', items: [{ content: 'Current suggestion' }] };

    mockGetSuggestions.mockReturnValueOnce(older.promise).mockResolvedValueOnce(newer);
    const { result } = renderHook(useSuggestionsContext, { wrapper });
    const controller = new AbortController();
    let pending!: Promise<void>;

    act(() => {
      pending = result.current.startFetchSuggestions(10, () => !controller.signal.aborted);
    });
    controller.abort();
    await act(async () => {
      await result.current.startFetchSuggestions(20);
    });
    await act(async () => {
      older.resolve({ message_id: '10', items: [{ content: 'Obsolete suggestion' }] });
      await pending;
    });

    expect(result.current.getMessageSuggestions(10)).toBeUndefined();
    expect(result.current.getMessageSuggestions(20)).toEqual(newer);
  });

  it('ignores a suggestion failure after the answer owner is disposed', async () => {
    const response = deferred<never>();

    mockGetSuggestions.mockReturnValueOnce(response.promise);
    const { result } = renderHook(useSuggestionsContext, { wrapper });
    const controller = new AbortController();
    let pending!: Promise<void>;

    act(() => {
      pending = result.current.startFetchSuggestions(10, () => !controller.signal.aborted);
    });
    controller.abort();
    await act(async () => {
      response.reject(new Error('Obsolete failure'));
      await pending;
    });

    expect(mockToastError).not.toHaveBeenCalled();
  });
});
