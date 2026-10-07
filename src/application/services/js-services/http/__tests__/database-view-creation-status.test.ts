import { getDatabaseViewCreationStatus } from '../workspace-api';

const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: (...args: unknown[]) => mockGet(...args) }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
}));

describe('workspace database view creation status', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads both workspace-wide allowances using the authenticated API client', async () => {
    const status = { can_create_form: true, can_create_chart: false };

    mockGet.mockResolvedValue({ data: { data: status } });
    await expect(getDatabaseViewCreationStatus('workspace')).resolves.toEqual(status);
    expect(mockGet).toHaveBeenCalledWith('/api/workspace/workspace/database-view-creation-status');
  });

  it.each([undefined, {}, { can_create_form: true }, { can_create_form: 'true', can_create_chart: false }])(
    'rejects incomplete/malformed status instead of inventing an allowance: %s',
    async (status) => {
      mockGet.mockResolvedValue({ data: { data: status } });
      await expect(getDatabaseViewCreationStatus('workspace')).rejects.toThrow('Invalid database view creation status');
    }
  );

  it('propagates an unavailable endpoint', async () => {
    mockGet.mockRejectedValue(new Error('Not found'));
    await expect(getDatabaseViewCreationStatus('workspace')).rejects.toThrow('Not found');
  });
});
