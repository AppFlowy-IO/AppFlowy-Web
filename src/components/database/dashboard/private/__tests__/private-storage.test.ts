import { readPrivatePayload, removePrivatePayloadsForUser, writePrivatePayload } from '../private-storage';

const KEY = 'af.dashboard.private.v1:ws:42:dash';

beforeEach(() => {
  window.localStorage.clear();
});

describe('device-local private dashboard state', () => {
  it('writes, reads and removes a payload', () => {
    writePrivatePayload(KEY, { v: 1, saved_at: 1, global_filters: { gf: { condition: 0, content: 'x' } }, widgets: {} });
    expect(readPrivatePayload(KEY)).toEqual({ global_filters: { gf: { condition: 0, content: 'x' } }, widgets: {} });
    writePrivatePayload(KEY, null);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readPrivatePayload(KEY)).toBeNull();
  });

  it('removes an unreadable value as it reads it', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(readPrivatePayload(KEY)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(readPrivatePayload(KEY)).toBeNull();
    expect(() => writePrivatePayload(KEY, { v: 1, saved_at: 1, global_filters: {}, widgets: {} })).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
    warn.mockRestore();
  });

  it('sign-out removes every dashboard of that user on this device, and nothing else', () => {
    window.localStorage.setItem(KEY, '{}');
    window.localStorage.setItem('af.dashboard.private.v1:other-ws:42:other', '{}');
    window.localStorage.setItem('af.dashboard.private.v1:ws:7:dash', '{}');
    window.localStorage.setItem('unrelated', '{}');

    removePrivatePayloadsForUser('42');
    expect(Object.keys(window.localStorage).sort()).toEqual(['af.dashboard.private.v1:ws:7:dash', 'unrelated']);
    removePrivatePayloadsForUser(undefined);
    expect(window.localStorage.length).toBe(2);
  });
});
