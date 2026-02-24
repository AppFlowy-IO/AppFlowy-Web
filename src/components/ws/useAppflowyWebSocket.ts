import * as random from 'lib0/random';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useWebSocket from 'react-use-websocket';

import { refreshToken } from '@/application/services/js-services/http/gotrue';
import { getTokenParsed, invalidToken } from '@/application/session/token';
import { messages } from '@/proto/messages';
import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

const wsURL = getConfigValue('APPFLOWY_WS_BASE_URL', 'ws://localhost:8000/ws/v2');

// WebSocket close code enum
enum CloseCode {
  NormalClose = 1000,
  EndpointLeft = 1001,
  ProtocolError = 1002,
  UnsupportedDataType = 1003,
  Reserved = 1004,
  NoStatusCode = 1005,
  AbnormalClose = 1006,
  InvalidFramePayloadData = 1007,
  PolicyViolation = 1008,
  MessageTooBig = 1009,
  ClientExpectedServerToNegotiateOneOrMoreExtensions = 1010,
  ServerEncounteredAnUnexpectedCondition = 1011,
  TLSHandshakeFailed = 1015,
}

const RECONNECT_ATTEMPTS = 30; // Match desktop: 30 attempts for resilience
const RECONNECT_INTERVAL = 5000; // Match desktop: 5s initial delay
const MAX_RECONNECT_DELAY = 180000; // 3 minutes max (match desktop)
const FIRST_ATTEMPT_MAX_DELAY = 5000; // Random 5-10s before first attempt (thundering herd prevention)
const JITTER_FACTOR = 0.3; // 30% jitter to prevent thundering herd
const SLOW_POLL_INTERVAL = 60000; // 60s slow-poll after exhausting fast attempts
const RECONNECT_NONCE_COOLDOWN = 5000; // 5s minimum between nonce-based reconnections
const WS_READY_STATE_CLOSED = 3;
const AUTH_FAILURE_STATUS_CODES = new Set([400, 401, 403]);
const AUTH_FAILURE_ERROR_MARKERS = [
  'invalid_grant',
  'invalid refresh token',
  'refresh token is invalid',
  'refresh token has expired',
  'session_not_found',
  'session not found',
  'token expired',
  'token has expired',
  'revoked',
];

type ReconnectAuthStatus = 'ready' | 'auth-failed' | 'transient-failed';

const getRefreshFailureText = (error: unknown): string => {
  if (typeof error === 'string') {
    return error.toLowerCase();
  }

  if (typeof error !== 'object' || error === null) {
    return '';
  }

  const typedError = error as {
    message?: unknown;
    response?: {
      data?: unknown;
    };
  };
  const texts: string[] = [];

  if (typeof typedError.message === 'string') {
    texts.push(typedError.message);
  }

  const responseData = typedError.response?.data;

  if (typeof responseData === 'string') {
    texts.push(responseData);
  } else if (typeof responseData === 'object' && responseData !== null) {
    const payload = responseData as {
      error?: unknown;
      message?: unknown;
      msg?: unknown;
      error_description?: unknown;
    };

    if (typeof payload.error === 'string') {
      texts.push(payload.error);
    }

    if (typeof payload.message === 'string') {
      texts.push(payload.message);
    }

    if (typeof payload.msg === 'string') {
      texts.push(payload.msg);
    }

    if (typeof payload.error_description === 'string') {
      texts.push(payload.error_description);
    }
  }

  return texts.join(' ').toLowerCase();
};

const isAuthRefreshFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const status = (error as { response?: { status?: unknown } }).response?.status;

  if (typeof status === 'number' && AUTH_FAILURE_STATUS_CODES.has(status)) {
    return true;
  }

  const message = getRefreshFailureText(error);

  return AUTH_FAILURE_ERROR_MARKERS.some((marker) => message.includes(marker));
};

