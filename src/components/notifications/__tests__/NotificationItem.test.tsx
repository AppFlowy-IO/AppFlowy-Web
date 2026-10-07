import { act, fireEvent, render, screen } from '@testing-library/react';

import NotificationItem from '../NotificationItem';
import { NotificationTabType } from '../types';

const mockToView = jest.fn(async () => undefined);

jest.mock('@/components/app/app.hooks', () => ({ useToView: () => mockToView }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it.each([
  [{ row_id: 'row', block_id: 'block' }, 'row'],
  [{ row_id: '', block_id: 'block' }, 'block'],
  [{ row_id: 123, block_id: 'block' }, 'block'],
  [{ row_id: 'row' }, 'row'],
  [{}, undefined],
])('opens the saved mention target from %j', async (metadata, anchor) => {
  mockToView.mockClear();
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();

  render(
    <NotificationItem
      notification={{
        id: 'notification', workspaceId: 'workspace', viewId: 'database-view',
        type: 'mention', metadata: metadata as Record<string, unknown>,
        isRead: false, isArchived: true, createdAt: '2026-10-01T00:00:00Z',
      }}
      tab={NotificationTabType.Archived}
      onMarkRead={markRead}
      onArchive={async () => undefined}
      onClose={close}
    />
  );
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(mockToView).toHaveBeenCalledWith('database-view', anchor);
  expect(markRead).toHaveBeenCalledWith(['notification']);
  expect(close).toHaveBeenCalledTimes(1);
});
