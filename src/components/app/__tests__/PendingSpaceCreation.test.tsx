import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';

import { SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import { SpaceVisibility } from '@/application/types';
import { PendingSpaceCreation } from '@/components/app/PendingSpaceCreation';

let mockWorkspace = 'workspace-a';
let mockActor = 'actor-a';
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockActor } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server-a' }));
jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => mockClient }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockWorkspace,
  useEnsureViewVisibleInOutline: () => jest.fn(),
  useOpenPageModal: () => jest.fn(),
}));
jest.mock('@/components/app/view-actions/CreateSpaceModal', () => ({
  __esModule: true, default: () => <div data-testid='resume-dialog' />,
}));
jest.mock('@/components/ui/button', () => ({ Button: ({ children, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => <button {...props}>{children}</button> }));

beforeEach(() => { sessionStorage.clear(); mockWorkspace = 'workspace-a'; mockActor = 'actor-a'; });

test('Resume is reachable without an outline or creation capability and cannot follow an account/workspace switch', async () => {
  new SpaceCreationIntentStore('workspace-a').begin({
    payload: { name: 'Submitted', view_id: 'space-a', permission: { visibility: SpaceVisibility.Custom } as never },
    members: [], selectedMembers: [], appliedMemberUids: [],
  });
  const app = render(<PendingSpaceCreation />);

  fireEvent.click(screen.getByTestId('resume-space-creation'));
  expect(await screen.findByTestId('resume-dialog')).toBeTruthy();
  mockActor = 'actor-b';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.queryByTestId('resume-space-creation')).toBeNull();
  expect(screen.queryByTestId('resume-dialog')).toBeNull();
  mockActor = 'actor-a'; mockWorkspace = 'workspace-b';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.queryByTestId('resume-space-creation')).toBeNull();
  mockWorkspace = 'workspace-a';
  app.rerender(<PendingSpaceCreation />);
  expect(screen.getByTestId('resume-space-creation')).toBeTruthy();
});
