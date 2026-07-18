import * as Y from 'yjs';

import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';

describe('subscribeSharedYjsDeep', () => {
  it('uses one Yjs observer and keeps subscriber cleanup independent', () => {
    const doc = new Y.Doc();
    const target = doc.getMap('target');
    const observe = jest.spyOn(target, 'observeDeep');
    const unobserve = jest.spyOn(target, 'unobserveDeep');
    const first = jest.fn();
    const second = jest.fn();

    const unsubscribeFirst = subscribeSharedYjsDeep(target, first);
    const unsubscribeSecond = subscribeSharedYjsDeep(target, second);

    expect(observe).toHaveBeenCalledTimes(1);

    target.set('first-change', true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    target.set('second-change', true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(unobserve).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(unobserve).toHaveBeenCalledTimes(1);
  });
});
