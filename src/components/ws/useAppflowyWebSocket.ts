import * as random from 'lib0/random';
import { useCallback, useMemo, useState } from 'react';
import useWebSocket from 'react-use-websocket';

import { getTokenParsed } from '@/application/session/token';
import { messages } from '@/proto/messages';
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
  options.url = options.url || wsURL;
  options.token = options.token || getTokenParsed()?.access_token;
  options.clientId = options.clientId || random.uint32();
  options.deviceId = options.deviceId || random.uuidv4();
  console.debug('🔗 Start WebSocket connection', {
    url: options.url,
    workspaceId: options.workspaceId,
    deviceId: options.deviceId,
  });
  const url = `${options.url}/${options.workspaceId}/?clientId=${options.clientId}&deviceId=${options.deviceId}&token=${options.token}&cv=0.10.0&cp=web`;
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const { lastMessage, sendMessage, readyState, getWebSocket } = useWebSocket(url, {
    share: true,
    heartbeat: {
      message: 'echo',
      returnMessage: 'echo',
      timeout: 45000, // Match desktop: 45s = 3x server heartbeat (15s) for silent death detection
      interval: 30000, // Match desktop: 30s ping interval (balances NAT keep-alive with power efficiency)
    },
    // Reconnect configuration
    shouldReconnect: (closeEvent) => {
      console.info('Connection closed, code:', closeEvent.code, 'reason:', closeEvent.reason);

      // Determine if reconnect is needed based on the close code
      if (closeEvent.code === CloseCode.NormalClose) {
        // Normal close, no reconnect
        console.debug('✅ Normal close, no reconnect');
        return false;
      }

      if (closeEvent.code === CloseCode.EndpointLeft) {
        // Endpoint left, reconnect
        console.debug('✅ Endpoint left, reconnect');
        return true;
      }

      if (closeEvent.code >= CloseCode.ProtocolError && closeEvent.code <= CloseCode.TLSHandshakeFailed) {
        console.debug('✅ Protocol error, reconnect');
        // Protocol error, reconnect
        return true;
      }

      return true; // Other cases reconnect
    },

    reconnectAttempts: RECONNECT_ATTEMPTS,

    // Exponential backoff reconnect interval with jitter (match desktop PR #294)
    reconnectInterval: (attemptNumber) => {
      setReconnectAttempt(attemptNumber);

      // First attempt: random 5-10s delay (thundering herd prevention)
      if (attemptNumber === 1) {
        const firstDelay = 5000 + Math.random() * FIRST_ATTEMPT_MAX_DELAY;

        console.info(`Reconnect attempt ${attemptNumber}, first attempt delay ${Math.round(firstDelay)}ms`);

        return firstDelay;
      }

      // Exponential backoff with 2x multiplier (was 1.5x)
      const baseDelay = RECONNECT_INTERVAL * Math.pow(2, attemptNumber - 1);
      const cappedDelay = Math.min(baseDelay, MAX_RECONNECT_DELAY);

      // Add 30% jitter to prevent thundering herd
      const jitter = cappedDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
      const finalDelay = Math.max(0, cappedDelay + jitter);

      console.info(`Reconnect attempt ${attemptNumber}, delay ${Math.round(finalDelay)}ms (base: ${cappedDelay}ms)`);
      return finalDelay;
    },

    // Connection event callback
    onOpen: () => {
      console.info('✅ WebSocket connection opened');
      setReconnectAttempt(0);
      const websocket = getWebSocket() as WebSocket | null;

      if (websocket && websocket.binaryType !== 'arraybuffer') {
        websocket.binaryType = 'arraybuffer';
      }
    },

    onClose: (event) => {
      console.info('❌ WebSocket connection closed', event);
    },

    onError: (event) => {
      console.error('❌ WebSocket error', { event, deviceId: options.deviceId });
    },

    onReconnectStop: (numAttempts) => {
      console.info('❌ Reconnect stopped, attempt number:', numAttempts);
    },
  });

  const sendProtobufMessage = useCallback(
    (message: messages.IMessage, keep = true): void => {
      console.debug('sending sync message:', message);

      const protobufMessage = messages.Message.encode(message).finish();

      sendMessage(protobufMessage, keep);
    },
    [sendMessage]
  );

  const manualReconnect = useCallback(() => {
    console.debug('Manual reconnect triggered');
    window.location.reload();
  }, []);
  const lastProtobufMessage = useMemo(
    () => (lastMessage ? messages.Message.decode(new Uint8Array(lastMessage.data)) : null),
    [lastMessage]
  );

  return {
    lastMessage: lastProtobufMessage,
    sendMessage: sendProtobufMessage,
    readyState,
    options,
    reconnectAttempt,
    reconnect: manualReconnect,
  };
};
