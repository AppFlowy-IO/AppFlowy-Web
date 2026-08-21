import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import ShareButton from '@/components/app/share/ShareButton';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => ({}),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open }: { open: boolean }) => (open ? <div data-testid='publish-manage-modal' /> : null),
}));

jest.mock('@/components/app/publish-manage', () => ({
  PublishManage: () => null,
}));

jest.mock('@/components/app/share/ShareTabs', () => ({
  __esModule: true,
  default: ({ onOpenPublishManage }: { onOpenPublishManage?: () => void }) => (
    <button data-testid='open-publish-manage' onClick={onOpenPublishManage}>
      Open publish management
    </button>
  ),
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('ShareButton publish availability', () => {
  it('hides open publish management when navigating to a row page', () => {
    const { rerender } = render(<ShareButton viewId='database-view' />);

    fireEvent.click(screen.getByTestId('open-publish-manage'));
    expect(screen.getByTestId('publish-manage-modal')).toBeTruthy();

    rerender(<ShareButton viewId='database-view' hidePublish />);

    expect(screen.queryByTestId('publish-manage-modal')).toBeNull();
  });
});
