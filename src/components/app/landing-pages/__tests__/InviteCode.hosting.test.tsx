import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ERROR_CODE } from '@/application/constants';
import { AuthService, WorkspaceService } from '@/application/services/domains';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import type LandingPage from '@/components/_shared/landing-page/LandingPage';
import { defaultConfig } from '@/components/main/app.hooks';
import { SERVER_INFO_LOADING, updateServerInfo } from '@/utils/server-info';

import InviteCode from '../InviteCode';

import type { ComponentProps } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { workspaceName?: string }) =>
      options?.workspaceName ? `${key}: ${options.workspaceName}` : key,
  }),
  Trans: () => null,
}));
jest.mock('@/application/services/domains', () => ({
  AuthService: { getServerInfo: jest.fn() },
  WorkspaceService: {
    getInfoByInvitationCode: jest.fn(),
    joinByInvitationCode: jest.fn(),
  },
}));
jest.mock('@/components/main/app.hooks', () => ({
  defaultConfig: { baseURL: 'https://test.appflowy.cloud' },
}));
jest.mock('@/components/_shared/landing-page/LandingPage', () => ({
  __esModule: true,
  default: ({ title, description, primaryAction }: ComponentProps<typeof LandingPage>) => (
    <div>
      {title}
      {description}
      {primaryAction && <button onClick={primaryAction.onClick}>{primaryAction.label}</button>}
    </div>
  ),
}));

describe('InviteCode hosting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateServerInfo(defaultConfig.baseURL, SERVER_INFO_LOADING);
    jest.mocked(WorkspaceService.getInfoByInvitationCode).mockResolvedValue({
      workspace_id: 'workspace-1',
      workspace_name: 'Test workspace',
      workspace_icon_url: '',
      member_count: 2,
      is_member: false,
    });
    jest.mocked(WorkspaceService.joinByInvitationCode).mockRejectedValue({
      code: ERROR_CODE.WORKSPACE_MEMBER_LIMIT_EXCEEDED,
    });
  });

  it.each([
    [false, 'landingPage.inviteCode.memberLimitDescription: Test workspace'],
    [true, 'landingPage.error.administratorLimitDescription'],
  ])('loads standalone invitation guidance with self_hosted=%s', async (selfHosted, expectedDescription) => {
    let resolveServerInfo!: (info: ServerInfo) => void;

    jest.mocked(AuthService.getServerInfo).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveServerInfo = resolve;
      })
    );
    render(
      <MemoryRouter
        initialEntries={['/app/invited/code-1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path='/app/invited/:code' element={<InviteCode />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'landingPage.inviteCode.joinWorkspace' }));
    await screen.findByText('landingPage.inviteCode.memberLimitTitle');

    // A quota error can arrive before server info on a fresh visit.
    await act(async () => {
      resolveServerInfo({ enable_page_history: true, self_hosted: selfHosted });
    });

    expect(screen.getByText(expectedDescription)).toBeTruthy();
    expect(WorkspaceService.joinByInvitationCode).toHaveBeenCalledWith('code-1');
    expect(AuthService.getServerInfo).toHaveBeenCalledTimes(1);
  });
});
