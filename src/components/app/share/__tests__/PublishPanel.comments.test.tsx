import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { clearCachedPublishCommentsEnabled } from '@/application/publish/comment-state';
import { ViewLayout } from '@/application/types';
import PublishPanel from '@/components/app/share/PublishPanel';

const mockPublish = jest.fn();
const mockUnpublish = jest.fn();
const mockLoadPublishInfo = jest.fn();
const mockUpdatePublishConfig = jest.fn();

let mockPublishInfo:
  | {
      namespace: string;
      publishName: string;
      publisherEmail: string;
      commentEnabled: boolean;
      duplicateEnabled: boolean;
    }
  | undefined;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  usePublishing: () => ({ publish: mockPublish, unpublish: mockUnpublish }),
}));

jest.mock('@/components/app/share/publish.hooks', () => ({
  useLoadPublishInfo: () => ({
    url: 'https://appflowy.test/namespace/page',
    loadPublishInfo: mockLoadPublishInfo,
    view: {
      view_id: 'view-id',
      name: 'Page',
      icon: null,
      layout: ViewLayout.Document,
      extra: null,
      children: [],
      is_published: Boolean(mockPublishInfo),
      is_private: false,
    },
    publishInfo: mockPublishInfo,
    publishInfoViewId: 'view-id',
    loading: false,
    isOwner: true,
    isPublisher: true,
    updatePublishConfig: mockUpdatePublishConfig,
  }),
}));

function renderPanel() {
  return render(<PublishPanel viewId='view-id' opened onClose={jest.fn()} canShare shareDetailsLoading={false} />);
}

describe('PublishPanel comments setting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCachedPublishCommentsEnabled('view-id');
    clearCachedPublishCommentsEnabled('other-view-id');
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockPublish.mockResolvedValue(undefined);
    mockUnpublish.mockResolvedValue(undefined);
    mockLoadPublishInfo.mockResolvedValue(undefined);
    mockUpdatePublishConfig.mockResolvedValue(true);
    mockPublishInfo = undefined;
  });

  it('leaves an unknown first-publish setting to the backend default', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        undefined,
        undefined,
        undefined
      );
    });
  });

  it.each([true, false])('keeps comments set to %s when republishing', async (commentEnabled) => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled,
      duplicateEnabled: true,
    };
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('publish-comments-switch').checked).toBe(commentEnabled);
    });

    fireEvent.click(screen.getByTestId('unpublish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirm-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        'page',
        undefined,
        commentEnabled
      );
    });
  });

  it('keeps comments enabled when the panel remounts before republishing', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: false,
      duplicateEnabled: true,
    };
    const firstRender = renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));
    fireEvent.click(screen.getByTestId('publish-comments-switch'));
    await waitFor(() => {
      expect(mockUpdatePublishConfig).toHaveBeenCalledWith({
        view_id: 'view-id',
        comments_enabled: true,
      });
    });

    fireEvent.click(screen.getByTestId('unpublish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirm-button')).toBeTruthy());
    firstRender.unmount();
    window.sessionStorage.clear();

    mockPublishInfo = undefined;
    renderPanel();
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        undefined,
        undefined,
        true
      );
    });
  });

  it('keeps comments disabled when the panel remounts before republishing', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: true,
      duplicateEnabled: true,
    };
    const firstRender = renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(true));
    fireEvent.click(screen.getByTestId('publish-comments-switch'));
    await waitFor(() => {
      expect(mockUpdatePublishConfig).toHaveBeenCalledWith({
        view_id: 'view-id',
        comments_enabled: false,
      });
    });

    fireEvent.click(screen.getByTestId('unpublish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirm-button')).toBeTruthy());
    firstRender.unmount();
    window.sessionStorage.clear();

    mockPublishInfo = undefined;
    renderPanel();
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        undefined,
        undefined,
        false
      );
    });
  });

  it('does not overwrite backend state when republishing without a browser cache', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: true,
      duplicateEnabled: true,
    };
    const firstRender = renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(true));
    fireEvent.click(screen.getByTestId('unpublish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirm-button')).toBeTruthy());
    firstRender.unmount();

    // A different browser has no local cache and must let the backend restore
    // the durable per-page value instead of sending a guessed false value.
    clearCachedPublishCommentsEnabled('view-id');
    mockPublishInfo = undefined;
    renderPanel();
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        undefined,
        undefined,
        undefined
      );
    });
  });

  it('updates an open panel when another tab changes the same page setting', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: false,
      duplicateEnabled: true,
    };
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));

    act(() => {
      const key = 'appflowy:publish-comments:v2:view-id';

      window.localStorage.setItem(key, '1');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue: '0',
          newValue: '1',
          storageArea: window.localStorage,
        })
      );
    });

    expect(screen.getByTestId('publish-comments-switch').checked).toBe(true);

    act(() => {
      const key = 'appflowy:publish-comments:v2:other-view-id';

      window.localStorage.setItem(key, '0');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue: '1',
          newValue: '0',
          storageArea: window.localStorage,
        })
      );
    });

    expect(screen.getByTestId('publish-comments-switch').checked).toBe(true);
  });

  it('uses a change received from another tab after the panel is reopened', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: false,
      duplicateEnabled: true,
    };
    const firstRender = renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));
    firstRender.unmount();

    act(() => {
      const key = 'appflowy:publish-comments:v2:view-id';

      window.localStorage.setItem(key, '1');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue: '0',
          newValue: '1',
          storageArea: window.localStorage,
        })
      );
    });

    mockPublishInfo = undefined;
    renderPanel();
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ view_id: 'view-id' }),
        undefined,
        undefined,
        true
      );
    });
  });

  it('rolls the toggle back when the server rejects the update', async () => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: false,
      duplicateEnabled: true,
    };
    mockUpdatePublishConfig.mockResolvedValueOnce(false);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));
    fireEvent.click(screen.getByTestId('publish-comments-switch'));
    expect(screen.getByTestId('publish-comments-switch').checked).toBe(true);

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));
  });
});
