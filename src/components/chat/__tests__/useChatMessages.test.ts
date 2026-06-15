import { renderHook, act, waitFor } from '@testing-library/react';
import { expect, describe, it, beforeEach } from '@jest/globals';

// Mock the context providers
const mockFetchMessages = jest.fn();
const mockMessageIds = [1, 2, 3];

jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: jest.fn(() => ({
    messageIds: mockMessageIds,
  })),
}));

jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: jest.fn(() => ({
    fetchMessages: mockFetchMessages,
  })),
}));

// Import after mocks
import { useChatMessages } from '../components/chat-messages/use-chat-messages';

describe('useChatMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchMessages.mockReset();
  });

  describe('Initial State', () => {
    it('should return messageIds from context', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(result.current.messageIds).toEqual([1, 2, 3]);
    });

    it('should start with hasMore as true', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(result.current.hasMore).toBe(true);
    });

    it('should start with isLoading as true', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('fetchInitialMessages', () => {
    it('should call fetchMessages with default limit', async () => {
      mockFetchMessages.mockResolvedValue({
        messages: [{ message_id: 1 }],
        has_more: true,
      });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(mockFetchMessages).toHaveBeenCalledWith({ limit: 20 });
    });

    it('should update hasMore based on response', async () => {
      mockFetchMessages.mockResolvedValue({
        messages: [{ message_id: 1 }],
        has_more: false,
      });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.hasMore).toBe(false);
    });

    it('should set isLoading to false after fetch', async () => {
      mockFetchMessages.mockResolvedValue({
        messages: [],
        has_more: false,
      });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should return fetch data', async () => {
      const mockData = {
        messages: [{ message_id: 1 }, { message_id: 2 }],
        has_more: true,
      };
      mockFetchMessages.mockResolvedValue(mockData);

      const { result } = renderHook(() => useChatMessages());

      let fetchResult: any;
      await act(async () => {
        fetchResult = await result.current.fetchInitialMessages();
      });

      expect(fetchResult).toEqual(mockData);
    });

    it('should handle empty messages response', async () => {
      mockFetchMessages.mockResolvedValue({
        messages: [],
        has_more: false,
      });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.hasMore).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('loadMoreMessages', () => {
    it('should not call fetchMessages if lastMessageId is null', async () => {
      mockFetchMessages.mockResolvedValue({
        messages: [],
        has_more: false,
      });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.loadMoreMessages();
      });

      // fetchMessages should not be called since lastMessageId is null
      expect(mockFetchMessages).not.toHaveBeenCalled();
    });

    it('should call fetchMessages with before parameter after initial load', async () => {
      mockFetchMessages
        .mockResolvedValueOnce({
          messages: [{ message_id: 10 }, { message_id: 5 }],
          has_more: true,
        })
        .mockResolvedValueOnce({
          messages: [{ message_id: 3 }, { message_id: 1 }],
          has_more: false,
        });

      const { result } = renderHook(() => useChatMessages());

      // First load to set lastMessageId
      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      // Load more
      await act(async () => {
        await result.current.loadMoreMessages();
      });

      expect(mockFetchMessages).toHaveBeenCalledTimes(2);
      expect(mockFetchMessages).toHaveBeenLastCalledWith({
        limit: 20,
        before: 5,
      });
    });

    it('should update hasMore after loading more', async () => {
      mockFetchMessages
        .mockResolvedValueOnce({
          messages: [{ message_id: 10 }],
          has_more: true,
        })
        .mockResolvedValueOnce({
          messages: [{ message_id: 5 }],
          has_more: false,
        });

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMoreMessages();
      });

      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch error gracefully', async () => {
      mockFetchMessages.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useChatMessages());

      // Should not throw
      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should set isLoading to false even on error', async () => {
      mockFetchMessages.mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useChatMessages());

      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Loading State Management', () => {
    it('should set isLoading to true during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetchMessages.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useChatMessages());

      act(() => {
        result.current.fetchInitialMessages();
      });

      // isLoading should be true while fetching
      expect(result.current.isLoading).toBe(true);

      // Resolve the promise
      await act(async () => {
        resolvePromise!({ messages: [], has_more: false });
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Pagination Flow', () => {
    it('should correctly track lastMessageId through pagination', async () => {
      mockFetchMessages
        .mockResolvedValueOnce({
          messages: [
            { message_id: 100 },
            { message_id: 99 },
            { message_id: 98 },
          ],
          has_more: true,
        })
        .mockResolvedValueOnce({
          messages: [
            { message_id: 97 },
            { message_id: 96 },
          ],
          has_more: true,
        })
        .mockResolvedValueOnce({
          messages: [
            { message_id: 95 },
          ],
          has_more: false,
        });

      const { result } = renderHook(() => useChatMessages());

      // Initial fetch - last message is 98
      await act(async () => {
        await result.current.fetchInitialMessages();
      });

      // Load more - should use 98 as before, last becomes 96
      await act(async () => {
        await result.current.loadMoreMessages();
      });

      expect(mockFetchMessages).toHaveBeenLastCalledWith({
        limit: 20,
        before: 98,
      });

      // Load more again - should use 96 as before
      await act(async () => {
        await result.current.loadMoreMessages();
      });

      expect(mockFetchMessages).toHaveBeenLastCalledWith({
        limit: 20,
        before: 96,
      });

      // No more messages available
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('Hook Return Values', () => {
    it('should return all expected properties', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(result.current).toHaveProperty('messageIds');
      expect(result.current).toHaveProperty('hasMore');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('fetchInitialMessages');
      expect(result.current).toHaveProperty('loadMoreMessages');
    });

    it('should have fetchInitialMessages as a function', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(typeof result.current.fetchInitialMessages).toBe('function');
    });

    it('should have loadMoreMessages as a function', () => {
      mockFetchMessages.mockResolvedValue({ messages: [], has_more: false });

      const { result } = renderHook(() => useChatMessages());

      expect(typeof result.current.loadMoreMessages).toBe('function');
    });
  });
});
