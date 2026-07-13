import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import axios, { AxiosInstance } from 'axios';

// Mock axios
jest.mock('axios');

// Mock the request utilities
jest.mock('@/components/chat/lib/requets', () => ({
  createInitialInstance: jest.fn(() => ({
    defaults: { baseURL: 'https://test.appflowy.cloud' },
    interceptors: {
      request: { use: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  })),
  getAccessToken: jest.fn(() => 'mock-token'),
  requestInterceptor: jest.fn(),
  readableStreamToAsyncIterator: jest.fn(),
}));

jest.mock('@/components/chat/lib/utils', () => ({
  convertToPageData: jest.fn((data) => data),
}));

jest.mock('@/components/chat/lib/views', () => ({
  ...jest.requireActual('@/components/chat/lib/views'),
  findView: jest.fn(),
}));

// Import after mocks
import { ChatRequest } from '../request/chat-request';

describe('ChatRequest', () => {
  let chatRequest: ChatRequest;
  let mockAxiosInstance: jest.Mocked<AxiosInstance>;

  const workspaceId = 'workspace-123';
  const chatId = 'chat-456';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      defaults: { baseURL: 'https://test.appflowy.cloud' },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<AxiosInstance>;

    chatRequest = new ChatRequest(workspaceId, chatId, mockAxiosInstance);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create instance with workspaceId and chatId', () => {
      const request = new ChatRequest('ws-1', 'chat-1', mockAxiosInstance);
      expect(request).toBeDefined();
    });

    it('should create instance without parameters', () => {
      const request = new ChatRequest(undefined, undefined, mockAxiosInstance);
      expect(request).toBeDefined();
    });

    it('should use provided axios instance', () => {
      const customAxios = {
        ...mockAxiosInstance,
        defaults: { baseURL: 'https://custom.url' },
      } as unknown as jest.Mocked<AxiosInstance>;

      const request = new ChatRequest('ws', 'chat', customAxios);
      expect(request).toBeDefined();
    });
  });

  describe('getCurrentUser', () => {
    it('should return user data on success', async () => {
      const mockUserData = {
        uuid: 'user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        metadata: { icon_url: 'https://avatar.url' },
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: mockUserData },
      });

      const user = await chatRequest.getCurrentUser();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/user/profile');
      expect(user).toEqual({
        uuid: 'user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        avatar: 'https://avatar.url',
      });
    });

    it('should reject when API returns error code', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 1, message: 'Unauthorized' },
      });

      await expect(chatRequest.getCurrentUser()).rejects.toEqual({
        code: 1,
        message: 'Unauthorized',
      });
    });

    it('should reject when data is missing', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: undefined },
      });

      await expect(chatRequest.getCurrentUser()).rejects.toBeDefined();
    });
  });

  describe('getChatMessages', () => {
    it('should fetch messages successfully', async () => {
      const mockMessages = {
        messages: [
          { message_id: 1, content: 'Hello', author: { author_type: 1 } },
          { message_id: 2, content: 'Hi there', author: { author_type: 3 } },
        ],
        has_more: false,
        total: 2,
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: mockMessages },
      });

      const result = await chatRequest.getChatMessages();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/message`, {
        params: undefined,
      });
      expect(result).toEqual(mockMessages);
    });

    it('should pass pagination parameters', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: { messages: [], has_more: false, total: 0 } },
      });

      await chatRequest.getChatMessages({ limit: 10, offset: 20 });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(expect.any(String), { params: { limit: 10, offset: 20 } });
    });

    it('should reject when workspaceId is not defined', async () => {
      const requestWithoutWorkspace = new ChatRequest(undefined, chatId, mockAxiosInstance);

      await expect(requestWithoutWorkspace.getChatMessages()).rejects.toBe('workspaceId or chatId is not defined');
    });

    it('should reject when chatId is not defined', async () => {
      const requestWithoutChat = new ChatRequest(workspaceId, undefined, mockAxiosInstance);

      await expect(requestWithoutChat.getChatMessages()).rejects.toBe('workspaceId or chatId is not defined');
    });

    it('should reject when API returns error', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 500, message: 'Internal server error' },
      });

      await expect(chatRequest.getChatMessages()).rejects.toEqual({
        code: 500,
        message: 'Internal server error',
      });
    });
  });

  describe('submitQuestion', () => {
    it('should submit question successfully', async () => {
      const mockResponse = {
        message_id: 123,
        content: 'Test question',
        author: { author_type: 1, author_uuid: 'user-uuid' },
        created_at: '2024-01-01T00:00:00Z',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 0, data: mockResponse },
      });

      const result = await chatRequest.submitQuestion({
        content: 'Test question',
        message_type: 1,
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/message/question`, {
        content: 'Test question',
        message_type: 1,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should reject when API returns error', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 400, message: 'Bad request' },
      });

      await expect(chatRequest.submitQuestion({ content: '', message_type: 1 })).rejects.toEqual({
        code: 400,
        message: 'Bad request',
      });
    });

    it('should handle network errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(chatRequest.submitQuestion({ content: 'test', message_type: 1 })).rejects.toThrow('Network error');
    });
  });

  describe('saveAnswer', () => {
    it('should save answer successfully', async () => {
      const mockSavedAnswer = {
        message_id: 124,
        content: 'AI response',
        author: { author_type: 3 },
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 0, data: mockSavedAnswer },
      });

      const result = await chatRequest.saveAnswer({
        question_message_id: 123,
        content: 'AI response',
        meta_data: [],
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/message/answer`, {
        question_message_id: 123,
        content: 'AI response',
        meta_data: [],
      });
      expect(result).toEqual(mockSavedAnswer);
    });

    it('should handle metadata in answer', async () => {
      const metadata = [{ id: '1', source: 'doc1', name: 'Document 1' }];

      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 0, data: { message_id: 1 } },
      });

      await chatRequest.saveAnswer({
        question_message_id: 123,
        content: 'Response with sources',
        meta_data: metadata,
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ meta_data: metadata })
      );
    });
  });

  describe('getMember', () => {
    it('should fetch member successfully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          code: 0,
          data: {
            name: 'Member Name',
            email: 'member@example.com',
            avatar_url: 'https://avatar.url',
          },
        },
      });

      const result = await chatRequest.getMember('member-uuid');

      expect(result).toEqual({
        uuid: 'member-uuid',
        name: 'Member Name',
        email: 'member@example.com',
        avatar: 'https://avatar.url',
      });
    });

    it('should reject when member not found', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: null },
      });

      await expect(chatRequest.getMember('unknown-uuid')).rejects.toBe('Member not found');
    });
  });

  describe('getSuggestions', () => {
    it('should fetch suggestions successfully', async () => {
      const mockSuggestions = {
        message_id: '123',
        items: ['Question 1?', 'Question 2?'],
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: mockSuggestions },
      });

      const result = await chatRequest.getSuggestions(123);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/123/related_question`);
      expect(result).toEqual(mockSuggestions);
    });

    it('should return empty suggestions', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: { message_id: '123', items: [] } },
      });

      const result = await chatRequest.getSuggestions(123);
      expect(result.items).toEqual([]);
    });
  });

  describe('getChatSettings', () => {
    it('should fetch chat settings successfully', async () => {
      const mockSettings = {
        name: 'My Chat',
        rag_ids: ['doc-1', 'doc-2'],
        metadata: { ai_model: 'gpt-4' },
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: mockSettings },
      });

      const result = await chatRequest.getChatSettings();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/settings`);
      expect(result).toEqual(mockSettings);
    });

    it('should reject when workspaceId missing', async () => {
      const request = new ChatRequest(undefined, chatId, mockAxiosInstance);
      await expect(request.getChatSettings()).rejects.toBe('workspaceId or chatId is not defined');
    });
  });

  describe('updateChatSettings', () => {
    it('should update chat settings successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 0 },
      });

      await chatRequest.updateChatSettings({
        name: 'New Name',
        metadata: { ai_model: 'claude-3' },
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/api/chat/${workspaceId}/${chatId}/settings`, {
        name: 'New Name',
        metadata: { ai_model: 'claude-3' },
      });
    });

    it('should update rag_ids', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { code: 0 },
      });

      await chatRequest.updateChatSettings({
        rag_ids: ['new-doc-1', 'new-doc-2'],
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(expect.any(String), { rag_ids: ['new-doc-1', 'new-doc-2'] });
    });
  });

  describe('getModelList', () => {
    it('should fetch model list successfully', async () => {
      const mockModels = {
        models: [
          { name: 'Auto', metadata: { is_default: true } },
          { name: 'GPT-4', provider: 'OpenAI' },
        ],
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { code: 0, data: mockModels },
      });

      const result = await chatRequest.getModelList();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/ai/${workspaceId}/model/list`);
      expect(result).toEqual(mockModels);
    });

    it('should reject when workspaceId missing', async () => {
      const request = new ChatRequest(undefined, chatId, mockAxiosInstance);
      await expect(request.getModelList()).rejects.toBe('workspaceId is not defined');
    });
  });

  describe('View Operations', () => {
    describe('fetchViews', () => {
      it('should fetch folder structure', async () => {
        const mockFolder = {
          view_id: 'root',
          name: 'Workspace',
          children: [{ view_id: 'child-1', name: 'Doc 1' }],
        };

        mockAxiosInstance.get.mockResolvedValue({
          data: { code: 0, data: mockFolder },
        });

        const result = await chatRequest.fetchViews();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/view/${workspaceId}?depth=10`);
        expect(result).toEqual(mockFolder);
      });

      it('should use cached folder when not forcing refresh', async () => {
        const mockFolder = { view_id: 'root', name: 'Workspace' };

        mockAxiosInstance.get.mockResolvedValue({
          data: { code: 0, data: mockFolder },
        });

        // First call - should fetch
        await chatRequest.fetchViews();
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

        // Second call without force - should use cache
        await chatRequest.fetchViews(false);
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

        // Third call with force - should fetch again
        await chatRequest.fetchViews(true);
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      });
    });

    describe('getView', () => {
      it('should fetch specific view', async () => {
        const mockView = { view_id: 'view-1', name: 'My Document' };

        mockAxiosInstance.get.mockResolvedValue({
          data: { code: 0, data: mockView },
        });

        const result = await chatRequest.getView('view-1');

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/view/view-1?depth=1`);
        expect(result).toEqual(mockView);
      });
    });

    describe('fetchCompleteView', () => {
      it('continues a subtree past the server depth boundary', async () => {
        const root = {
          view_id: 'parent-id',
          name: 'Parent',
          children: [
            {
              view_id: 'boundary-id',
              name: 'Boundary',
              has_children: true,
              children: [],
            },
          ],
        };
        const continuation = {
          view_id: 'boundary-id',
          name: 'Boundary',
          has_children: true,
          children: [{ view_id: 'deep-id', name: 'Deep', has_children: false, children: [] }],
        };

        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { code: 0, data: root } })
          .mockResolvedValueOnce({ data: { code: 0, data: { views: [continuation] } } });

        await expect(chatRequest.fetchCompleteView('parent-id')).resolves.toEqual({
          ...root,
          children: [continuation],
        });
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          1,
          `/api/workspace/${workspaceId}/view/parent-id?depth=50`
        );
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          2,
          `/api/workspace/${workspaceId}/views?depth=50&view_ids=boundary-id`
        );
      });

      it('accepts a permission-filtered continuation as a visible terminal node', async () => {
        const root = {
          view_id: 'parent-id',
          name: 'Parent',
          children: [
            {
              view_id: 'private-boundary-id',
              name: 'Shared boundary',
              has_children: true,
              children: [],
            },
          ],
        };
        const filteredContinuation = {
          view_id: 'private-boundary-id',
          name: 'Shared boundary',
          has_children: true,
          children: [],
        };

        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { code: 0, data: root } })
          .mockResolvedValueOnce({ data: { code: 0, data: { views: [filteredContinuation] } } });

        await expect(chatRequest.fetchCompleteView('parent-id')).resolves.toEqual({
          ...root,
          children: [{ ...filteredContinuation, has_children: false }],
        });
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      });

      it('continues an old-server depth boundary when has_children is omitted', async () => {
        const boundary = { view_id: 'legacy-boundary-id', name: 'Legacy boundary', children: [] };
        let root = boundary;

        for (let depth = 49; depth >= 0; depth -= 1) {
          root = { view_id: `legacy-${depth}`, name: `Legacy ${depth}`, children: [root] };
        }

        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { code: 0, data: root } })
          .mockRejectedValueOnce({ response: { status: 404 } })
          .mockResolvedValueOnce({ data: { code: 0, data: boundary } });

        const result = await chatRequest.fetchCompleteView('legacy-0');
        let terminal = result;

        for (let depth = 0; depth < 50; depth += 1) {
          terminal = terminal.children[0];
        }

        expect(terminal).toEqual({ ...boundary, has_children: false });
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          2,
          `/api/workspace/${workspaceId}/views?depth=50&view_ids=legacy-boundary-id`
        );
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          3,
          `/api/workspace/${workspaceId}/view/legacy-boundary-id?depth=50`
        );
      });

      it('fails closed when the server omits a requested continuation', async () => {
        const root = {
          view_id: 'parent-id',
          name: 'Parent',
          children: [{ view_id: 'boundary-id', name: 'Boundary', has_children: true, children: [] }],
        };

        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { code: 0, data: root } })
          .mockResolvedValueOnce({ data: { code: 0, data: { views: [] } } });

        await expect(chatRequest.fetchCompleteView('parent-id')).rejects.toThrow(
          'Unable to load the complete view subtree'
        );
      });

      it('deduplicates only in-flight requests and refetches completed scopes', async () => {
        const root = {
          view_id: 'parent-id',
          name: 'Parent',
          has_children: false,
          children: [],
        };

        mockAxiosInstance.get.mockResolvedValue({ data: { code: 0, data: root } });

        await chatRequest.fetchCompleteView('parent-id');
        await chatRequest.fetchCompleteView('parent-id');

        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      });

      it('loads the current chat parent from its navigation path', async () => {
        const navigation = {
          view_id: workspaceId,
          name: 'Workspace',
          children: [
            {
              view_id: 'parent-id',
              name: 'Parent',
              children: [{ view_id: chatId, name: 'Chat', children: [] }],
            },
          ],
        };
        const parent = {
          view_id: 'parent-id',
          name: 'Parent',
          has_children: false,
          children: [],
        };

        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { code: 0, data: navigation } })
          .mockResolvedValueOnce({ data: { code: 0, data: parent } });

        await expect(chatRequest.fetchCurrentChatParentScope()).resolves.toEqual(parent);
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          1,
          `/api/workspace/${workspaceId}/view/${chatId}/navigation?depth=0`
        );
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
          2,
          `/api/workspace/${workspaceId}/view/parent-id?depth=50`
        );
      });
    });

    describe('updateViewName', () => {
      it('should update view name', async () => {
        mockAxiosInstance.patch.mockResolvedValue({
          data: { code: 0 },
        });

        const view = {
          view_id: 'view-1',
          name: 'Old Name',
          icon: '📄',
          extra: {},
        };

        await chatRequest.updateViewName(view as any, 'New Name');

        expect(mockAxiosInstance.patch).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/page-view/view-1`, {
          name: 'New Name',
          icon: '📄',
          extra: {},
        });
      });
    });

    describe('insertContentToView', () => {
      it('should insert content into view', async () => {
        mockAxiosInstance.post.mockResolvedValue({
          data: { code: 0 },
        });

        const editorData = [{ type: 'paragraph', data: {}, children: [] }];

        await chatRequest.insertContentToView('view-1', editorData);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          `/api/workspace/${workspaceId}/page-view/view-1/append-block`,
          { blocks: editorData }
        );
      });
    });

    describe('createViewWithContent', () => {
      it('should create new view with content', async () => {
        mockAxiosInstance.post.mockResolvedValue({
          data: { code: 0, data: { view_id: 'new-view-id' } },
        });

        const editorData = [{ type: 'paragraph', data: {}, children: [] }];

        const result = await chatRequest.createViewWithContent('parent-view', 'New Document', editorData);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          `/api/workspace/${workspaceId}/page-view`,
          expect.objectContaining({
            parent_view_id: 'parent-view',
            name: 'New Document',
            layout: expect.any(Number),
          })
        );
        expect(result).toEqual({ view_id: 'new-view-id' });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty response data', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: null,
      });

      await expect(chatRequest.getCurrentUser()).rejects.toBeDefined();
    });

    it('should handle malformed response', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { unexpected: 'format' },
      });

      await expect(chatRequest.getChatMessages()).rejects.toBeDefined();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      (timeoutError as any).code = 'ECONNABORTED';

      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      await expect(chatRequest.getChatMessages()).rejects.toThrow('timeout');
    });
  });
});
