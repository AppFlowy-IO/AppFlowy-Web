import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ErrorType } from '@/application/utils/error-utils';
import MobileMainLayout from '@/components/app/MobileMainLayout';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => 'revoked-view-id',
  useViewErrorStatus: () => ({
    deleted: false,
    noAccess: true,
    notFound: false,
  }),
}));

jest.mock('@/components/_shared/scroller', () => ({
  AFScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/_shared/mobile-topbar/MobileTopBar', () => ({
  __esModule: true,
  default: () => <div data-testid='mobile-topbar' />,
}));

jest.mock('@/components/app/Main', () => ({
  __esModule: true,
  default: () => <div data-testid='main-content' />,
}));

jest.mock('@/components/error/PageHasBeenDeleted', () => ({
  __esModule: true,
  default: () => <div data-testid='deleted-page' />,
}));

jest.mock('@/components/error/RecordNotFound', () => ({
  __esModule: true,
  default: ({ error, viewId }: { error?: { type?: ErrorType }; viewId?: string }) => (
    <div data-testid='record-not-found' data-error-type={error?.type} data-view-id={viewId} />
  ),
}));

jest.mock('@/components/error/SomethingError', () => ({
  __esModule: true,
  default: () => <div data-testid='something-error' />,
}));

describe('MobileMainLayout access state', () => {
  it('replaces cached page content with the forbidden state after access is revoked', async () => {
    render(<MobileMainLayout />);

    await screen.findByTestId('mobile-topbar');

    const error = screen.getByTestId('record-not-found');

    expect(error.getAttribute('data-error-type')).toBe(ErrorType.Forbidden);
    expect(error.getAttribute('data-view-id')).toBe('revoked-view-id');
    expect(screen.queryByTestId('main-content')).toBeNull();
  });
});