export type AppflowyWebSocketType = {
  /**
   * The last received message from the WebSocket.
   * It is decoded from the binary format to a `messages.Message` object.
   */
  lastMessage: messages.Message | null;
  /**
   * Function to send a message through the WebSocket.
   * The message is encoded to binary format before sending.
   * @param msg - The message to send, in the format of `messages.IMessage`.
   * @param keep - Should the message be cached if the WebSocket is not open? (default: true)
   */
  sendMessage: (msg: messages.IMessage, keep?: boolean) => void;
  /**
   * The current ready state of the WebSocket.
   * It can be one of the following values:
   * - 0: CONNECTING
   * - 1: OPEN
   * - 2: CLOSING
   * - 3: CLOSED
   */
  readyState: number;
  /**
   * The options used to create the WebSocket connection.
   */
  options: Options;

  /**
   * The number of reconnect attempts.
   */
  reconnectAttempt: number;
  /**
   * Function to manually trigger a reconnection.
   */
  reconnect: () => void;
};

export interface Options {
  /**
   * UUID v4 representing the unique identifier of currently opened workspace.
   */
  workspaceId: string;
  /**
   * WebSocket server URL to connect to. Should start with `ws://` or `wss://`.
   */
  url?: string;
  /**
   * Client ID is a unique identifier for the client. This can be used as `Y.Doc`
   * client ID. Must not be shared between browser tabs or different clients.
   * It is used to identify the client in the WebSocket connection.
   * If not provided, a random uint32 will be generated.
   */
  clientId?: number;
  /**
   * Unique device identifier. If not provided, a random UUID v4 will be generated.
   */
  deviceId?: string;
  /**
   * Token used for authentication. If not provided, the token will be fetched from the session.
   */
  token?: string;
}

