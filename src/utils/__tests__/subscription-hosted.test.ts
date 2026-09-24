import { isOfficialHostedServer } from '@/utils/subscription';

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
  });

  it('treats an explicit self_hosted flag as authoritative', () => {
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: false } })).toBe(true);
    mockGetConfigValue.mockReturnValue('https://beta.appflowy.cloud');
    expect(isOfficialHostedServer({ status: 'available', info: { self_hosted: true } })).toBe(false);
  });

  it('falls back to the hostname allowlist when the server omits the flag', () => {
    mockGetConfigValue.mockReturnValue('https://beta.appflowy.cloud');
    expect(isOfficialHostedServer({ status: 'available', info: {} })).toBe(true);

    mockGetConfigValue.mockReturnValue('http://localhost:8000');
    expect(isOfficialHostedServer({ status: 'available', info: {} })).toBe(true);

    mockGetConfigValue.mockReturnValue('https://selfhost.example.com');
    expect(isOfficialHostedServer({ status: 'available', info: {} })).toBe(false);
  });
});
