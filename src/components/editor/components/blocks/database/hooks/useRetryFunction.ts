import { useCallback } from 'react';

import { Log } from '@/utils/log';

const RETRY_CONFIG = {
  maxAttempts: 5,
  getRetryDelay: (attempt: number) => {
    const delays = [1000, 3000, 6000, 10000];

    return delays[Math.min(attempt - 1, delays.length - 1)];
  },
};

// eslint-disable-next-line
export const useRetryFunction = <T extends any[], R>(
  fn: ((...args: T) => Promise<R>) | undefined,
  onError: () => void
) => {
  const retryFunction = useCallback(
    async (...args: T): Promise<R> => {
      let attempt = 1;

      const executeWithRetry = async (): Promise<R> => {
        try {
          if (!fn) {
            throw new Error('Function not available');
          }

          const result = await fn(...args);

          if (!result) {
            throw new Error('No result returned');
          }

          return result;
        } catch (error) {
          if (attempt < RETRY_CONFIG.maxAttempts) {
            const delay = RETRY_CONFIG.getRetryDelay(attempt);

            Log.debug(`[useRetryFunction] Retry attempt ${attempt} after ${delay}ms`, error);
            attempt++;
            await new Promise(resolve => setTimeout(resolve, delay));

            return executeWithRetry();
          } else {
            console.error(`[useRetryFunction] All ${RETRY_CONFIG.maxAttempts} attempts failed`, error);
            onError();
            throw error;
          }
        }
      };

      return executeWithRetry();
    },
    [fn, onError]
  );

  return retryFunction;
};