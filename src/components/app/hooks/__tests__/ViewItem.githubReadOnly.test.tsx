import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { AccessLevel, CollabObjectPermission, Types, View, ViewIconType, ViewLayout } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import ViewItem from '@/components/app/outline/ViewItem';

const updatePage = jest.fn();
const uploadFile = jest.fn();
const sourceProbe = jest.fn();
let sourceReadOnly = true;
let canonicalCanWrite = true;
let iconProps: React.ComponentProps<typeof CustomIconPopover>;

const permission = {
  object_id: 'github-page',
  governing_view_id: 'github-page',
  collab_type: Types.Document,
  access_level: AccessLevel.FullAccess,
  can_read: true,
  can_write: true,
  can_comment: true,
  can_share: true,
} as CollabObjectPermission;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ AccessService: {}, ViewService: {} }));
jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useSidebarSelectedViewId: () => undefined,
  useSidebarHighlightedViewIds: () => [],
  useCurrentWorkspaceId: () => 'workspace',
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useAppOperations: () => ({ updatePage, uploadFile }),
}));
jest.mock('@/components/app/hooks/useViewObjectPermission', () => ({
  useViewObjectPermission: () => {
    permission.can_write = canonicalCanWrite;
    return permission;
  },
}));
jest.mock('@/components/app/github-sync/useGithubPageSource', () => ({
  useGithubPageSource: (_workspaceId: string, _viewId: string, enabled: boolean) => {
    sourceProbe(enabled);
    return { readOnly: enabled && sourceReadOnly, managed: false };
  },
}));
jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({ dragState: { type: 'idle' }, shouldSuppressClick: () => false }),
}));
jest.mock('@/components/app/outline/reorder/useReorderableSidebarList', () => ({
  useReorderableSidebarList: () => ({ orderedItems: [] }),
}));
jest.mock('@/components/_shared/outline/OutlineIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: (props: React.ComponentProps<typeof CustomIconPopover>) => {
    iconProps = props;
    return (
      <>
        {props.children}
        {props.enable && props.open && <div data-testid='icon-picker' />}
      </>
    );
  },
}));

const view = {
  view_id: 'github-page',
  name: 'Documentation',
  layout: ViewLayout.Document,
  extra: {},
  children: [],
  has_children: false,
} as View;

function SidebarItem() {
  return <ViewItem view={view} width={240} expandIds={[]} toggleExpand={jest.fn()} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  sourceReadOnly = true;
  canonicalCanWrite = true;
  uploadFile.mockResolvedValue('https://example.com/icon.png');
});

test('does not request source ownership until the sidebar icon is clicked', () => {
  render(<SidebarItem />);
  expect(sourceProbe).toHaveBeenCalledWith(false);
  expect(sourceProbe).not.toHaveBeenCalledWith(true);

  fireEvent.click(screen.getByTestId('page-icon'));
  expect(sourceProbe).toHaveBeenCalledWith(true);
  expect(screen.queryByTestId('icon-picker')).toBeNull();
});

test('blocks icon selection, removal and uploads while source ownership denies writes', async () => {
  render(<SidebarItem />);
  fireEvent.click(screen.getByTestId('page-icon'));
  expect(screen.queryByTestId('icon-picker')).toBeNull();

  await act(async () => {
    iconProps.onSelectIcon?.({ ty: ViewIconType.Emoji, value: '📚' });
    iconProps.removeIcon?.();
    await expect(iconProps.onUploadFile?.(new File(['icon'], 'icon.png'))).rejects.toThrow('Page is read-only');
  });
  expect(updatePage).not.toHaveBeenCalled();
  expect(uploadFile).not.toHaveBeenCalled();
});

test('waits for source ownership to resolve before opening the icon picker for a manual page', async () => {
  const result = render(<SidebarItem />);

  fireEvent.click(screen.getByTestId('page-icon'));
  expect(screen.queryByTestId('icon-picker')).toBeNull();

  sourceReadOnly = false;
  result.rerender(<SidebarItem />);
  await waitFor(() => expect(screen.queryByTestId('icon-picker')).not.toBeNull());

  await act(async () => {
    iconProps.onSelectIcon?.({ ty: ViewIconType.Emoji, value: '📚' });
  });
  expect(updatePage).toHaveBeenCalledWith('github-page', {
    icon: { ty: ViewIconType.Emoji, value: '📚' },
    name: 'Documentation',
    extra: {},
  });
  expect(screen.queryByTestId('icon-picker')).toBeNull();
});

test('allows icon uploads and removal on writable manual pages', async () => {
  sourceReadOnly = false;
  render(<SidebarItem />);
  fireEvent.click(screen.getByTestId('page-icon'));
  await waitFor(() => expect(screen.queryByTestId('icon-picker')).not.toBeNull());

  const file = new File(['icon'], 'icon.png');

  await act(async () => {
    await expect(iconProps.onUploadFile?.(file)).resolves.toBe('https://example.com/icon.png');
    iconProps.removeIcon?.();
  });
  expect(uploadFile).toHaveBeenCalledWith('github-page', file);
  expect(updatePage).toHaveBeenCalledWith('github-page', {
    icon: { ty: 0, value: '' },
    name: 'Documentation',
    extra: {},
  });
});

test('does not open the icon picker when canonical permission denies edits on a manual page', () => {
  sourceReadOnly = false;
  canonicalCanWrite = false;
  render(<SidebarItem />);
  fireEvent.click(screen.getByTestId('page-icon'));
  expect(screen.queryByTestId('icon-picker')).toBeNull();
});

test('closes the picker when source ownership becomes read-only while it is open', async () => {
  sourceReadOnly = false;
  const result = render(<SidebarItem />);

  fireEvent.click(screen.getByTestId('page-icon'));
  await waitFor(() => expect(screen.queryByTestId('icon-picker')).not.toBeNull());

  const pendingUploadCallbacks = iconProps;

  sourceReadOnly = true;
  result.rerender(<SidebarItem />);
  expect(screen.queryByTestId('icon-picker')).toBeNull();

  await act(async () => {
    pendingUploadCallbacks.onSelectIcon?.({ ty: ViewIconType.Emoji, value: '📚' });
    pendingUploadCallbacks.removeIcon?.();
    await expect(pendingUploadCallbacks.onUploadFile?.(new File(['icon'], 'icon.png'))).rejects.toThrow('Page is read-only');
  });
  expect(updatePage).not.toHaveBeenCalled();
  expect(uploadFile).not.toHaveBeenCalled();
});
