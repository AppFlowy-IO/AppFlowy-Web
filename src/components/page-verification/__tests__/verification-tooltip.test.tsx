import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PageVerification } from '@/application/page-verification/types';
import { PageVerificationControl } from '@/components/page-verification/PageVerificationControl';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
let mockData: PageVerification;
let mockUserId: string | undefined;
let mockWorkspaceId: string;
let mockClaimVersion: symbol;
const mockAccept = jest.fn();
const mockCreateNativeProperty = jest.fn();
const mockRemoveVerification = jest.fn();
const mockVerify = jest.fn();
let mockDatabase: Record<string, unknown>;
let mockCurrentData: PageVerification | undefined;
const mockStore = {
  snapshot: () => ({ data: mockCurrentData ?? mockData }),
  refresh: jest.fn().mockResolvedValue(undefined),
  accept: mockAccept,
  claimVersion: () => mockClaimVersion,
  acceptMutation: jest.fn((data: PageVerification, alias: string, expectedVersion: symbol) => {
    if (expectedVersion !== mockClaimVersion) return false;
    mockAccept(data, alias);
    mockClaimVersion = Symbol();
    return true;
  }),
  invalidateDatabase: jest.fn(),
};

jest.mock('@/application/page-verification/database', () => ({
  useDatabaseVerification: () => mockDatabase,
}));
jest.mock('@/application/page-verification/store', () => ({
  verificationStore: () => mockStore,
  useVerification: () => ({ data: mockData }),
}));
jest.mock('@/application/publish', () => ({ usePublishContext: () => undefined }));
jest.mock('@/application/services/js-services/http/page-verification-api', () => ({
  removePageVerification: (...args: unknown[]) => mockRemoveVerification(...args),
  verifyPage: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceIdOptional: () => mockWorkspaceId }));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => mockUserId }));
jest.mock('@/components/billing/UpgradePlan', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/editor/components/leaf/mention/MentionDatePicker', () => ({
  __esModule: true,
  default: () => null,
}));

beforeAll(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user';
  mockWorkspaceId = 'workspace';
  mockClaimVersion = Symbol();
  mockCreateNativeProperty.mockResolvedValue(undefined);
  mockCurrentData = undefined;
  mockDatabase = {};
  mockData = {
    target_id: 'page',
    database_id: null,
    property: null,
    verification: {
      id: 'record',
      verified_by: { uid: 42, name: 'Reviewer' },
      verified_at: '2026-10-15T00:00:00Z',
      expires_at: null,
    },
    status: 'verified',
    can_edit: true,
    eligible: true,
  };
});

it('keeps the tooltip closed on focus and opens it only while hovering', async () => {
  render(<PageVerificationControl targetId='page' />);
  const badge = screen.getByRole('button', { name: 'Verified' });

  act(() => badge.focus());
  expect(document.activeElement).toBe(badge);
  expect(screen.queryByRole('tooltip')).toBeNull();

  fireEvent.pointerMove(badge, { pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('Verified by Reviewer'));
  fireEvent.pointerLeave(badge, { pointerType: 'mouse' });
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  expect(document.activeElement).toBe(badge);
});

it('restores focus after dismissing details without opening the tooltip', async () => {
  render(<PageVerificationControl targetId='page' />);
  const badge = screen.getByRole('button', { name: 'Verified' });

  act(() => badge.focus());
  // A keyboard-generated click has no pointer-down event.
  fireEvent.click(badge, { detail: 0 });
  await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy());
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(badge));
  expect(screen.queryByRole('tooltip')).toBeNull();

  fireEvent.pointerMove(badge, { pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('Verified by Reviewer'));
});

it('hides native cell claims and actions when the bound generation disappears or changes', async () => {
  mockData.property = { id: 'generation-A', database_id: 'db' };
  const { rerender } = render(<PageVerificationControl targetId='page' expectedPropertyId='generation-A' />);

  fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
  await screen.findByText('Reviewer');

  mockData = { ...mockData, property: null };
  rerender(<PageVerificationControl targetId='page' expectedPropertyId='generation-A' />);
  expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
  expect(screen.queryByText('Reviewer')).toBeNull();

  mockData = { ...mockData, property: { id: 'generation-B', database_id: 'db' } };
  rerender(<PageVerificationControl targetId='page' expectedPropertyId='generation-A' />);
  expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
  rerender(<PageVerificationControl targetId='page' expectedPropertyId='generation-B' />);
  expect(screen.getByRole('button', { name: 'Verified' })).toBeTruthy();
  expect(screen.queryByText('Reviewer')).toBeNull();
});

