const mockConfig: Record<string, string | undefined> = {};

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (key: string, fallback: string) => mockConfig[key] ?? fallback,
}));

function presentationEnabled(): boolean {
  let enabled = false;

  jest.isolateModules(() => {
    enabled = jest.requireActual<typeof import('../feature')>('../feature').PRESENTATION_ENABLED;
  });
  return enabled;
}

afterEach(() => {
  delete mockConfig.APPFLOWY_PRESENTATION_ENABLED;
});

test('presentation entries stay off unless the deployment enables them', () => {
  expect(presentationEnabled()).toBe(false);
  mockConfig.APPFLOWY_PRESENTATION_ENABLED = 'true';
  expect(presentationEnabled()).toBe(true);
});
