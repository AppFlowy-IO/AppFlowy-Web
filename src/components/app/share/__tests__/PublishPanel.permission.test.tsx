import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import PublishPanel from '@/components/app/share/PublishPanel';

const mockPublish = jest.fn();
const mockLoadPublishInfo = jest.fn();

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
  usePublishing: () => ({ publish: mockPublish, unpublish: jest.fn() }),
}));

jest.mock('@/components/app/share/publish.hooks', () => ({
  useLoadPublishInfo: () => ({
    url: '',
    loadPublishInfo: mockLoadPublishInfo,
    view: {
      view_id: 'view-id',
      name: 'Page',
      icon: null,
      layout: ViewLayout.Document,
      extra: null,
      children: [],
      is_published: false,
      is_private: false,
    },
    publishInfo: undefined,
    publishInfoViewId: undefined,
    loading: false,
    isOwner: false,
    isPublisher: false,
    updatePublishConfig: jest.fn(),
  }),
}));

describe('PublishPanel object permission', () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockResolvedValue(undefined);
    mockLoadPublishInfo.mockReset();
    mockLoadPublishInfo.mockResolvedValue(undefined);
  });

  it('uses can_share as the publish capability', async () => {
    const props = {
      viewId: 'view-id',
      opened: true,
      onClose: jest.fn(),
      shareDetailsLoading: false,
    };
    const { rerender } = render(<PublishPanel {...props} canShare={false} />);
    const publishButton = screen.getByTestId('publish-confirm-button');

    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(publishButton);
    expect(mockPublish).not.toHaveBeenCalled();

    rerender(<PublishPanel {...props} canShare />);
    fireEvent.click(screen.getByTestId('publish-confirm-button'));

    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ view_id: 'view-id' }),
      undefined,
      undefined,
      undefined
    );
  });
});
