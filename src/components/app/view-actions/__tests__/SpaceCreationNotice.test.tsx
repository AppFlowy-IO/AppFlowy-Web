import type { WorkspaceSpaceCreationCapabilities } from '@/application/workspace-permissions';
import {
  canStartSpaceCreation,
  spaceCreationUnavailableReason,
} from '@/components/app/view-actions/SpaceCreationNotice';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Status = 'loading' | 'ready' | 'unsupported' | 'error';

const refused = { code: 1012, message: 'active workspace membership required' };

function permission(status: Status, canCreateSpace: boolean, retained?: boolean, error?: unknown) {
  return {
    status,
    canCreateSpace,
    capability: retained === undefined ? undefined : ({ can_create_space: retained } as WorkspaceSpaceCreationCapabilities),
    error,
  };
}

describe('space creation entry points', () => {
  it.each([
    ['a fresh allowed answer', permission('ready', true, true), true, undefined],
    ['a fresh denial', permission('ready', false, false), false, 'denied'],
    ['a denial reported without a capability object', permission('ready', false), false, 'denied'],
    ['the first check', permission('loading', false), false, 'loading'],
    ['a failed first check', permission('error', false), false, 'loadError'],
    ['a server without the capability route', permission('unsupported', false), true, undefined],
    // Background rechecks keep the last confirmed answer on screen; sending re-reads it fresh.
    ['a recheck of an allowed answer', permission('loading', false, true), true, undefined],
    ['a recheck of a denial', permission('loading', false, false), false, 'denied'],
    ['a failed recheck of an allowed answer', permission('error', false, true), false, 'loadError'],
    ['a failed recheck of a denial', permission('error', false, false), false, 'denied'],
    // A refused read is the server's answer, not a check that could not run.
    ['a refused first check', permission('error', false, undefined, refused), false, 'denied'],
    ['a refused recheck of an allowed answer', permission('error', false, true, { httpStatus: 403 }), false, 'denied'],
    ['an offline check', permission('error', false, undefined, new Error('Offline')), false, 'loadError'],
  ] as const)('handles %s', (_case, value, startable, reason) => {
    expect(canStartSpaceCreation(value)).toBe(startable);
    expect(spaceCreationUnavailableReason(value)).toBe(reason);
  });
});
