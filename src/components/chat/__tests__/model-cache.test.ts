import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';

// Create mock localStorage before importing the module
const mockLocalStorage: { [key: string]: string } = {};

// Create a class-based mock that properly supports Object.keys()
class LocalStorageMock {
  getItem(key: string): string | null {
    return mockLocalStorage[key] || null;
  }

  setItem(key: string, value: string): void {
    mockLocalStorage[key] = value;
  }

  removeItem(key: string): void {
    delete mockLocalStorage[key];
  }

  clear(): void {
    for (const key in mockLocalStorage) {
      delete mockLocalStorage[key];
    }
  }

  key(index: number): string | null {
    return Object.keys(mockLocalStorage)[index] || null;
  }

  get length(): number {
    return Object.keys(mockLocalStorage).length;
  }
}

const localStorageMock = new LocalStorageMock();

// Override Object.keys to return mockLocalStorage keys when called with localStorage
const originalObjectKeys = Object.keys;
Object.keys = function(obj: object): string[] {
  if (obj === localStorageMock) {
    return originalObjectKeys(mockLocalStorage);
  }
  return originalObjectKeys(obj);
};

// Set up global localStorage before imports
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Import after setting up mock
import { ModelCache } from '../lib/model-cache';

describe('ModelCache', () => {
  beforeEach(() => {
    // Clear mock storage
    for (const key in mockLocalStorage) {
      delete mockLocalStorage[key];
    }
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('set', () => {
    it('should store model name with timestamp', () => {
      const chatId = 'chat-123';
      const modelName = 'gpt-4';

      ModelCache.set(chatId, modelName);

      const stored = mockLocalStorage['af_chat_model_chat-123'];
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored);
      expect(parsed.modelName).toBe('gpt-4');
      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('should overwrite existing cache', () => {
      const chatId = 'chat-123';

      ModelCache.set(chatId, 'gpt-3.5');
      ModelCache.set(chatId, 'gpt-4');

      const stored = mockLocalStorage['af_chat_model_chat-123'];
      const parsed = JSON.parse(stored);
      expect(parsed.modelName).toBe('gpt-4');
    });

    it('should handle different chat ids', () => {
      ModelCache.set('chat-1', 'model-a');
      ModelCache.set('chat-2', 'model-b');

      expect(mockLocalStorage['af_chat_model_chat-1']).toBeDefined();
      expect(mockLocalStorage['af_chat_model_chat-2']).toBeDefined();

      const parsed1 = JSON.parse(mockLocalStorage['af_chat_model_chat-1']);
      const parsed2 = JSON.parse(mockLocalStorage['af_chat_model_chat-2']);

      expect(parsed1.modelName).toBe('model-a');
      expect(parsed2.modelName).toBe('model-b');
    });

    it('should handle localStorage errors gracefully', () => {
      const setItemSpy = jest.spyOn(localStorageMock, 'setItem').mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      expect(() => ModelCache.set('chat-123', 'model')).not.toThrow();

      consoleSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('get', () => {
    it('should return null for non-existent cache', () => {
      const result = ModelCache.get('non-existent-chat');
      expect(result).toBeNull();
    });

    it('should return cached model name', () => {
      const chatId = 'chat-123';
      const modelName = 'gpt-4';

      ModelCache.set(chatId, modelName);

      const result = ModelCache.get(chatId);
      expect(result).toBe('gpt-4');
    });

    it('should return null for expired cache', () => {
      const chatId = 'chat-123';

      // Set cache with old timestamp (25 hours ago)
      const expiredData = {
        modelName: 'gpt-4',
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      };
      mockLocalStorage['af_chat_model_chat-123'] = JSON.stringify(expiredData);

      const result = ModelCache.get(chatId);
      expect(result).toBeNull();

      // Cache should be removed
      expect(mockLocalStorage['af_chat_model_chat-123']).toBeUndefined();
    });

    it('should return model for non-expired cache', () => {
      const chatId = 'chat-123';

      // Set cache with recent timestamp (1 hour ago)
      const validData = {
        modelName: 'gpt-4',
        timestamp: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      };
      mockLocalStorage['af_chat_model_chat-123'] = JSON.stringify(validData);

      const result = ModelCache.get(chatId);
      expect(result).toBe('gpt-4');
    });

    it('should handle malformed JSON gracefully', () => {
      mockLocalStorage['af_chat_model_chat-123'] = 'not-json';

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = ModelCache.get('chat-123');
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });

    it('should handle localStorage read errors', () => {
      const getItemSpy = jest.spyOn(localStorageMock, 'getItem').mockImplementationOnce(() => {
        throw new Error('SecurityError');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = ModelCache.get('chat-123');
      expect(result).toBeNull();

      consoleSpy.mockRestore();
      getItemSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('should remove cache for specific chat', () => {
      ModelCache.set('chat-1', 'model-a');
      ModelCache.set('chat-2', 'model-b');

      ModelCache.clear('chat-1');

      expect(mockLocalStorage['af_chat_model_chat-1']).toBeUndefined();
      expect(mockLocalStorage['af_chat_model_chat-2']).toBeDefined();
    });

    it('should handle clearing non-existent cache', () => {
      // Should not throw
      expect(() => ModelCache.clear('non-existent')).not.toThrow();
    });

    it('should handle localStorage errors gracefully', () => {
      const removeItemSpy = jest.spyOn(localStorageMock, 'removeItem').mockImplementationOnce(() => {
        throw new Error('SecurityError');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => ModelCache.clear('chat-123')).not.toThrow();

      consoleSpy.mockRestore();
      removeItemSpy.mockRestore();
    });
  });

  describe('clearAll', () => {
    it('should remove all model caches', () => {
      ModelCache.set('chat-1', 'model-a');
      ModelCache.set('chat-2', 'model-b');
      ModelCache.set('chat-3', 'model-c');

      ModelCache.clearAll();

      expect(mockLocalStorage['af_chat_model_chat-1']).toBeUndefined();
      expect(mockLocalStorage['af_chat_model_chat-2']).toBeUndefined();
      expect(mockLocalStorage['af_chat_model_chat-3']).toBeUndefined();
    });

    it('should not remove non-model cache items', () => {
      ModelCache.set('chat-1', 'model-a');
      mockLocalStorage['other_key'] = 'other_value';

      ModelCache.clearAll();

      expect(mockLocalStorage['af_chat_model_chat-1']).toBeUndefined();
      expect(mockLocalStorage['other_key']).toBe('other_value');
    });

    it('should handle empty localStorage', () => {
      // Should not throw
      expect(() => ModelCache.clearAll()).not.toThrow();
    });

    it('should handle localStorage errors gracefully', () => {
      // Set up some data first
      ModelCache.set('chat-1', 'test');

      // Then mock error on removeItem
      const removeItemSpy = jest.spyOn(localStorageMock, 'removeItem').mockImplementationOnce(() => {
        throw new Error('SecurityError');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => ModelCache.clearAll()).not.toThrow();

      consoleSpy.mockRestore();
      removeItemSpy.mockRestore();
    });
  });

  describe('Cache Key Format', () => {
    it('should use correct key prefix', () => {
      ModelCache.set('test-chat', 'test-model');

      const keys = Object.keys(mockLocalStorage);
      const modelKey = keys.find(k => k.includes('test-chat'));

      expect(modelKey).toBe('af_chat_model_test-chat');
    });

    it('should handle chat ids with special characters', () => {
      const specialChatId = 'chat-with-dashes_and_underscores.123';

      ModelCache.set(specialChatId, 'model');

      const result = ModelCache.get(specialChatId);
      expect(result).toBe('model');
    });
  });

  describe('Cache Expiry', () => {
    it('should cache for exactly 24 hours', () => {
      const chatId = 'chat-123';

      // Cache at exactly 24 hours - 1 second ago (should be valid)
      const almostExpired = {
        modelName: 'gpt-4',
        timestamp: Date.now() - (24 * 60 * 60 * 1000 - 1000),
      };
      mockLocalStorage['af_chat_model_chat-123'] = JSON.stringify(almostExpired);

      const result1 = ModelCache.get(chatId);
      expect(result1).toBe('gpt-4');

      // Cache at exactly 24 hours + 1 second ago (should be expired)
      const justExpired = {
        modelName: 'gpt-4',
        timestamp: Date.now() - (24 * 60 * 60 * 1000 + 1000),
      };
      mockLocalStorage['af_chat_model_chat-123'] = JSON.stringify(justExpired);

      const result2 = ModelCache.get(chatId);
      expect(result2).toBeNull();
    });
  });
});
