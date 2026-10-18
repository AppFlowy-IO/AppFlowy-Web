const mockGet = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ get: mockGet }) },
}));

beforeEach(() => {
  jest.resetModules();
  mockGet.mockReset();
});

const catalog = { mail: [{ id: 'mail/chat', name: 'chat', content: '<svg />', keywords: [] }] };

it('retries loading the icon catalog after a network error', async () => {
  const { getIcon } = await import('../emoji');

  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: catalog });
  await expect(getIcon('mail/chat')).rejects.toThrow('offline');
  await expect(getIcon('mail/chat')).resolves.toEqual(catalog.mail[0]);
  expect(mockGet).toHaveBeenCalledTimes(2);
});

it('shares one pending request and reuses a successfully loaded catalog', async () => {
  const { getIcon } = await import('../emoji');

  mockGet.mockResolvedValue({ data: catalog });
  const icons = await Promise.all([getIcon('mail/chat'), getIcon('mail/chat')]);

  expect(icons).toEqual([catalog.mail[0], catalog.mail[0]]);
  await getIcon('mail/chat');
  expect(mockGet).toHaveBeenCalledTimes(1);
});
