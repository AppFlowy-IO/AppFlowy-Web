import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import { ERROR_CODE } from '@/application/constants';

import {
  firstPageAddedUnderOtherId,
  isDefinitiveCreationRejection,
  isSpaceCreationDenial,
  readSpaceCreationAdmission,
  recoverSpaceCreation,
  SpaceCreationFirstPageError,
} from '../space-creation-recovery';
import { SpaceCreationIntent } from '../space-creation-intent';

const mockGetCapabilities = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockPost = jest.fn();
const mockGetView = jest.fn();
const mockCreateDefaultPage = jest.fn();

// Messages are looked up by key, so a test can tell a translated message from a hard-coded one.
jest.mock('i18next', () => ({ t: (key: string) => `t:${key}` }));
// Only the transport is fake: the real page request runs, with its own check of the returned ID.
jest.mock('../http/core', () => ({
  ...jest.requireActual('../http/core'),
  getAxios: () => ({ post: (...args: unknown[]) => mockPost(...args) }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
}));
jest.mock('@/application/services/domains', () => ({
  PageService: { add: (...args: unknown[]) => jest.requireActual('../http/page-api').addAppPage(...args) },
  WorkspaceService: {
    getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
  },
}));
jest.mock('../http/view-api', () => ({ getView: (...args: unknown[]) => mockGetView(...args) }));
// A default first page goes through main's atomic creation; authored pages keep the page-view request.
jest.mock('../http/page-default-creation', () => ({
  ...jest.requireActual('../http/page-default-creation'),
  createDefaultPage: (...args: unknown[]) => mockCreateDefaultPage(...args),
}));

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

describe('firstPageAddedUnderOtherId', () => {
  /** What the create request's own ID check throws. */
  const answeredWithOtherId = (requested: string) =>
    Object.assign(new Error(`Create ${requested.startsWith('page') ? 'page' : 'space'} returned an unexpected view ID`), {
      code: -1,
      clientGeneratedExpectedViewId: requested,
      clientGeneratedReturnedViewId: 'chosen-by-server',
    });

  it('recognises a first page added under an ID the server chose', () => {
    expect(firstPageAddedUnderOtherId(answeredWithOtherId('page-1'), 'page-1')).toBe(true);
  });

  it.each([
    ['a space created under another ID', answeredWithOtherId('space-1'), 'page-1'],
    ['a request without a first page', answeredWithOtherId('page-1'), undefined],
    ['a server error', { code: 500, httpStatus: 500 }, 'page-1'],
    ['a non-object', 'failed', 'page-1'],
  ])('does not treat %s as a first page problem', (_case, error, initialPageId) => {
    expect(firstPageAddedUnderOtherId(error, initialPageId)).toBe(false);
  });
});

describe('recoverSpaceCreation', () => {
  const intent = {
    payload: { view_id: 'space-1', name: 'Research' },
    // Authored content keeps these cases on the page-view request and its own ID check.
    initialPage: { view_id: 'page-1', layout: 0, name: 'Notes', page_data: { blocks: [] } },
    selectedMembers: [],
    members: [],
    appliedMemberUids: [],
  } as unknown as SpaceCreationIntent;
  const recover = (saved: SpaceCreationIntent = intent) => recoverSpaceCreation('workspace-1', saved, () => undefined);
  /** The server's answer to the page request: the ID it created the page under. */
  const serverCreatesPage = (viewId: string) =>
    mockPost.mockResolvedValue({ data: { code: 0, data: { view_id: viewId } } });

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    mockGetSpacePermission.mockReset().mockResolvedValue({ space_id: 'space-1' });
    mockGetView.mockReset();
    mockPost.mockReset();
  });

  it('finds the created space and its first page', async () => {
    mockGetView.mockResolvedValue({ view_id: 'page-1', parent_view_id: 'space-1' });
    await expect(recover()).resolves.toEqual({ spaceId: 'space-1', initialPageId: 'page-1' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('adds a missing first page under the requested ID', async () => {
    mockGetView.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 });
    serverCreatesPage('page-1');
    await expect(recover()).resolves.toEqual({ spaceId: 'space-1', initialPageId: 'page-1' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/workspace/workspace-1/page-view',
      expect.objectContaining({ parent_view_id: 'space-1', view_id: 'page-1', collab_id: 'page-1' })
    );
  });

  it('adds a missing default first page through atomic creation under the requested ID', async () => {
    const defaultPage = { view_id: 'page-1', layout: 0, name: 'Notes' };

    mockGetView.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 });
    mockCreateDefaultPage.mockReset().mockResolvedValue({ view_id: 'page-1' });
    await expect(recover({ ...intent, initialPage: defaultPage } as unknown as SpaceCreationIntent)).resolves.toEqual({
      spaceId: 'space-1',
      initialPageId: 'page-1',
    });
    expect(mockCreateDefaultPage).toHaveBeenCalledWith('workspace-1', 'space-1', defaultPage, undefined);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('explains in the reader\'s language when the first page is found somewhere else', async () => {
    mockGetView.mockResolvedValue({ view_id: 'page-1', parent_view_id: 'another-space' });
    const failure = recover();

    await expect(failure).rejects.toThrow('t:spaceCreation.firstPageElsewhere');
    await expect(failure).rejects.toMatchObject({ problem: 'elsewhere' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(['firstPageElsewhere', 'firstPageUnconfirmed'])('has English and French text for spaceCreation.%s', (key) => {
    const english = (en.spaceCreation as Record<string, string>)[key];
    const french = (fr.spaceCreation as Record<string, string>)[key];

    expect(typeof english).toBe('string');
    expect(typeof french).toBe('string');
    expect(french).not.toBe(english);
  });

  it('explains in the reader\'s language when the server adds the first page under its own ID', async () => {
    mockGetView.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 });
    // An older server ignores the requested ID; the page request itself refuses the answer.
    serverCreatesPage('page-from-server');
    const failure = recover();

    await expect(failure).rejects.toThrow('t:spaceCreation.firstPageUnconfirmed');
    await expect(failure).rejects.toBeInstanceOf(SpaceCreationFirstPageError);
    await expect(failure).rejects.toMatchObject({ problem: 'unconfirmed' });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('keeps any other failure of the page request as it is', async () => {
    mockGetView.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 404 });
    mockPost.mockRejectedValue({ code: 500, httpStatus: 500, message: 'Internal error' });
    await expect(recover()).rejects.toEqual({ code: 500, httpStatus: 500, message: 'Internal error' });
  });

  it.each(['elsewhere', 'unconfirmed'] as const)(
    'never reads or adds the first page again once it was found %s',
    async (problem) => {
      const failure = recover({ ...intent, firstPageProblem: problem });

      await expect(failure).rejects.toBeInstanceOf(SpaceCreationFirstPageError);
      await expect(failure).rejects.toMatchObject({ problem });
      expect(mockGetSpacePermission).not.toHaveBeenCalled();
      expect(mockGetView).not.toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
    }
  );
});
