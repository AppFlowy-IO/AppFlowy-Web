import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import MainLayout from '@/components/app/MainLayout';
import MobileMainLayout from '@/components/app/MobileMainLayout';

let mockViewId = 'broken-page';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => mockViewId,
  useOpenModalViewId: () => undefined,
  useViewErrorStatus: () => ({ deleted: false, noAccess: false, notFound: false }),
}));
jest.mock('@/components/_shared/outline/outline.hooks', () => ({
  useOutlineDrawer: () => ({ drawerOpened: false, drawerWidth: 240 }),
}));
jest.mock('@/components/ai-chat/AIChatProvider', () => ({ useAIChatContextOptional: () => null }));
jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  INLINE_COMMENT_DRAWER_WIDTH: 320,
  useInlineCommentPanel: () => ({ isPanelOpen: false }),
}));
jest.mock('@/components/inline-comment/InlineCommentSidebar', () => ({ InlineCommentSidebar: () => null }));
jest.mock('@/components/database/row-peek/RowPeekLayout', () => ({
  RowPeekLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/_shared/scroller', () => ({
  AFScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/app/header', () => ({ AppHeader: () => null }));
jest.mock('@/components/app/SideBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/ConnectBanner', () => ({ ConnectBanner: () => null }));
jest.mock('@/components/app/compatibility/ClientCompatibilityBanner', () => ({ ClientCompatibilityBanner: () => null }));
jest.mock('@/components/app/integrations/GoogleCalendarIntegration', () => ({ GoogleCalendarIntegration: () => null }));
jest.mock('@/components/_shared/mobile-topbar/MobileTopBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/error/PageHasBeenDeleted', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/error/RecordNotFound', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/error/SomethingError', () => ({
  __esModule: true,
  default: () => <div role='alert'>Page failed</div>,
}));
jest.mock('@/components/app/Main', () => ({
  __esModule: true,
  default: () => {
    if (mockViewId === 'broken-page') throw new Error('Page render failed');
    return <div>Healthy page</div>;
  },
}));

it.each([
  ['desktop', MainLayout],
  ['mobile', MobileMainLayout],
] as const)('recovers the %s content after navigating away from a failed page', async (_variant, Layout) => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    mockViewId = 'broken-page';
    const { rerender } = render(<Layout />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    mockViewId = 'healthy-page';
    rerender(<Layout />);
    expect(await screen.findByText('Healthy page')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    consoleError.mockRestore();
  }
});
