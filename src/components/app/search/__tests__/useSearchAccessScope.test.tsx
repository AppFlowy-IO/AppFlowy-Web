import EventEmitter from 'events';

import { act, renderHook } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { emit, EventType } from '@/application/session/event';
import { TOKEN_STORAGE_KEY } from '@/application/session/token-storage';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useSearchAccessScope } from '@/components/app/search/useSearchAccessScope';

import type { ReactNode } from 'react';

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => 'user-id',
  useIsAuthenticatedOptional: () => true,
}));

function base64Url(value: object) {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** A structurally valid GoTrue session. A routine refresh keeps `session_id` and rotates tokens. */
function sessionToken(sessionId: string, rotation = 0, userId = 'user-id') {
  return JSON.stringify({
    access_token: `${base64Url({ alg: 'HS256' })}.${base64Url({ sub: userId, session_id: sessionId, n: rotation })}.sig`,
    refresh_token: `refresh-${sessionId}-${rotation}`,
    expires_at: 4102444800,
    user: { id: userId },
  });
}

function renderScope(emitter = new EventEmitter()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
  );

  return { emitter, ...renderHook(() => useSearchAccessScope('workspace-id'), { wrapper }) };
}

describe('useSearchAccessScope', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TOKEN_STORAGE_KEY, sessionToken('session-a'));
  });

  it.each(['focus', 'visible', 'online', 'offline', 'socket-connecting', 'socket-closed', 'socket-open'])(
    'keeps the access scope on routine %s events',
    (event) => {
      const { emitter, result } = renderScope();
      const { scope, isCurrent } = result.current;

      act(() => {
        if (event === 'visible') document.dispatchEvent(new Event('visibilitychange'));
        else if (event === 'socket-connecting') emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_CONNECTING);
        else if (event === 'socket-closed') emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_CLOSED);
        else if (event === 'socket-open') emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_OPEN);
        else window.dispatchEvent(new Event(event));
      });

      expect(isCurrent()).toBe(true);
      expect(result.current.scope).toBe(scope);
    }
  );

  it.each([APP_EVENTS.PERMISSION_CHANGED, APP_EVENTS.SHARE_VIEWS_CHANGED])(
    'retires the permission scope synchronously on %s but keeps the session',
    (event) => {
      const { emitter, result } = renderScope();
      const { scope, isCurrent, isSessionCurrent } = result.current;
      let currentBeforeRender = true;

      act(() => {
        emitter.emit(event, {});
        currentBeforeRender = isCurrent();
      });

      expect(currentBeforeRender).toBe(false);
      expect(isSessionCurrent()).toBe(true);
      expect(result.current.scope).not.toBe(scope);
      expect(result.current.isCurrent()).toBe(true);
    }
  );

  it.each([EventType.SESSION_INVALID, EventType.SESSION_VALID])('retires the session on %s', (event) => {
    const { result } = renderScope();
    const { isCurrent, isSessionCurrent } = result.current;

    act(() => {
      emit(event);
    });

    expect(isSessionCurrent()).toBe(false);
    expect(isCurrent()).toBe(false);
    expect(result.current.isSessionCurrent()).toBe(true);
  });

  it('treats a routine token refresh as the same session in this tab and across tabs', () => {
    const { result } = renderScope();
    const { scope, isCurrent } = result.current;
    const refreshed = sessionToken('session-a', 1);

    act(() => {
      localStorage.setItem(TOKEN_STORAGE_KEY, refreshed);
      emit(EventType.SESSION_REFRESH, refreshed);
      window.dispatchEvent(
        new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: sessionToken('session-a', 2) })
      );
    });

    expect(isCurrent()).toBe(true);
    expect(result.current.scope).toBe(scope);
  });

  it.each(['refresh-new-session', 'storage-new-session', 'storage-signed-out', 'storage-cleared', 'refresh-new-user'])(
    'retires the session on %s',
    (change) => {
      const { result } = renderScope();
      const { isSessionCurrent } = result.current;

      act(() => {
        if (change === 'refresh-new-session') emit(EventType.SESSION_REFRESH, sessionToken('session-b'));
        else if (change === 'refresh-new-user') emit(EventType.SESSION_REFRESH, sessionToken('session-a', 1, 'other'));
        else if (change === 'storage-new-session')
          window.dispatchEvent(
            new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: sessionToken('session-b') })
          );
        else if (change === 'storage-signed-out')
          window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: null }));
        else window.dispatchEvent(new StorageEvent('storage', { key: null }));
      });

      expect(isSessionCurrent()).toBe(false);
    }
  );

  it('asks for a background refresh only when the socket reopens after a disconnect', () => {
    const emitter = Object.assign(new EventEmitter(), { webSocketReadyState: WS_OPEN });
    const { result } = renderScope(emitter);
    const initial = result.current.refreshKey;

    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_OPEN);
    });
    expect(result.current.refreshKey).toBe(initial);
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_CLOSED);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_CONNECTING);
    });
    expect(result.current.refreshKey).toBe(initial);
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WS_OPEN);
    });
    expect(result.current.refreshKey).toBe(initial + 1);
    expect(result.current.isCurrent()).toBe(true);
  });

  it('reports browser connectivity without changing the scope', () => {
    const { result } = renderScope();
    const { scope } = result.current;

    expect(result.current.online).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.online).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.online).toBe(true);
    expect(result.current.scope).toBe(scope);
  });

  it('counts each return online, so reads lost to a dropped connection can be retried', () => {
    const { result } = renderScope();
    const { scope } = result.current;
    const initial = result.current.onlineEpoch;

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.onlineEpoch).toBe(initial);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.onlineEpoch).toBe(initial);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.onlineEpoch).toBe(initial + 1);
    expect(result.current.scope).toBe(scope);
  });

  it('retires everything on unmount', () => {
    const { result, unmount, emitter } = renderScope();
    const { isCurrent, isSessionCurrent } = result.current;

    unmount();
    expect(isCurrent()).toBe(false);
    expect(isSessionCurrent()).toBe(false);
    expect(emitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(0);
    expect(emitter.listenerCount(APP_EVENTS.WEBSOCKET_STATUS)).toBe(0);
  });
});
