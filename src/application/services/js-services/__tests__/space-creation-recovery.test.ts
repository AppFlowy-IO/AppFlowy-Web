import { ERROR_CODE } from '@/application/constants';

import { isDefinitiveCreationRejection, readSpaceCreationAdmission } from '../space-creation-recovery';

const mockGetCapabilities = jest.fn();

jest.mock('@/application/services/domains', () => ({
  PageService: {},
  WorkspaceService: { getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetCapabilities(...args) },
}));
jest.mock('../http/view-api', () => ({ getView: jest.fn() }));

describe('isDefinitiveCreationRejection', () => {
  it.each([
    ['validation', { code: 422, httpStatus: 422, message: 'invalid space name' }],
    ['bad request', { code: ERROR_CODE.INVALID_REQUEST, httpStatus: 400 }],
    ['B denial', { code: ERROR_CODE.NOT_HAS_PERMISSION, httpStatus: 403 }],
    ['an application rejection inside HTTP 200', { code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'denied' }],
    ['an HTTP status without httpStatus', { code: 403 }],
    ['axios-shaped 4xx', { response: { status: 400, data: { code: ERROR_CODE.INVALID_REQUEST } } }],
    ['confirmed compensation', { code: -1, clientGeneratedCleanupSucceeded: true }],
  ])('treats %s as definitive', (_case, error) => {
    expect(isDefinitiveCreationRejection(error)).toBe(true);
  });

  it.each([
    ['a lost response', { code: -1, message: 'Network error' }],
    ['a timeout', { code: 408, httpStatus: 408 }],
    ['a client-owned ID conflict', { code: ERROR_CODE.RECORD_ALREADY_EXISTS, httpStatus: 409 }],
    ['a server error', { code: 503, httpStatus: 503 }],
    ['a retry-later envelope', { code: ERROR_CODE.RETRY_LATER }],
    ['an unconfirmed compensation', { code: ERROR_CODE.INVALID_REQUEST, httpStatus: 400, clientGeneratedCleanupSucceeded: false }],
    ['a plain Error', new Error('response lost')],
    ['a non-object', 'failed'],
  ])('keeps %s resumable', (_case, error) => {
    expect(isDefinitiveCreationRejection(error)).toBe(false);
  });
});

describe('readSpaceCreationAdmission', () => {
  beforeEach(() => mockGetCapabilities.mockReset());

  it.each([
    [{ can_create_space: true }, 'allowed'],
    [{ can_create_space: false }, 'denied'],
  ])('maps a capability %j to %s', async (capability, admission) => {
    mockGetCapabilities.mockResolvedValue(capability);
    await expect(readSpaceCreationAdmission('workspace-1')).resolves.toBe(admission);
    expect(mockGetCapabilities).toHaveBeenCalledWith('workspace-1');
  });

  it.each([404, 405])('lets a server without the capability route (HTTP %s) decide', async (status) => {
    mockGetCapabilities.mockRejectedValue({ code: status, httpStatus: status, message: 'Not found' });
    await expect(readSpaceCreationAdmission('workspace-1')).resolves.toBe('unsupported');
  });

  it.each([
    ['a network failure', { code: -1, message: 'Network error' }],
    ['an application not-found', { code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 }],
    ['an invalid response', new Error('Invalid space creation capabilities')],
  ])('reports %s as unavailable', async (_case, error) => {
    mockGetCapabilities.mockRejectedValue(error);
    await expect(readSpaceCreationAdmission('workspace-1')).resolves.toBe('unavailable');
  });
});
