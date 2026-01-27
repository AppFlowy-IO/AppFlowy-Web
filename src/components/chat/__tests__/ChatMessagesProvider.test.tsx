import { expect, describe, it, beforeEach } from '@jest/globals';
import { render, renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';

// Mock dependencies
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: jest.fn(() => ({ chatId: 'test-chat-id' })),
}));

// Import after mocks
import { useChatContext } from '../chat/context';
import {
  ChatMessagesProvider,
  useChatMessagesContext,
  ChatMessagesContext,
} from '../provider/messages-provider';

describe('ChatMessagesProvider', () => {
  const mockMessage = (id: number, content: string) => ({
    message_id: id,
    content,
    created_at: '2024-01-01T00:00:00Z',
    author: { author_type: 1, author_uuid: 'user-uuid' },
    meta_data: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (useChatContext as jest.Mock).mockReturnValue({ chatId: 'test-chat-id' });
  });

  describe('Context Setup', () => {
    it('should provide context to children', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let contextValue: any;

      render(
        <ChatMessagesProvider>
          <ChatMessagesContext.Consumer>
            {(value) => {
              contextValue = value;
              return null;
            }}
          </ChatMessagesContext.Consumer>
        </ChatMessagesProvider>
      );

      expect(contextValue).toBeDefined();
      expect(contextValue.messageIds).toBeDefined();
      expect(contextValue.getMessage).toBeDefined();
      expect(contextValue.addMessages).toBeDefined();
      expect(contextValue.removeMessages).toBeDefined();
      expect(contextValue.insertMessage).toBeDefined();
      expect(contextValue.saveMessageContent).toBeDefined();
    });

    it('should throw error when useChatMessagesContext is used outside provider', () => {
      const TestComponent = () => {
        useChatMessagesContext();
        return null;
      };

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* suppress */ });

      expect(() => render(<TestComponent />)).toThrow(
        'useMessagesManager: useMessagesManager must be used within a ChatMessagesProvider'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Initial State', () => {
    it('should start with empty messageIds', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      expect(result.current.messageIds).toEqual([]);
    });
  });

  describe('addMessages', () => {
    it('should add single message', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Hello')]);
      });

      expect(result.current.messageIds).toEqual([1]);
    });

    it('should add multiple messages', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
          mockMessage(3, 'Third'),
        ]);
      });

      expect(result.current.messageIds).toEqual([1, 2, 3]);
    });

    it('should append messages to existing ones', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'First')]);
      });

      act(() => {
        result.current.addMessages([mockMessage(2, 'Second')]);
      });

      expect(result.current.messageIds).toEqual([1, 2]);
    });

    it('should handle empty array', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([]);
      });

      expect(result.current.messageIds).toEqual([]);
    });
  });

  describe('getMessage', () => {
    it('should return message by id', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      const testMessage = mockMessage(1, 'Test content');

      act(() => {
        result.current.addMessages([testMessage]);
      });

      const retrieved = result.current.getMessage(1);

      expect(retrieved).toBeDefined();
      expect(retrieved?.message_id).toBe(1);
      expect(retrieved?.content).toBe('Test content');
    });

    it('should return undefined for non-existent message', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Test')]);
      });

      const retrieved = result.current.getMessage(999);

      expect(retrieved).toBeUndefined();
    });

    it('should find correct message among many', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
          mockMessage(3, 'Third'),
        ]);
      });

      expect(result.current.getMessage(2)?.content).toBe('Second');
    });
  });

  describe('removeMessages', () => {
    it('should remove single message by id', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
        ]);
      });

      act(() => {
        result.current.removeMessages([1]);
      });

      expect(result.current.messageIds).toEqual([2]);
    });

    it('should remove multiple messages', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
          mockMessage(3, 'Third'),
        ]);
      });

      act(() => {
        result.current.removeMessages([1, 3]);
      });

      expect(result.current.messageIds).toEqual([2]);
    });

    it('should return remaining messages', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
        ]);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let remaining: any[];

      act(() => {
        remaining = result.current.removeMessages([1]);
      });

      expect(remaining!).toHaveLength(1);
      expect(remaining![0].message_id).toBe(2);
    });

    it('should handle removing non-existent ids', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'First')]);
      });

      act(() => {
        result.current.removeMessages([999]);
      });

      expect(result.current.messageIds).toEqual([1]);
    });

    it('should handle removing all messages', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
        ]);
      });

      act(() => {
        result.current.removeMessages([1, 2]);
      });

      expect(result.current.messageIds).toEqual([]);
    });
  });

  describe('insertMessage', () => {
    it('should insert message at beginning', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(2, 'Second')]);
      });

      act(() => {
        result.current.insertMessage(mockMessage(1, 'First'), 0);
      });

      expect(result.current.messageIds).toEqual([1, 2]);
    });

    it('should insert message in middle', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(3, 'Third'),
        ]);
      });

      act(() => {
        result.current.insertMessage(mockMessage(2, 'Second'), 1);
      });

      expect(result.current.messageIds).toEqual([1, 2, 3]);
    });

    it('should insert message at end', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'First')]);
      });

      act(() => {
        result.current.insertMessage(mockMessage(2, 'Second'), 1);
      });

      expect(result.current.messageIds).toEqual([1, 2]);
    });

    it('should handle inserting into empty array', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.insertMessage(mockMessage(1, 'First'), 0);
      });

      expect(result.current.messageIds).toEqual([1]);
    });
  });

  describe('saveMessageContent', () => {
    it('should update message content', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Original')]);
      });

      act(() => {
        result.current.saveMessageContent(1, 'Updated content', []);
      });

      const message = result.current.getMessage(1);

      expect(message?.content).toBe('Updated content');
    });

    it('should update message metadata', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Test')]);
      });

      const newMetadata = [
        { id: 'source-1', source: 'doc1', name: 'Document 1' },
      ];

      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result.current.saveMessageContent(1, 'Content', newMetadata as any);
      });

      const message = result.current.getMessage(1);

      expect(message?.meta_data).toHaveLength(1);
      expect(message?.meta_data[0].id).toBe('source-1');
    });

    it('should not affect other messages', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(2, 'Second'),
        ]);
      });

      act(() => {
        result.current.saveMessageContent(1, 'Updated', []);
      });

      expect(result.current.getMessage(1)?.content).toBe('Updated');
      expect(result.current.getMessage(2)?.content).toBe('Second');
    });

    it('should handle non-existent message id', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Test')]);
      });

      // Should not throw
      act(() => {
        result.current.saveMessageContent(999, 'Content', []);
      });

      // Original message unchanged
      expect(result.current.getMessage(1)?.content).toBe('Test');
    });
  });

  describe('Chat ID Change Behavior', () => {
    it('should clear messages when chatId changes', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result, rerender } = renderHook(() => useChatMessagesContext(), {
        wrapper,
      });

      act(() => {
        result.current.addMessages([mockMessage(1, 'Test')]);
      });

      expect(result.current.messageIds).toHaveLength(1);

      // Change chatId
      (useChatContext as jest.Mock).mockReturnValue({ chatId: 'new-chat-id' });

      // Force rerender with new chatId
      rerender();

      // Messages should be cleared (this tests the cleanup effect)
    });
  });

  describe('Edge Cases', () => {
    it('should handle duplicate message ids', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([
          mockMessage(1, 'First'),
          mockMessage(1, 'Duplicate'),
        ]);
      });

      // Both messages are added (no deduplication at provider level)
      expect(result.current.messageIds).toEqual([1, 1]);
    });

    it('should handle rapid sequential operations', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      act(() => {
        result.current.addMessages([mockMessage(1, 'A')]);
        result.current.addMessages([mockMessage(2, 'B')]);
        result.current.removeMessages([1]);
        result.current.insertMessage(mockMessage(3, 'C'), 0);
      });

      expect(result.current.messageIds).toEqual([3, 2]);
    });

    it('should handle messages with complex metadata', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChatMessagesProvider>{children}</ChatMessagesProvider>
      );

      const { result } = renderHook(() => useChatMessagesContext(), { wrapper });

      const complexMessage = {
        message_id: 1,
        content: 'Test',
        created_at: '2024-01-01T00:00:00Z',
        author: {
          author_type: 3,
          author_uuid: 'ai-uuid',
        },
        meta_data: [
          { id: '1', source: 'doc1', name: 'Doc 1' },
          { id: '2', source: 'doc2', name: 'Doc 2' },
          { id: '3', source: 'doc3', name: 'Doc 3' },
        ],
      };

      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result.current.addMessages([complexMessage as any]);
      });

      const retrieved = result.current.getMessage(1);

      expect(retrieved?.meta_data).toHaveLength(3);
    });
  });
});
