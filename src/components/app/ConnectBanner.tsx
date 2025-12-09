import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { ReactComponent as CloudOffIcon } from '@/assets/icons/cloud_off.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

import { useAppHandlers } from './app.hooks';
import { Log } from '@/utils/log';

// WebSocket readyState enum
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export function ConnectBanner() {
  const [readyState, setReadyState] = useState<number>(READY_STATE.CONNECTING);
  const [isStableConnection, setIsStableConnection] = useState(false);
  const autoReconnectAttemptedRef = useRef(false);
  const { eventEmitter } = useAppHandlers();
  const { t } = useTranslation();

  // Listen to WebSocket status changes
  useEffect(() => {
    if (!eventEmitter) return;

    const handleWebSocketStatus = (status: number) => {
      setReadyState(status);

      // If the connection is closed, set the connection to unstable
      if (status === READY_STATE.CLOSED) {
        setIsStableConnection(false);
      }
    };

    eventEmitter.on(APP_EVENTS.WEBSOCKET_STATUS, handleWebSocketStatus);

    return () => {
      eventEmitter.off(APP_EVENTS.WEBSOCKET_STATUS, handleWebSocketStatus);
    };
  }, [eventEmitter]);

  // Listen to connection stability: The connection is considered stable after 2 seconds of OPEN state
  useEffect(() => {
    if (readyState === READY_STATE.OPEN) {
      setIsStableConnection(true);
    } else {
      setIsStableConnection(false);
    }
  }, [readyState]);

  // Manual reconnect
  const handleReconnect = useCallback(() => {
    if (!eventEmitter) return;
    eventEmitter.emit(APP_EVENTS.RECONNECT_WEBSOCKET);
  }, [eventEmitter]);

  const isLoading = useMemo(() => {
    return readyState === READY_STATE.CONNECTING || readyState === READY_STATE.CLOSING;
  }, [readyState]);

  const isClosed = useMemo(() => {
    return readyState === READY_STATE.CLOSED;
  }, [readyState]);

  useEffect(() => {
    if (!isClosed) {
      autoReconnectAttemptedRef.current = false;
    }
  }, [isClosed]);

  // Automatically trigger reconnect when the user returns to the page and the socket is closed
  useEffect(() => {
    if (!isClosed || isLoading) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const tryAutoReconnect = () => {
      if (autoReconnectAttemptedRef.current) return;
      if (!isClosed || isLoading) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (document.visibilityState !== 'visible') return;

      autoReconnectAttemptedRef.current = true;

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

  // Only hide the banner when the connection is stable
  if (isStableConnection && readyState === READY_STATE.OPEN) {
    return (
      <div
        className='fixed left-0 right-0 top-0 z-50 overflow-hidden transition-all duration-300 ease-in-out'
        style={{ height: 0 }}
      />
    );
  }

  // The conditions for displaying the banner: connecting, unstable connection, or closed
  const shouldShowBanner = isLoading || isClosed || (readyState === READY_STATE.OPEN && !isStableConnection);

  if (!shouldShowBanner) {
    return null;
  }

  return (
    <div className='absolute left-0 top-[48px] z-50 w-full bg-surface-container-layer-01 transition-all duration-300 ease-in-out'>
      <div className='flex h-[52px] items-center px-4 py-3'>
        <div className='flex items-center space-x-2'>
          {(isLoading || (readyState === READY_STATE.OPEN && !isStableConnection)) && (
            <>
              <Progress variant={'primary'} />
              <span className='text-sm text-text-secondary'>{t('connecting')}</span>
            </>
          )}
          {isClosed && (
            <>
              <CloudOffIcon className='h-5 w-5 text-text-tertiary' />
              <span className='text-sm text-text-secondary'>{t('disconnected')}</span>
              <Button variant='outline' size='sm' className='ml-2' onClick={handleReconnect}>
                {t('reconnect')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
