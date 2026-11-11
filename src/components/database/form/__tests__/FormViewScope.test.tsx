import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FormViewScope from '../FormViewScope';
import { useFormShareContext } from '../FormShareContext';
import { resetFormShareMutationOutboxForTesting } from '../useFormShare';

const mockGet = jest.fn();
const mockPatch = jest.fn();
let mockCanShare = true;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ canShare: mockCanShare }),
  useDatabase: () => ({ get: () => 'database-id' }),
  useDatabaseViewId: () => 'form-id',
}));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceIdOptional: () => 'workspace-id' }));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'user-id' }));
jest.mock('@/application/services/js-services/http', () => ({
  getFormShare: (...args: unknown[]) => mockGet(...args),
  patchFormShare: (...args: unknown[]) => mockPatch(...args),
  mintFormShare: jest.fn(),
}));
const info = {
  token: 'token',
  tier: 'workspace',
  anonymous: false,
  submission_access: 'none',
  share_url: 'https://appflowy.test/form/token',
};

function Consumer({ label }: { label: string }) {
  const share = useFormShareContext();

  return (
    <button disabled={!share.canUpdateSettings} onClick={() => void share.setAnonymous(true)}>
      {label}: {String(share.info?.anonymous)}
    </button>
  );
}

beforeEach(() => {
  resetFormShareMutationOutboxForTesting();
  jest.clearAllMocks();
  mockCanShare = true;
  mockGet.mockResolvedValue(info);
  mockPatch.mockResolvedValue({ ...info, anonymous: true });
});

it('shares one bootstrap and mutation when the header mounts before the body', async () => {
  const tree = (body: boolean) => (
    <FormViewScope>
      <Consumer label='header' />
      {body && <Consumer label='body' />}
    </FormViewScope>
  );
  const { rerender } = render(tree(false));

  await screen.findByText('header: false');
  rerender(tree(true));
  await screen.findByText('body: false');
  expect(mockGet).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('header: false'));
  await screen.findByText('body: true');
  expect(mockPatch).toHaveBeenCalledTimes(1);
});

it('updates both consumers when sharing permission is revoked', async () => {
  const tree = () => (
    <FormViewScope>
      <Consumer label='header' />
      <Consumer label='body' />
    </FormViewScope>
  );
  const { rerender } = render(tree());

  await screen.findByText('header: false');
  mockCanShare = false;
  rerender(tree());
  await waitFor(() => expect(screen.getByText('header: false').disabled).toBe(true));
  expect(screen.getByText('body: false').disabled).toBe(true);
  expect(mockPatch).not.toHaveBeenCalled();
});
