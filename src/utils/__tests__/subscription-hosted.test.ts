import { getServerHostingMode, isOfficialHostedServer } from '@/utils/server-info';

const mockGetConfigValue = jest.fn<string, [string, string]>();

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (key: string, fallback: string) => mockGetConfigValue(key, fallback),
}));

describe('isOfficialHostedServer', () => {
  beforeEach(() => {
    mockGetConfigValue.mockReset();
    mockGetConfigValue.mockReturnValue('https://beta.appflowy.cloud');
  });

  it('never grants billing while server info is loading or unavailable', () => {
    expect(isOfficialHostedServer({ status: 'loading' })).toBe(false);
    expect(isOfficialHostedServer({ status: 'unavailable' })).toBe(false);
    expect(getServerHostingMode({ status: 'loading' })).toBe('unknown');
    expect(getServerHostingMode({ status: 'unavailable' })).toBe('unknown');
  });

  it('treats an explicit self_hosted flag as authoritative', () => {
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: false } })).toBe(true);
    mockGetConfigValue.mockReturnValue('https://beta.appflowy.cloud');
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: true } })).toBe(false);
  });

  it.each(['https://beta.appflowy.cloud', 'https://test.appflowy.cloud'])(
    'keeps legacy cloud billing on %s when the flag is missing',
    (baseUrl) => {
      mockGetConfigValue.mockReturnValue(baseUrl);
      expect(isOfficialHostedServer({ status: 'available', info: {} })).toBe(true);
    }
  );

  it.each([
    'http://localhost',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://[::1]:8000',
    'https://selfhost.example.com',
  ])('does not infer cloud billing from %s', (baseUrl) => {
    mockGetConfigValue.mockReturnValue(baseUrl);
    expect(isOfficialHostedServer({ status: 'available', info: {} })).toBe(false);
    expect(getServerHostingMode({ status: 'available', info: {} })).toBe('self-hosted');
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: true } })).toBe(false);
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: false } })).toBe(true);
  });
});
