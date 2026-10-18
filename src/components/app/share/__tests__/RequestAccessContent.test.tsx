import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { RequestAccessContent } from '../RequestAccessContent';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => 'page',
  useCurrentWorkspaceId: () => 'workspace',
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'sam@demo.test' }) }));
jest.mock('@/application/services/domains', () => ({ AccessService: { sendRequestAccess: jest.fn() } }));

test('balances the lines of the no-access message, so no word is left alone on the last line', () => {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RequestAccessContent viewId='page' workspaceId='workspace' />
    </MemoryRouter>
  );

  expect(screen.getByText('landingPage.noAccess.title')).toBeTruthy();
  expect(screen.getByText('landingPage.noAccess.description').className.split(/\s+/)).toContain('text-balance');
});
