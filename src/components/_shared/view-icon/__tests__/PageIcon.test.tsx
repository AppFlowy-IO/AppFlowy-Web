import { act, render, screen } from '@testing-library/react';

import { ViewIconType, ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';

const mockGetImageUrl = jest.fn<Promise<string>, [string | undefined]>();
const mockRevokeBlobUrl = jest.fn<void, [string]>();

jest.mock('@/utils/authenticated-image', () => ({
  getImageUrl: (url: string | undefined) => mockGetImageUrl(url),
  revokeBlobUrl: (url: string) => mockRevokeBlobUrl(url),
}));

jest.mock('@/assets/icons/list.svg', () => ({
  ReactComponent: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='list-view-icon' {...props} />,
}));

jest.mock('@/assets/icons/gallery.svg', () => ({
  ReactComponent: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='gallery-view-icon' {...props} />,
}));

jest.mock('@/assets/icons/feed.svg', () => ({
  ReactComponent: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='feed-view-icon' {...props} />,
}));

jest.mock('@/assets/icons/dashboard.svg', () => ({
  ReactComponent: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='dashboard-view-icon' {...props} />,
}));

describe('PageIcon', () => {
  it('renders the List layout icon', () => {
    render(<PageIcon view={{ layout: ViewLayout.List }} />);

    expect(screen.getByTestId('list-view-icon')).toBeTruthy();
  });

  it('renders the Gallery layout icon', () => {
    render(<PageIcon view={{ layout: ViewLayout.Gallery }} />);

    expect(screen.getByTestId('gallery-view-icon')).toBeTruthy();
  });

  it('renders the Feed layout icon', () => {
    render(<PageIcon view={{ layout: ViewLayout.Feed }} />);

    expect(screen.getByTestId('feed-view-icon')).toBeTruthy();
  });

  it('renders the Dashboard layout icon', () => {
    render(<PageIcon view={{ layout: ViewLayout.Dashboard }} />);

    expect(screen.getByTestId('dashboard-view-icon')).toBeTruthy();
  });

  describe('an uploaded icon', () => {
    /** A `getImageUrl` answer the test gives when it chooses. */
    function pendingImage() {
      let resolve: (url: string) => void = () => undefined;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });

      mockGetImageUrl.mockReturnValueOnce(promise);
      return async (url: string) => {
        await act(async () => {
          resolve(url);
          await promise;
        });
      };
    }

    function uploaded(value: string) {
      return { layout: ViewLayout.Document, icon: { ty: ViewIconType.URL, value } };
    }

    beforeEach(() => {
      mockGetImageUrl.mockReset();
      mockRevokeBlobUrl.mockReset();
    });

    it('shows the image it fetched, and revokes it when it unmounts', async () => {
      const load = pendingImage();
      const view = render(<PageIcon view={uploaded('https://appflowy.io/api/file_storage/w/v/icon.png')} />);

      await load('blob:icon');
      expect(screen.getByTestId('page-icon-image').getAttribute('src')).toBe('blob:icon');

      view.unmount();
      expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:icon']]);
    });

    it('revokes an image that loads after it unmounts', async () => {
      const load = pendingImage();
      const view = render(<PageIcon view={uploaded('https://appflowy.io/api/file_storage/w/v/icon.png')} />);

      view.unmount();
      await load('blob:late');

      expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:late']]);
    });

    it("keeps the newer icon's image when the older one loads after it", async () => {
      const loadOlder = pendingImage();
      const loadNewer = pendingImage();
      const view = render(<PageIcon view={uploaded('https://appflowy.io/api/file_storage/w/v/old.png')} />);

      view.rerender(<PageIcon view={uploaded('https://appflowy.io/api/file_storage/w/v/new.png')} />);
      await loadNewer('blob:new');
      await loadOlder('blob:old');

      expect(screen.getByTestId('page-icon-image').getAttribute('src')).toBe('blob:new');
      expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:old']]);
    });

    it('never revokes a blob URL the icon names itself', async () => {
      const load = pendingImage();
      const view = render(<PageIcon view={uploaded('blob:preview')} />);

      await load('blob:preview');
      expect(screen.getByTestId('page-icon-image').getAttribute('src')).toBe('blob:preview');

      view.unmount();
      expect(mockRevokeBlobUrl).not.toHaveBeenCalled();
    });
  });
});
