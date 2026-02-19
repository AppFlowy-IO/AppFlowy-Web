import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { ReactComponent as CloudOffIcon } from '@/assets/icons/cloud_off.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Log } from '@/utils/log';

import { useAppHandlers } from './app.hooks';

// WebSocket readyState enum
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export function ConnectBanner() {
  const [readyState, setReadyState] = useState<number>(READY_STATE.CONNECTING);
  const autoReconnectAttemptedRef = useRef(0); // timestamp of last auto-reconnect attempt
  const { eventEmitter } = useAppHandlers();
  const { t } = useTranslation();

  // Listen to WebSocket status changes
  useEffect(() => {
    if (!eventEmitter) return;

    const handleWebSocketStatus = (status: number) => {
      setReadyState(status);
    };

    eventEmitter.on(APP_EVENTS.WEBSOCKET_STATUS, handleWebSocketStatus);

    return () => {
      eventEmitter.off(APP_EVENTS.WEBSOCKET_STATUS, handleWebSocketStatus);
    };
  }, [eventEmitter]);

  // Manual reconnect
  const handleReconnect = useCallback(() => {
    if (!eventEmitter) return;
    eventEmitter.emit(APP_EVENTS.RECONNECT_WEBSOCKET);
  }, [eventEmitter]);

  const isLoading = readyState === READY_STATE.CONNECTING || readyState === READY_STATE.CLOSING;
  const isClosed = readyState === READY_STATE.CLOSED;
  const isOpen = readyState === READY_STATE.OPEN;

  // Reset cooldown only when connection is fully re-established.
  useEffect(() => {
    if (isOpen) {
      autoReconnectAttemptedRef.current = 0;
    }
  }, [isOpen]);

  // Automatically trigger reconnect when the user returns to the page and the socket is closed.
  // Allows multiple attempts with a 30-second cooldown between each.
  useEffect(() => {
    if (!isClosed || isLoading) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const AUTO_RECONNECT_COOLDOWN_MS = 30000; // 30s cooldown between auto-reconnect attempts

    const tryAutoReconnect = () => {
      // Note: isClosed && !isLoading is guaranteed by the early return above.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (document.visibilityState !== 'visible') return;

      const now = Date.now();
      const lastAttemptTime = autoReconnectAttemptedRef.current;

      // Enforce cooldown between attempts
      if (lastAttemptTime > 0 && now - lastAttemptTime < AUTO_RECONNECT_COOLDOWN_MS) return;

      autoReconnectAttemptedRef.current = now;

      Log.debug('Trying to auto reconnect');
      handleReconnect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tryAutoReconnect();
      }
    };

    window.addEventListener('focus', tryAutoReconnect);
    window.addEventListener('online', tryAutoReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    tryAutoReconnect();

    return () => {
      window.removeEventListener('focus', tryAutoReconnect);
      window.removeEventListener('online', tryAutoReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleReconnect, isClosed, isLoading]);

  // Hide the banner when the connection is open and stable
  if (isOpen) {
    return (
      <div
        className='fixed left-0 right-0 top-0 z-50 overflow-hidden transition-all duration-300 ease-in-out'
        style={{ height: 0 }}
      />
    );
  }

  // Show the banner when connecting or closed
  if (!isLoading && !isClosed) {
    return null;
  }

  return (
    <div data-testid='connect-banner' className='absolute left-0 top-[48px] z-50 w-full bg-surface-container-layer-01 transition-all duration-300 ease-in-out'>
      <div className='flex h-[52px] items-center px-4 py-3'>
        <div className='flex items-center space-x-2'>
          {isLoading && (
            <>
              <Progress variant={'primary'} />
              <span data-testid='connect-banner-connecting' className='text-sm text-text-secondary'>{t('connecting')}</span>
            </>
          )}
          {isClosed && (
            <>
              <CloudOffIcon className='h-5 w-5 text-text-tertiary' />
              <span data-testid='connect-banner-disconnected' className='text-sm text-text-secondary'>{t('disconnected')}</span>
              <Button data-testid='connect-banner-reconnect' variant='outline' size='sm' className='ml-2' onClick={handleReconnect}>
                {t('reconnect')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
