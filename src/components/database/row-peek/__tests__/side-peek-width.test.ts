import { loadSidePeekWidth, saveSidePeekWidth } from '../side-peek-width';

const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('dexie', () => jest.fn().mockImplementation(() => ({
  version: () => ({ stores: jest.fn() }),
  table: () => ({
    get: (key: string) => mockGet(key),
    put: (record: unknown) => mockPut(record),
  }),
})));

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(undefined);
  mockPut.mockReset().mockResolvedValue(undefined);
});

it('stores only the browser width and reads it back', async () => {
  await saveSidePeekWidth(720);
  expect(mockPut).toHaveBeenCalledWith({ key: 'side_peek_width', value: 720 });
  mockGet.mockResolvedValue({ key: 'side_peek_width', value: 720 });
  expect(await loadSidePeekWidth()).toBe(720);
  expect(mockGet).toHaveBeenCalledWith('side_peek_width');
});

it.each([undefined, null, '720', 0, -1, NaN, Infinity])('ignores malformed stored widths (%s)', async (value) => {
  mockGet.mockResolvedValue({ value });
  expect(await loadSidePeekWidth()).toBeUndefined();
});

it('falls back when the preference is absent or browser storage is blocked', async () => {
  expect(await loadSidePeekWidth()).toBeUndefined();
  mockGet.mockRejectedValue(new Error('Storage is blocked'));
  mockPut.mockRejectedValue(new Error('Quota exceeded'));
  await expect(loadSidePeekWidth()).resolves.toBeUndefined();
  await expect(saveSidePeekWidth(720)).resolves.toBeUndefined();
});

it.each([0, -1, NaN, Infinity])('does not persist an invalid resize (%s)', async (width) => {
  await saveSidePeekWidth(width);
  expect(mockPut).not.toHaveBeenCalled();
});
