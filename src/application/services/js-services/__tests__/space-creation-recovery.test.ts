import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import { ERROR_CODE } from '@/application/constants';

import {
  isDefinitiveCreationRejection,
  isSpaceCreationDenial,
  readSpaceCreationAdmission,
  recoverSpaceCreation,
} from '../space-creation-recovery';
import { SpaceCreationIntent } from '../space-creation-intent';

const mockGetCapabilities = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockAddPage = jest.fn();
const mockGetView = jest.fn();

// Messages are looked up by key, so a test can tell a translated message from a hard-coded one.
jest.mock('i18next', () => ({ t: (key: string) => `t:${key}` }));
jest.mock('@/application/services/domains', () => ({
  PageService: { add: (...args: unknown[]) => mockAddPage(...args) },
  WorkspaceService: {
    getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
  },
}));
jest.mock('../http/view-api', () => ({ getView: (...args: unknown[]) => mockGetView(...args) }));

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
    ['a server error', { code: 500, httpStatus: 500, message: 'Internal error' }],
    ['the offline marker', new Error('Offline')],
  ])('reports %s as unavailable', async (_case, error) => {
    mockGetCapabilities.mockRejectedValue(error);
    await expect(readSpaceCreationAdmission('workspace-1')).resolves.toBe('unavailable');
  });

  it.each([
    ['the not-enough-permissions code inside HTTP 200', { code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'denied' }],
    ['an HTTP 403', { code: 403, httpStatus: 403, message: 'Forbidden' }],
    ['an HTTP 403 with an application code', { code: ERROR_CODE.USER_UNAUTHORIZED, httpStatus: 403 }],
  ])('reports a refused read (%s) as a denial, not as a check that could not run', async (_case, error) => {
    mockGetCapabilities.mockRejectedValue(error);
    await expect(readSpaceCreationAdmission('workspace-1')).resolves.toBe('denied');
    expect(isSpaceCreationDenial(error)).toBe(true);
  });
});

describe('recoverSpaceCreation', () => {
  const intent = {
    payload: { view_id: 'space-1', name: 'Research' },
    initialPage: { view_id: 'page-1', layout: 0, name: 'Notes' },
    selectedMembers: [],
    members: [],
    appliedMemberUids: [],
  } as unknown as SpaceCreationIntent;
  const recover = () => recoverSpaceCreation('workspace-1', intent, () => undefined);

  beforeEach(() => {
    mockGetSpacePermission.mockReset().mockResolvedValue({ space_id: 'space-1' });
    mockGetView.mockReset();
    mockAddPage.mockReset();
  });

  it('finds the created space and its first page', async () => {
    mockGetView.mockResolvedValue({ view_id: 'page-1', parent_view_id: 'space-1' });
    await expect(recover()).resolves.toEqual({ spaceId: 'space-1', initialPageId: 'page-1' });
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it('explains in the reader\'s language when the first page is found somewhere else', async () => {
    mockGetView.mockResolvedValue({ view_id: 'page-1', parent_view_id: 'another-space' });
    await expect(recover()).rejects.toThrow('t:spaceCreation.firstPageElsewhere');
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it.each(['firstPageElsewhere', 'firstPageUnconfirmed'])('has English and French text for spaceCreation.%s', (key) => {
    const english = (en.spaceCreation as Record<string, string>)[key];
    const french = (fr.spaceCreation as Record<string, string>)[key];

    expect(typeof english).toBe('string');
    expect(typeof french).toBe('string');
    expect(french).not.toBe(english);
  });

  it('explains in the reader\'s language when the first page cannot be confirmed', async () => {
    mockGetView.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 });
    mockAddPage.mockResolvedValue({ view_id: 'page-from-server' });
    await expect(recover()).rejects.toThrow('t:spaceCreation.firstPageUnconfirmed');
    expect(mockAddPage).toHaveBeenCalledWith('workspace-1', 'space-1', intent.initialPage);
  });
});
