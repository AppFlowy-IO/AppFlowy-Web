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

it('shows the automation message and opens only links in this workspace without opening the triggering row', async () => {
  const ws='825119c1-c9e1-4bcd-b54c-b31ba43ee9de', view='d2ba21ea-2604-4acf-8feb-5dc766b3b512';
  const link='appflowy-flutter://open-page/'+ws+'/'+view;
  const foreign='appflowy-flutter://open-page/'+view+'/'+ws;
  const markRead=jest.fn(async()=>undefined),close=jest.fn();

  mockToView.mockClear();
  render(<NotificationItem notification={{id:'run',workspaceId:ws,viewId:'source',type:'automation_notification',
    metadata:{automation_name:'Review changes',message:'@Design Review ('+link+') '+foreign,row_id:'row'},
    isRead:false,isArchived:true,createdAt:'2026-11-18T00:00:00Z'}} tab={NotificationTabType.Archived}
    onMarkRead={markRead} onArchive={async()=>undefined} onClose={close}/>);
  expect(screen.getByText('Review changes')).toBeTruthy();
  expect(screen.getByText(/@Design Review/)).toBeTruthy();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  const page=screen.getByRole('link',{name:link});

  expect(page.getAttribute('href')).toBe('/app/'+ws+'/'+view);
  await act(async()=>{fireEvent.click(page);});
  expect(mockToView.mock.calls).toEqual([[view,undefined]]);
  expect(markRead).toHaveBeenCalledWith(['run']);
});

it.each([undefined, 'bec03fe2-a539-43cf-b70b-44167e356507'])(
  'opens the failed automation under its original scope (%s) and marks it read',
  async (row) => {
    mockToView.mockClear();
    const db = 'bcbbf78c-9f95-45a8-b79d-1573a789da37';
    const id = 'bbdd71d4-01db-44d4-adb4-862f8ef55962';
    const read = jest.fn().mockResolvedValue(undefined);

    render(<NotificationItem notification={{ id: 'notice', workspaceId: 'workspace', viewId: 'view',
      type: 'automation_run_failed', metadata: { database_id: db, automation_id: id, scope_row_id: row,
        event_row_id: 'different', failure_code: 'definition_invalid' }, isRead: false, isArchived: false, createdAt: '' }}
      tab={NotificationTabType.Archived} onArchive={async () => undefined} onMarkRead={read} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(mockToView).toHaveBeenCalledWith('view', undefined, new URLSearchParams({
      automationDatabase: db, automationId: id, ...(row && { automationRow: row }),
    }));
    expect(read).toHaveBeenCalledWith(['notice']);
  }
);