export const useAppflowyWebSocket = (options: Options): AppflowyWebSocketType => {
  const wsUrl = options.url || wsURL;
  const token = options.token || getTokenParsed()?.access_token;
  // Stable across re-renders: generate once via lazy initializer, not on every render.
  const [clientId] = useState(() => options.clientId || random.uint32());
  const [deviceId] = useState(() => options.deviceId || random.uuidv4());

  Log.debug('🔗 Start WebSocket connection', {
    url: wsUrl,
    workspaceId: options.workspaceId,
    deviceId,
  });

  // Reconnect nonce: changing this forces react-use-websocket to close the old
  // connection and open a new one, without reloading the page.
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const baseUrl = `${wsUrl}/${options.workspaceId}/?clientId=${clientId}&deviceId=${deviceId}&token=${token}&cv=0.10.0&cp=web`;
  const url = reconnectNonce > 0 ? `${baseUrl}&_rc=${reconnectNonce}` : baseUrl;

  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectStoppedRef = useRef(false);
  const slowPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNonceBumpRef = useRef(0);
  const lastCloseCodeRef = useRef<number | null>(null);
  const tokenRefreshInFlightRef = useRef<Promise<ReconnectAuthStatus> | null>(null);
  const isMountedRef = useRef(true);

  const clearSlowPollRecovery = useCallback(() => {
    reconnectStoppedRef.current = false;
    if (slowPollTimerRef.current) {
      clearInterval(slowPollTimerRef.current);
      slowPollTimerRef.current = null;
    }
  }, []);

  // Throttled nonce bump to prevent rapid-fire reconnections on flaky networks.
  // Every nonce bump resets react-use-websocket's internal retry counter, so
  // unbounded bumps (e.g. from rapid online/offline toggles) would bypass backoff entirely.
  const bumpReconnectNonce = useCallback(() => {
    const now = Date.now();

    if (now - lastNonceBumpRef.current < RECONNECT_NONCE_COOLDOWN) {
      Log.debug('Reconnect nonce bump throttled (cooldown active)');
      return;
    }

    lastNonceBumpRef.current = now;
    setReconnectNonce((n) => n + 1);
  }, []);

  const ensureFreshTokenForReconnect = useCallback(async (): Promise<ReconnectAuthStatus> => {
    // If token is explicitly provided by caller, we can't refresh it from session state.
    if (options.token) return 'ready';

    const tokenData = getTokenParsed();

    if (!tokenData) return 'auth-failed';

    const nowUnix = Math.floor(Date.now() / 1000);
    const isExpired = tokenData.expires_at <= nowUnix;

    if (!isExpired) return 'ready';

    if (tokenRefreshInFlightRef.current) {
      return tokenRefreshInFlightRef.current;
    }

    if (!tokenData.refresh_token) {
      return 'auth-failed';
    }

    tokenRefreshInFlightRef.current = refreshToken(tokenData.refresh_token)
      .then((newToken) => {
        return newToken?.access_token ? 'ready' : 'transient-failed';
      })
      .catch((e) => {
        if (isAuthRefreshFailure(e)) {
          Log.warn('Token refresh rejected during WebSocket reconnect', e);
          return 'auth-failed';
        }

        Log.warn('Transient token refresh failure during WebSocket reconnect', e);
        return 'transient-failed';
      })
      .finally(() => {
        tokenRefreshInFlightRef.current = null;
      });

    return tokenRefreshInFlightRef.current;
  }, [options.token]);

  const triggerNonceReconnect = useCallback(
    (reason: string, resetRecovery = false) => {
      void (async () => {
        const authStatus = await ensureFreshTokenForReconnect();

        // Guard: component may have unmounted while awaiting token refresh
        if (!isMountedRef.current) return;

        if (authStatus !== 'ready') {
          if (authStatus === 'auth-failed') {
            Log.warn(`WebSocket reconnect auth check failed (${reason}), forcing re-auth flow`);
            if (!options.token) {
              invalidToken();
            }

            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          } else {
            Log.warn(`WebSocket reconnect auth check hit transient failure (${reason}), preserving session`);
          }

          return;
        }

        if (resetRecovery) {
          clearSlowPollRecovery();
        }

        bumpReconnectNonce();
      })();
    },
    [ensureFreshTokenForReconnect, clearSlowPollRecovery, bumpReconnectNonce, options.token]
  );

  // Ref always holds the latest triggerNonceReconnect so long-lived callbacks
  // (setInterval in onReconnectStop, event listeners) never capture a stale version.
  const triggerNonceReconnectRef = useRef(triggerNonceReconnect);

  triggerNonceReconnectRef.current = triggerNonceReconnect;

  const { lastMessage, sendMessage, readyState, getWebSocket } = useWebSocket(url, {
    share: true,
    heartbeat: {
      message: 'echo',
      returnMessage: 'echo',
      timeout: 90000, // 90s: more tolerant of slow/congested networks (was 45s)
      interval: 30000, // Match desktop: 30s ping interval (balances NAT keep-alive with power efficiency)
    },
    // Reconnect configuration
    shouldReconnect: (closeEvent) => {
      Log.info('Connection closed, code:', closeEvent.code, 'reason:', closeEvent.reason);

      // Normal close — intentional disconnect, don't reconnect
      if (closeEvent.code === CloseCode.NormalClose) {
        Log.debug('Normal close, no reconnect');
        return false;
      }

      // Don't waste reconnect attempts when the browser is offline.
      // The 'online' event listener will trigger reconnection when network returns.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        Log.debug('Browser is offline, deferring reconnect to online event');
        return false;
      }

      // Don't reconnect when the tab is in the background.
      // Background reconnects drain battery and waste attempts against potentially-dead
      // connections. The visibilitychange listener in ConnectBanner will reconnect
      // when the user returns.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        Log.debug('Tab is hidden, deferring reconnect to visibility change');
        return false;
      }

      return true;
    },

    reconnectAttempts: RECONNECT_ATTEMPTS,

    // Exponential backoff reconnect interval with jitter (match desktop PR #294)
    reconnectInterval: (attemptNumber) => {
      setReconnectAttempt(attemptNumber);

      // First attempt: random 5-10s delay (thundering herd prevention)
      if (attemptNumber === 0) {
        const firstDelay = 5000 + Math.random() * FIRST_ATTEMPT_MAX_DELAY;

        Log.info(`Reconnect attempt ${attemptNumber}, first attempt delay ${Math.round(firstDelay)}ms`);

        return firstDelay;
      }

      // Exponential backoff with 2x multiplier (was 1.5x)
      const baseDelay = RECONNECT_INTERVAL * Math.pow(2, attemptNumber - 1);
      const cappedDelay = Math.min(baseDelay, MAX_RECONNECT_DELAY);

      // Add 30% jitter to prevent thundering herd
      const jitter = cappedDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
      const finalDelay = Math.max(0, cappedDelay + jitter);

      Log.info(`Reconnect attempt ${attemptNumber}, delay ${Math.round(finalDelay)}ms (base: ${cappedDelay}ms)`);
      return finalDelay;
    },

    // Connection event callback
    onOpen: () => {
      Log.info('✅ WebSocket connection opened');
      setReconnectAttempt(0);
      lastCloseCodeRef.current = null;
      clearSlowPollRecovery();

      const websocket = getWebSocket() as WebSocket | null;

      if (websocket && websocket.binaryType !== 'arraybuffer') {
        websocket.binaryType = 'arraybuffer';
      }
    },

    onClose: (event) => {
      lastCloseCodeRef.current = event.code;
      Log.info('❌ WebSocket connection closed', event);
    },

    onError: (event) => {
      Log.error('❌ WebSocket error', { event, deviceId });
    },

    onReconnectStop: (numAttempts) => {
      Log.info('❌ Reconnect stopped after', numAttempts, 'attempts. Starting slow-poll recovery.');
      reconnectStoppedRef.current = true;

      // Start slow-poll: every 60s, check if we're online and try to reconnect.
      // Uses triggerNonceReconnectRef to avoid capturing a stale closure.
      if (!slowPollTimerRef.current) {
        slowPollTimerRef.current = setInterval(() => {
          if (navigator.onLine && document.visibilityState === 'visible') {
            Log.info('Slow-poll: online and visible, attempting graceful reconnect');
            triggerNonceReconnectRef.current('slow-poll', true);
          }
        }, SLOW_POLL_INTERVAL);
      }
    },
  });

  const tryDeferredReconnect = useCallback(
    (reason: 'online' | 'visibility') => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (readyState !== WS_READY_STATE_CLOSED) return;
      if (lastCloseCodeRef.current === CloseCode.NormalClose) return;

      Log.info(`Deferred reconnect trigger (${reason}), attempting graceful reconnect`);
      triggerNonceReconnect(`deferred-${reason}`, true);
    },
    [readyState, triggerNonceReconnect]
  );

  // Listen for browser online/visibility events to recover when reconnect was deferred.
  useEffect(() => {
    const handleOnline = () => {
      tryDeferredReconnect('online');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tryDeferredReconnect('visibility');
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (slowPollTimerRef.current) {
        clearInterval(slowPollTimerRef.current);
        slowPollTimerRef.current = null;
      }
    };
  }, [tryDeferredReconnect]);

  // Mark unmounted so async callbacks (triggerNonceReconnect) can bail out.
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const sendProtobufMessage = useCallback(
    (message: messages.IMessage, keep = true): void => {
      Log.debug('sending sync message:', message);

      const protobufMessage = messages.Message.encode(message).finish();

      sendMessage(protobufMessage, keep);
    },
    [sendMessage]
  );

  const manualReconnect = useCallback(() => {
    Log.debug('Manual reconnect triggered — graceful reconnection (no page reload)');
    // Manual reconnect should override previous close-code suppression.
    lastCloseCodeRef.current = null;
    // Manual reconnect starts a new reconnect cycle, so stop slow-poll recovery first.
    // Bump the nonce to force a new WebSocket URL, causing react-use-websocket
    // to close the old connection and open a fresh one without page reload.
    triggerNonceReconnect('manual', true);
  }, [triggerNonceReconnect]);

  const lastProtobufMessage = useMemo(
    () => (lastMessage ? messages.Message.decode(new Uint8Array(lastMessage.data)) : null),
    [lastMessage]
  );

  const resolvedOptions = useMemo<Options>(
    () => ({ ...options, url: wsUrl, clientId, deviceId }),
    [options, wsUrl, clientId, deviceId]
  );

  return {
    lastMessage: lastProtobufMessage,
    sendMessage: sendProtobufMessage,
    readyState,
    options: resolvedOptions,
    reconnectAttempt,
    reconnect: manualReconnect,
  };
};
