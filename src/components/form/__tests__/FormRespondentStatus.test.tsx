import { render, screen, waitFor } from '@testing-library/react';

import { db } from '@/application/db';
import { getPublicFormStoredUser } from '@/application/services/js-services/http/public-form-client';
import type { User } from '@/application/types';
import { FormRespondentStatus } from '@/components/form/FormRespondentStatus';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

jest.mock('@/application/db', () => ({
  db: {
    users: {
      get: jest.fn(),
    },
  },
}));

jest.mock('@/application/services/js-services/http/public-form-client', () => ({
  getPublicFormStoredUser: jest.fn(),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
  },
}));

const mockGetPublicFormStoredUser = getPublicFormStoredUser as jest.MockedFunction<typeof getPublicFormStoredUser>;
const mockUseCurrentUserOptional = useCurrentUserOptional as jest.MockedFunction<typeof useCurrentUserOptional>;
const mockGetCachedUser = db.users.get as jest.MockedFunction<typeof db.users.get>;

describe('FormRespondentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPublicFormStoredUser.mockReturnValue(null);
    mockUseCurrentUserOptional.mockReturnValue(undefined);
    mockGetCachedUser.mockResolvedValue(undefined);
  });

  it('shows the server-enforced anonymous state even when a member is signed in', () => {
    mockUseCurrentUserOptional.mockReturnValue(user({ name: 'Nathan Fu' }));

    render(<FormRespondentStatus anonymous />);

    expect(screen.getByTestId('public-form-respondent-status').textContent).toBe('Submitting response anonymously');
    expect(screen.queryByText('Nathan Fu')).toBeNull();
    expect(mockGetCachedUser).not.toHaveBeenCalled();
  });

  it('shows the current member name and avatar fallback for attributed responses', () => {
    mockUseCurrentUserOptional.mockReturnValue(user({ name: 'Nathan Fu' }));

    render(<FormRespondentStatus anonymous={false} />);

    expect(screen.getByLabelText('Submitting response as Nathan Fu')).toBeTruthy();
    expect(screen.getByText('Nathan Fu')).toBeTruthy();
    expect(screen.getByText('N')).toBeTruthy();
  });

  it('loads the persisted profile when the public route has no AppConfig context', async () => {
    mockGetPublicFormStoredUser.mockReturnValue({ id: 'user-1', email: 'nathan@example.com' });
    mockGetCachedUser.mockResolvedValue(user({ name: 'Nathan Fu' }));

    render(<FormRespondentStatus anonymous={false} />);

    expect(screen.getByText('nathan@example.com')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nathan Fu')).toBeTruthy());
    expect(mockGetCachedUser).toHaveBeenCalledWith('user-1');
  });

  it('keeps the attributed status visible while local profile copy is unavailable', () => {
    render(<FormRespondentStatus anonymous={false} />);

    expect(screen.getByLabelText('Submitting response as Workspace member')).toBeTruthy();
  });
});

function user(overrides: Partial<User> = {}): User {
  return {
    avatar: null,
    email: 'nathan@example.com',
    latestWorkspaceId: 'workspace-1',
    name: 'Nathan Fu',
    uid: '1',
    uuid: 'user-1',
    ...overrides,
  };
}