it('never enables an unbound native cell, while the plain header remains current', () => {
  const { rerender } = render(<PageVerificationControl targetId='page' expectedPropertyId='' />);

  expect(screen.queryByRole('button')).toBeNull();
  rerender(<PageVerificationControl targetId='page' />);
  expect(screen.getByRole('button', { name: 'Verified' })).toBeTruthy();
});

it('creates the native property through database lifecycle before verifying a row', async () => {
  mockData = { ...mockData, database_id: 'db', verification: null, status: 'unverified' };
  mockDatabase = { databaseId: 'db', state: { can_edit: true }, create: mockCreateNativeProperty };
  render(<PageVerificationControl targetId='page' />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Verification' }));
  await waitFor(() => expect(mockCreateNativeProperty).toHaveBeenCalledTimes(1));
  expect(mockStore.refresh).not.toHaveBeenCalled();
  expect(mockVerify).not.toHaveBeenCalled();
});

it('guides a standalone row to its database instead of creating a Cloud-only property', async () => {
  mockData = { ...mockData, database_id: 'db', verification: null, status: 'unverified' };
  render(<PageVerificationControl targetId='page' />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByText('grid.verification.openDatabaseToSetup');
  expect(screen.queryByRole('button', { name: 'Add Verification' })).toBeNull();
  expect(mockCreateNativeProperty).not.toHaveBeenCalled();
});

it('does not remove a claim replaced since the control was rendered', async () => {
  render(<PageVerificationControl targetId='page' />);
  fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
  await screen.findByText('Reviewer');
  mockCurrentData = { ...mockData, verification: { ...mockData.verification!, id: 'replacement' } };
  fireEvent.click(screen.getByRole('button', { name: 'Remove verification' }));
  await screen.findByRole('alert');
  expect(mockRemoveVerification).not.toHaveBeenCalled();
});

it('closes pending verification choices when the row becomes read-only', async () => {
  mockData = { ...mockData, verification: null, status: 'unverified' };
  const { rerender } = render(<PageVerificationControl targetId='page' />);

  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('menu', { name: 'Verify page' });
  rerender(<PageVerificationControl targetId='page' readOnly />);
  expect(screen.queryByRole('menu', { name: 'Verify page' })).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
});

const pageActions = ['verify', 'remove'] as const;

type PageAction = (typeof pageActions)[number];

async function startPageAction(action: PageAction) {
  fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
  if (action === 'verify') {
    fireEvent.click(await screen.findByRole('button', { name: 'Renew verification' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Indefinitely' }));
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'Remove verification' }));
  }
}

function pendingPageAction(action: PageAction) {
  let finish!: (data: PageVerification) => void;
  const response = new Promise<PageVerification>((resolve) => {
    finish = resolve;
  });

  (action === 'verify' ? mockVerify : mockRemoveVerification).mockReturnValueOnce(response);
  return { response, finish };
}

it.each(pageActions)('does not publish a delayed %s response after unmount', async (action) => {
  const request = pendingPageAction(action);
  const { unmount } = render(<PageVerificationControl targetId='page' />);

  await startPageAction(action);
  unmount();
  await act(async () => {
    request.finish(mockData);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
  expect(mockStore.refresh).not.toHaveBeenCalled();
});

it.each(pageActions)('does not publish a delayed %s after leaving and returning to an account', async (action) => {
  const request = pendingPageAction(action);
  const { rerender } = render(<PageVerificationControl targetId='page' />);

  await startPageAction(action);
  mockUserId = undefined;
  rerender(<PageVerificationControl targetId='page' />);
  mockUserId = 'user';
  rerender(<PageVerificationControl targetId='page' />);
  await act(async () => {
    request.finish(mockData);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
  expect(mockStore.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Verified' }).disabled).toBe(false);
});

it.each(['workspace', 'target', 'property', 'readonly', 'permission'] as const)(
  'discards verify results after the %s scope changes',
  async (change) => {
    const request = pendingPageAction('verify');
    const { rerender } = render(<PageVerificationControl targetId='page' />);

    await startPageAction('verify');
    if (change === 'workspace') mockWorkspaceId = 'other-workspace';
    if (change === 'property') mockData = { ...mockData, property: { id: 'other-property', database_id: 'db' } };
    if (change === 'permission') mockData = { ...mockData, can_edit: false };
    rerender(
      <PageVerificationControl targetId={change === 'target' ? 'other-page' : 'page'} readOnly={change === 'readonly'} />
    );
    await act(async () => {
      request.finish(mockData);
      await request.response;
    });
    expect(mockStore.accept).not.toHaveBeenCalled();
    expect(mockStore.refresh).not.toHaveBeenCalled();
  }
);

it('checks live permission again before publishing even before a React rerender', async () => {
  const request = pendingPageAction('verify');

  render(<PageVerificationControl targetId='page' />);
  await startPageAction('verify');
  mockCurrentData = { ...mockData, can_edit: false };
  await act(async () => {
    request.finish(mockData);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
});

it.each(pageActions)('publishes a completed %s in the unchanged standalone page scope', async (action) => {
  const request = pendingPageAction(action);

  render(<PageVerificationControl targetId='page' />);
  await startPageAction(action);
  await act(async () => {
    request.finish(mockData);
    await request.response;
  });
  expect(mockStore.accept).toHaveBeenCalledWith(mockData, 'page');
});

it('discards a native cell result after its expected binding changes', async () => {
  mockData = { ...mockData, property: { id: 'generation-A', database_id: 'db' } };
  const request = pendingPageAction('verify');
  const { rerender } = render(<PageVerificationControl targetId='page' expectedPropertyId='generation-A' />);

  await startPageAction('verify');
  rerender(<PageVerificationControl targetId='page' expectedPropertyId='generation-B' />);
  await act(async () => {
    request.finish(mockData);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
  expect(mockStore.refresh).not.toHaveBeenCalled();
});

it('rejects a verify action when live permission was revoked before its click', async () => {
  render(<PageVerificationControl targetId='page' />);
  fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Renew verification' }));
  mockCurrentData = { ...mockData, can_edit: false };
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Indefinitely' }));
  await screen.findByRole('alert');
  expect(mockVerify).not.toHaveBeenCalled();
});

it('finishes native setup when creation replaces its captured property scope', async () => {
  let finish!: () => void;
  const created = new Promise<void>((resolve) => {
    finish = resolve;
  });

  mockCreateNativeProperty.mockReturnValueOnce(created);
  mockData = { ...mockData, database_id: 'db', verification: null, status: 'unverified' };
  mockDatabase = { databaseId: 'db', state: { can_edit: true }, create: mockCreateNativeProperty };
  const { rerender } = render(<PageVerificationControl targetId='page' />);

  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Verification' }));
  mockData = { ...mockData, property: { id: 'generation-created', database_id: 'db' } };
  mockDatabase = { ...mockDatabase, fieldId: 'native-field' };
  rerender(<PageVerificationControl targetId='page' />);
  await act(async () => {
    finish();
    await created;
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockStore.invalidateDatabase).not.toHaveBeenCalled();
  expect(mockStore.refresh).not.toHaveBeenCalled();
  expect(mockVerify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  expect(await screen.findByRole('menu', { name: 'Verify page' })).toBeTruthy();
});

it.each(pageActions)('refetches instead of publishing a delayed %s over a newer same-property claim', async (action) => {
  const request = pendingPageAction(action);
  const olderReply: PageVerification =
    action === 'verify'
      ? { ...mockData, verification: { ...mockData.verification!, id: 'older-renewal' } }
      : { ...mockData, verification: null, status: 'unverified' };
  const { rerender } = render(<PageVerificationControl targetId='page' />);

  await startPageAction(action);
  // Another control accepts a newer claim while this request is in flight.
  mockData =
    action === 'verify'
      ? { ...mockData, verification: null, status: 'unverified' }
      : { ...mockData, verification: { ...mockData.verification!, id: 'newer-renewal' } };
  mockClaimVersion = Symbol();
  rerender(<PageVerificationControl targetId='page' />);
  await act(async () => {
    request.finish(olderReply);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
  expect(mockStore.refresh).toHaveBeenCalledWith('page');
});

it('rejects a delayed verify after the claim changes and returns to the same empty state', async () => {
  const olderReply = mockData;
  const request = pendingPageAction('verify');

  mockData = { ...mockData, verification: null, status: 'unverified' };
  const { rerender } = render(<PageVerificationControl targetId='page' />);

  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Indefinitely' }));
  // A newer verification and its removal leave identical visible state but a
  // different claim version, so comparing only the current record is insufficient.
  mockClaimVersion = Symbol();
  mockData = olderReply;
  rerender(<PageVerificationControl targetId='page' />);
  mockClaimVersion = Symbol();
  mockData = { ...mockData, verification: null, status: 'unverified' };
  rerender(<PageVerificationControl targetId='page' />);
  await act(async () => {
    request.finish(olderReply);
    await request.response;
  });
  expect(mockStore.accept).not.toHaveBeenCalled();
  expect(mockStore.refresh).toHaveBeenCalledWith('page');
});
