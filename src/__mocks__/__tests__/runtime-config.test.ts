import { getConfigValue } from '@/utils/runtime-config';

describe('the Jest runtime-config mock', () => {
  it('leaves the MCP override unset, so suites that do not set it see no MCP service', () => {
    expect(getConfigValue('APPFLOWY_MCP_BASE_URL', '')).toBe('');
  });
});
