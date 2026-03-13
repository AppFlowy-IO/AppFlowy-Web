import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import dayjs from 'dayjs';

import { AFCloudConfig } from '@/application/services/services.type';
import { getTokenParsed, invalidToken } from '@/application/session/token';
import { Log } from '@/utils/log';

import { initGrantService, refreshToken } from './gotrue';

let axiosInstance: AxiosInstance | null = null;

export function getAxiosInstance() {
  return axiosInstance;
}

/**
 * Standard API response format from AppFlowy server
 */
export interface APIResponse<T = unknown> {
  code: number;
  data?: T;
  message: string;
}

/**
 * Standardized error object with code and message
 */
export interface APIError {
  code: number;
  message: string;
}

/**
 * Safely handles axios errors and returns a consistent error format
 * This ensures all API errors have a code property, even for network errors
 */
export function handleAPIError(error: unknown): APIError {
  if (axios.isAxiosError(error)) {
    // Extract just the path from URL (no query params or sensitive data)
    const url = error.config?.url || 'unknown';

    // Network error (no response from server)
    if (!error.response) {
      return {
        code: -1,
        message: `${error.message || 'Network error'} [${url}]`,
      };
    }

    // Server responded with error status
    const errorData = error.response.data as { code?: number; message?: string } | undefined;

    return {
      code: errorData?.code ?? error.response.status,
      message: `${errorData?.message || error.message || 'Request failed'} [${url}]`,
    };
  }

  // Non-axios error
  return {
    code: -1,
    message: error instanceof Error ? error.message : 'Unknown error occurred',
  };
}

/**
 * Safely executes an axios request and handles errors consistently
 * Returns the response data if successful, or rejects with a standardized error
 */
export async function executeAPIRequest<TResponseData = unknown>(
  request: () => Promise<AxiosResponse<APIResponse<TResponseData>> | undefined> | undefined
): Promise<TResponseData> {
  try {
    if (!axiosInstance) {
      return Promise.reject({
        code: -1,
        message: 'API service not initialized',
      });
    }

    const response = await request();

    if (!response) {
      return Promise.reject({
        code: -1,
        message: 'No response received from server',
      });
    }

    // Get the actual URL that was requested
    const requestUrl = response.request?.responseURL
      || (response.config?.baseURL && response.config?.url
        ? `${response.config.baseURL}${response.config.url}`
        : response.config?.url)
      || 'unknown';

    const method = response.config?.method?.toUpperCase() || 'UNKNOWN';

    Log.debug('[executeAPIRequest]', { method, url: requestUrl, response_data: response.data?.data, response_code: response.data?.code, response_message: response.data?.message });

    if (!response.data) {
      console.error('[executeAPIRequest] No response data received', response);
      return Promise.reject({
        code: -1,
        message: 'No response data received',
      });
    }

    if (response.data.code === 0) {
      // Type assertion needed because TypeScript can't infer that data exists when code === 0
      return response.data.data as TResponseData;
    }

    // Server returned an error response
    return Promise.reject({
      code: response.data.code,
      message: `${response.data.message || 'Request failed'} [${response.config?.url || 'unknown'}]`,
    });
  } catch (error) {
    return Promise.reject(handleAPIError(error));
  }
}

/**
 * Safely executes an axios request that returns void (no data)
 * Used for API calls that only need to check success/failure
 */
export async function executeAPIVoidRequest(
  request: () => Promise<AxiosResponse<APIResponse> | undefined> | undefined
): Promise<void> {
  try {
    if (!axiosInstance) {
      return Promise.reject({
        code: -1,
        message: 'API service not initialized',
      });
    }

    const response = await request();

    if (!response) {
      return Promise.reject({
        code: -1,
        message: 'No response received from server',
      });
    }

    const requestUrl = response.config?.url || 'unknown';

    // Many "void" endpoints return 204 or a 2xx with an empty body. Treat any 2xx as success
    // unless the standard APIResponse envelope is present and indicates an error.
    if (response.status >= 200 && response.status < 300) {
      const responseData: unknown = response.data;

      if (
        responseData &&
        typeof responseData === 'object' &&
        'code' in responseData &&
        typeof (responseData as { code?: unknown }).code === 'number'
      ) {
        const data = responseData as APIResponse;

        if (data.code === 0) return;

        return Promise.reject({
          code: data.code,
          message: `${data.message || 'Request failed'} [${requestUrl}]`,
        });
      }

      return;
    }

    return Promise.reject({
      code: response.status,
      message: `${response.statusText || 'Request failed'} [${requestUrl}]`,
    });
  } catch (error) {
    return Promise.reject(handleAPIError(error));
  }
}

