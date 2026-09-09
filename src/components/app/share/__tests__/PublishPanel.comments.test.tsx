import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PublishConfig, ViewLayout } from '@/application/types';
import PublishPanel from '@/components/app/share/PublishPanel';

const mockPublish = jest.fn();
const mockUnpublish = jest.fn();
const mockLoadPublishInfo = jest.fn();
const mockUpdatePublishConfig = jest.fn();
let mockPublishInfoViewId = 'view-id';
let mockPublishConfig: PublishConfig | undefined;

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
      view_id: mockPublishInfoViewId,
      name: 'Page',
      icon: null,
      layout: ViewLayout.Document,
      extra: null,
      children: [],
      is_published: Boolean(mockPublishInfo),
      is_private: false,
    },
    publishInfo: mockPublishInfo,
    publishConfig: mockPublishConfig,
    publishInfoViewId: mockPublishInfoViewId,
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
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockPublish.mockResolvedValue(undefined);
    mockUnpublish.mockResolvedValue(undefined);
    mockLoadPublishInfo.mockResolvedValue(undefined);
    mockUpdatePublishConfig.mockImplementation(async (patch: Partial<PublishConfig>) => {
      mockPublishConfig = {
        comments_enabled: mockPublishInfo?.commentEnabled ?? false,
        duplicate_enabled: mockPublishInfo?.duplicateEnabled ?? true,
        ...mockPublishConfig,
        ...patch,
      };
      return true;
    });
    mockPublishInfo = undefined;
    mockPublishConfig = undefined;
    mockPublishInfoViewId = 'view-id';
  });

  it('leaves an unknown first-publish setting to the backend default', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), undefined);
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
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), 'page');
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
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), undefined);
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
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), undefined);
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
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockPublishInfo = undefined;
    renderPanel();
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), undefined);
    });
  });

  it.each(['focus', 'visibilitychange'])('refreshes on %s and waits for the server value', async (event) => {
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: false,
      duplicateEnabled: true,
    };
    const { rerender } = renderPanel();

    await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(false));
    const loadsBeforeFocus = mockLoadPublishInfo.mock.calls.length;

    act(() => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });

    expect(mockLoadPublishInfo.mock.calls.length).toBeGreaterThan(loadsBeforeFocus);
    expect(screen.getByTestId('publish-comments-switch').checked).toBe(false);

    mockPublishConfig = { comments_enabled: true, duplicate_enabled: true };
    rerender(<PublishPanel viewId='view-id' opened onClose={jest.fn()} canShare />);
    expect(screen.getByTestId('publish-comments-switch').checked).toBe(true);

    rerender(<PublishPanel viewId='view-id' opened={false} onClose={jest.fn()} canShare />);
    const loadsAfterClose = mockLoadPublishInfo.mock.calls.length;

    act(() => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });

    expect(mockLoadPublishInfo).toHaveBeenCalledTimes(loadsAfterClose);
  });

  it('uses authenticated config over stale browser and public-info values', async () => {
    window.localStorage.setItem('appflowy:publish-comments:v2:view-id', '1');
    window.sessionStorage.setItem('appflowy:publish-comments:v1:view-id', '1');
    mockPublishInfo = {
      namespace: 'namespace',
      publishName: 'page',
      publisherEmail: 'owner@appflowy.test',
      commentEnabled: true,
      duplicateEnabled: true,
    };
    mockPublishConfig = { comments_enabled: false, duplicate_enabled: false };
    renderPanel();

    expect(screen.getByTestId('publish-comments-switch').checked).toBe(false);
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('unpublish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirm-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('publish-confirm-button'));
    await waitFor(() =>
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), 'page')
    );
  });

  it('omits browser-cached settings when republishing after reopening', async () => {
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
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'view-id' }), undefined);
    });
  });

  it.each(['comments', 'duplication'])(
    'rolls the %s toggle back when the server rejects the update',
    async (setting) => {
      mockPublishInfo = {
        namespace: 'namespace',
        publishName: 'page',
        publisherEmail: 'owner@appflowy.test',
        commentEnabled: false,
        duplicateEnabled: true,
      };
      mockUpdatePublishConfig.mockResolvedValueOnce(false);
      renderPanel();
      const getSwitch = () => screen.getAllByRole('checkbox')[setting === 'comments' ? 0 : 1] as HTMLInputElement;
      const initial = setting === 'duplication';

      await waitFor(() => expect(getSwitch().checked).toBe(initial));
      fireEvent.click(getSwitch());
      expect(getSwitch().checked).toBe(!initial);
      expect(getSwitch().disabled).toBe(true);

      await waitFor(() => expect(getSwitch().checked).toBe(initial));
      expect(getSwitch().disabled).toBe(false);
    }
  );

  it.each(['board-view', 'database-container'])(
    'updates comments under the resolved database publication %s',
    async (publishedViewId) => {
      mockPublishInfoViewId = publishedViewId;
      mockPublishInfo = {
        namespace: 'namespace',
        publishName: 'database',
        publisherEmail: 'owner@appflowy.test',
        commentEnabled: true,
        duplicateEnabled: true,
      };
      render(
        <PublishPanel viewId='board-view' fallbackViewId='database-container' opened onClose={jest.fn()} canShare />
      );

      await waitFor(() => expect(screen.getByTestId('publish-comments-switch').checked).toBe(true));

      fireEvent.click(screen.getByTestId('publish-comments-switch'));

      await waitFor(() => {
        expect(mockUpdatePublishConfig).toHaveBeenCalledWith({
          view_id: publishedViewId,
          comments_enabled: false,
        });

        expect(screen.getByTestId('publish-comments-switch').checked).toBe(false);
        expect(screen.getByTestId('publish-comments-switch').disabled).toBe(false);
      });
    }
  );
});
