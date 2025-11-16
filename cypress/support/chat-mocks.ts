/**
 * Chat-specific API mocking utilities for E2E tests
 * Consolidates common chat API intercept patterns
 *
 * Usage:
 * ```typescript
 * import { setupChatApiStubs, mockChatMessage } from '@/cypress/support/chat-mocks';
 *
 * // Set up all chat-related API stubs
 * setupChatApiStubs();
 *
 * // Or mock individual endpoints
 * mockChatMessage('Test message content', 123);
 * mockChatSettings('Auto');
 * mockModelList(['Auto', 'GPT-4', 'Claude']);
 * ```
 */

/**
 * Default stubbed message ID for testing
 */
export const DEFAULT_MESSAGE_ID = 101;

/**
 * Default stubbed message content
 */
export const DEFAULT_MESSAGE_CONTENT = 'Stubbed AI answer ready for export';

/**
 * Mock chat messages endpoint
 * @param content - Message content (default: stubbed content)
 * @param messageId - Message ID (default: 101)
 * @param authorType - Author type (3 = assistant, 1 = user)
 */
export const mockChatMessage = (
  content = DEFAULT_MESSAGE_CONTENT,
  messageId = DEFAULT_MESSAGE_ID,
  authorType = 3 // 3 = assistant
) => {
  cy.intercept('GET', '**/api/chat/**/message**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        messages: [
          {
            message_id: messageId,
            author: {
              author_type: authorType,
              author_uuid: authorType === 3 ? 'assistant' : 'user',
            },
            content,
            created_at: new Date().toISOString(),
            meta_data: [],
          },
        ],
        has_more: false,
        total: 1,
      },
      message: 'success',
    },
  }).as('getChatMessages');
};

/**
 * Mock empty chat messages (no messages)
 */
export const mockEmptyChatMessages = () => {
  cy.intercept('GET', '**/api/chat/**/message**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        messages: [],
        has_more: false,
        total: 0,
      },
      message: 'success',
    },
  }).as('getChatMessages');
};

/**
 * Mock chat settings endpoint
 * @param aiModel - AI model name (default: 'Auto')
 * @param ragIds - RAG IDs (default: empty array)
 */
export const mockChatSettings = (aiModel = 'Auto', ragIds: string[] = []) => {
  cy.intercept('GET', '**/api/chat/**/settings**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        rag_ids: ragIds,
        metadata: {
          ai_model: aiModel,
        },
      },
      message: 'success',
    },
  }).as('getChatSettings');
};

/**
 * Mock update chat settings endpoint
 */
export const mockUpdateChatSettings = () => {
  cy.intercept('PATCH', '**/api/chat/**/settings**', {
    statusCode: 200,
    body: {
      code: 0,
      message: 'success',
    },
  }).as('updateChatSettings');
};

/**
 * Mock AI model list endpoint
 * @param modelNames - Array of model names to include
 * @param defaultModel - Which model should be default (default: 'Auto')
 */
export const mockModelList = (
  modelNames: string[] = ['Auto', 'E2E Test Model'],
  defaultModel = 'Auto'
) => {
  const models = modelNames.map((name, index) => ({
    name,
    provider: name === 'Auto' ? undefined : 'Test Provider',
    metadata: {
      is_default: name === defaultModel,
      desc:
        name === 'Auto'
          ? 'Automatically select an AI model'
          : `Stubbed model for testing: ${name}`,
    },
  }));

  cy.intercept('GET', '**/api/ai/**/model/list**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        models,
      },
      message: 'success',
    },
  }).as('getModelList');
};

/**
 * Mock related questions endpoint
 * @param messageId - Message ID (default: DEFAULT_MESSAGE_ID)
 * @param questions - Array of related questions (default: empty)
 */
export const mockRelatedQuestions = (
  messageId = DEFAULT_MESSAGE_ID,
  questions: string[] = []
) => {
  cy.intercept('GET', '**/api/chat/**/**/related_question**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        message_id: `${messageId}`,
        items: questions.map((q, idx) => ({
          id: idx + 1,
          question: q,
        })),
      },
      message: 'success',
    },
  }).as('getRelatedQuestions');
};

/**
 * Mock send message endpoint
 * @param responseContent - AI response content
 */
export const mockSendMessage = (responseContent = 'AI response to your message') => {
  cy.intercept('POST', '**/api/chat/**/message**', {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        message_id: DEFAULT_MESSAGE_ID + 1,
        content: responseContent,
        created_at: new Date().toISOString(),
      },
      message: 'success',
    },
  }).as('sendMessage');
};

/**
 * Sets up all common chat-related API stubs
 * Convenience function that mocks all standard chat endpoints
 *
 * @param options - Optional configuration
 */
export const setupChatApiStubs = (options?: {
  messageContent?: string;
  messageId?: number;
  aiModel?: string;
  modelNames?: string[];
  includeRelatedQuestions?: boolean;
}) => {
  const {
    messageContent = DEFAULT_MESSAGE_CONTENT,
    messageId = DEFAULT_MESSAGE_ID,
    aiModel = 'Auto',
    modelNames = ['Auto', 'E2E Test Model'],
    includeRelatedQuestions = true,
  } = options || {};

  // Mock chat messages
  mockChatMessage(messageContent, messageId);

  // Mock chat settings
  mockChatSettings(aiModel);

  // Mock update chat settings
  mockUpdateChatSettings();

  // Mock model list
  mockModelList(modelNames);

  // Mock related questions
  if (includeRelatedQuestions) {
    mockRelatedQuestions(messageId);
  }
};

/**
 * Mock chat streaming response
 * Useful for testing streaming message updates
 */
export const mockChatStreaming = (chunks: string[]) => {
  let currentChunk = 0;

  cy.intercept('POST', '**/api/chat/**/stream**', (req) => {
    req.reply((res) => {
      const chunk = chunks[currentChunk] || '';
      currentChunk++;

      res.send({
        statusCode: 200,
        body: {
          chunk,
          done: currentChunk >= chunks.length,
        },
      });
    });
  }).as('streamMessage');
};

/**
 * Mock chat error response
 * Useful for testing error handling
 */
export const mockChatError = (errorMessage = 'Failed to load chat') => {
  cy.intercept('GET', '**/api/chat/**/message**', {
    statusCode: 500,
    body: {
      code: 1,
      message: errorMessage,
    },
  }).as('getChatMessagesError');
};
