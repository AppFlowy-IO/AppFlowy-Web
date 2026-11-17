import { emit, EventType } from '@/application/session/event';

import { onMentionSessionInvalid } from '../mentionSessionInvalid';

// The session emitter warns once an event has more than ten listeners (`events`), and the app's
// other caches hold most of SESSION_INVALID's, so the mention modules share one.
describe('the mention modules on SESSION_INVALID', () => {
  afterEach(() => {
    jest.dontMock('@/application/session/event');
  });

  it('listen through one listener between them', () => {
    jest.isolateModules(() => {
      const actual = jest.requireActual<typeof import('@/application/session/event')>('@/application/session/event');
      const on = jest.fn(actual.on);

      jest.doMock('@/application/session/event', () => ({ ...actual, on }));
      require('../mentionLocalIndex');
      require('../mentionLocalLane');
      require('../mentionLocalRanker');
      require('../mentionSearchCache');

      const sessionListeners = on.mock.calls.filter(([eventType]) => eventType === EventType.SESSION_INVALID);

      expect(sessionListeners).toHaveLength(1);
    });
  });

  it('clear in the order they were added, on every SESSION_INVALID', () => {
    const cleared: string[] = [];

    onMentionSessionInvalid(() => cleared.push('index'));
    onMentionSessionInvalid(() => cleared.push('cache'));
    emit(EventType.SESSION_INVALID);
    emit(EventType.SESSION_INVALID);
    expect(cleared).toEqual(['index', 'cache', 'index', 'cache']);
  });
});
