import EventEmitter from 'events';

import { act, render, screen } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { ConnectBanner } from '@/components/app/ConnectBanner';
import type { AppEventEmitter } from '@/components/app/contexts/AppEventEmitterContext';

let mockEventEmitter: AppEventEmitter;

jest.mock('@/components/app/app.hooks', () => ({
  useEventEmitter: () => mockEventEmitter,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function createEventEmitter() {
  return new EventEmitter() as AppEventEmitter;
}

function renderConnectBanner(eventEmitter: AppEventEmitter) {
  mockEventEmitter = eventEmitter;

  return render(<ConnectBanner />);
}

describe('ConnectBanner', () => {
  it('does not show connecting when websocket is already open before subscribing', () => {
    const eventEmitter = createEventEmitter();

    eventEmitter.webSocketReadyState = 1;
    renderConnectBanner(eventEmitter);

    expect(screen.queryByTestId('connect-banner')).toBeNull();
  });

  it('hides when websocket status changes to open', () => {
    const eventEmitter = createEventEmitter();

    renderConnectBanner(eventEmitter);
    expect(screen.queryByTestId('connect-banner-connecting')).not.toBeNull();

    act(() => {
      eventEmitter.webSocketReadyState = 1;
      eventEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });

    expect(screen.queryByTestId('connect-banner')).toBeNull();
  });
});