export function initAPIService(config: AFCloudConfig) {
  if (axiosInstance) {
    return;
  }

  axiosInstance = axios.create({
    baseURL: config.baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  initGrantService(config.gotrueURL);

  axiosInstance.interceptors.request.use(
    async (config) => {
      const token = getTokenParsed();

      if (!token) {
        Log.debug('[initAPIService][request] no token found, sending request without auth header', {
          url: config.url,
        });
        return config;
      }

      const isExpired = dayjs().isAfter(dayjs.unix(token.expires_at));

      let access_token = token.access_token;
      const refresh_token = token.refresh_token;

      if (isExpired) {
        try {
          const newToken = await refreshToken(refresh_token);

          access_token = newToken?.access_token || '';
        } catch (e) {
          console.warn('[initAPIService][request] refresh token failed, marking token invalid', {
            url: config.url,
            message: (e as Error)?.message,
          });
          invalidToken();
          return config;
        }
      }

      if (access_token) {
        Object.assign(config.headers, {
          Authorization: `Bearer ${access_token}`,
        });
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  const handleUnauthorized = async (error: unknown) => {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 401) {
      const token = getTokenParsed();

      if (!token) {
        console.warn('[initAPIService][response] 401 without token, emitting invalid token');
        invalidToken();
        return Promise.reject(error);
      }

      const refresh_token = token.refresh_token;

      try {
        await refreshToken(refresh_token);
      } catch (e) {
        console.warn('[initAPIService][response] refresh on 401 failed, emitting invalid token', {
          message: (e as Error)?.message,
          url: axiosError.config?.url,
        });
        invalidToken();
      }
    }

    return Promise.reject(error);
  };

  axiosInstance.interceptors.response.use((response) => response, handleUnauthorized);

  // Retry interceptor: automatic retry with exponential backoff for transient failures.
  // Only retries GET requests (idempotent) on network errors or 5xx server errors.
  const RETRY_COUNT = 3;
  const RETRY_BASE_DELAY = 1000; // 1s, 2s, 4s

  type RetryableAxiosConfig = NonNullable<AxiosError['config']> & {
    __afRetryCount?: number;
  };

  axiosInstance.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);
    const config = error.config as RetryableAxiosConfig | undefined;

    if (!config) return Promise.reject(error);

    // Only retry idempotent GET requests
    if (config.method?.toLowerCase() !== 'get') return Promise.reject(error);

    // Keep retry count on config so it survives axios cloning between retries.
    const retryCount = config.__afRetryCount ?? 0;

    if (retryCount >= RETRY_COUNT) return Promise.reject(error);

    // Respect explicit request cancellation (AbortController / axios cancel token).
    const maybeCanceledError: unknown = error;
    const isCanceled = axios.isCancel(maybeCanceledError) || error.code === 'ERR_CANCELED';

    if (isCanceled) return Promise.reject(error);

    // Retry on network errors (no response) or 5xx server errors
    const status = error.response?.status;
    const isRetryable = !error.response || (status !== undefined && status >= 500);

    if (!isRetryable) return Promise.reject(error);

    const nextRetry = retryCount + 1;

    config.__afRetryCount = nextRetry;
    const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount);

    const waitForBackoff = (ms: number, signal?: AbortSignal) =>
      new Promise<'elapsed' | 'aborted'>((resolve) => {
        if (!signal) {
          setTimeout(() => resolve('elapsed'), ms);
          return;
        }

        if (signal.aborted) {
          resolve('aborted');
          return;
        }

        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve('aborted');
        };

        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve('elapsed');
        }, ms);

        signal.addEventListener('abort', onAbort, { once: true });
      });

    Log.debug(`[HTTP Retry] Attempt ${nextRetry}/${RETRY_COUNT} for ${config.url} in ${delay}ms`);
    const backoffResult = await waitForBackoff(delay, config.signal as AbortSignal | undefined);

    if (backoffResult === 'aborted' || config.signal?.aborted) return Promise.reject(error);

    return axiosInstance!(config);
  });
}

/**
 * Get the current axios instance. For use in domain API files.
 * @internal
 */
export function getAxios() {
  return axiosInstance;
}
