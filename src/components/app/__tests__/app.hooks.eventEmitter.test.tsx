import EventEmitter from 'events';

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useEventEmitter, useEventEmitterOptional } from '@/components/app/app.hooks';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

jest.mock('@/components/app/layers/AppAuthLayer', () => ({ AppAuthLayer: () => null }));
jest.mock('@/components/app/layers/AppBusinessLayer', () => ({ AppBusinessLayer: () => null }));
jest.mock('@/components/app/layers/AppSyncLayer', () => ({ AppSyncLayer: () => null }));

describe('app event emitter hooks', () => {
  it('keeps the required hook strict outside AppProvider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(() => renderHook(() => useEventEmitter())).toThrow('useEventEmitter must be used within an AppProvider');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('allows publish-page consumers to render without AppProvider', () => {
    const { result } = renderHook(() => useEventEmitterOptional());

    expect(result.current).toBeUndefined();
  });

  it('returns the app event emitter when the context is available', () => {
    const eventEmitter = new EventEmitter();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppEventEmitterContext.Provider value={eventEmitter}>{children}</AppEventEmitterContext.Provider>
    );
    const { result } = renderHook(() => useEventEmitterOptional(), { wrapper });

    expect(result.current).toBe(eventEmitter);
  });
});
