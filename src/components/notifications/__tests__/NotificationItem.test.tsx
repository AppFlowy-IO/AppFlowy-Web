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
