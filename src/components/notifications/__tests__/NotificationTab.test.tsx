import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import NotificationTab from '../NotificationTab';
import { NotificationTabType } from '../types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../NotificationEmpty', () => ({
  __esModule: true,
  default: () => <div>notification-empty</div>,
}));

jest.mock('../NotificationItem', () => ({
  __esModule: true,
  default: () => <div>notification-item</div>,
}));

const noopAsync = jest.fn(async () => undefined);

describe('NotificationTab', () => {
  it('shows a loading indicator before the first fetch resolves', () => {
    render(
      <NotificationTab
        items={[]}
        tab={NotificationTabType.Inbox}
        isInitialLoading={true}
        isLoadingMore={false}
        hasMore={false}
        onLoadMore={() => undefined}
        onMarkRead={noopAsync}
        onArchive={noopAsync}
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText('notification-empty')).toBeNull();
  });
});
