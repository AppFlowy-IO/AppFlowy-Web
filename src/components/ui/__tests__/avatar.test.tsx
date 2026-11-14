import { act, render, screen } from '@testing-library/react';

import { Avatar, AvatarImage } from '@/components/ui/avatar';

const mockGetImageUrl = jest.fn<Promise<string>, [string | undefined]>();
const mockRevokeBlobUrl = jest.fn<void, [string]>();

jest.mock('@/utils/authenticated-image', () => ({
  getImageUrl: (url: string | undefined) => mockGetImageUrl(url),
  revokeBlobUrl: (url: string) => mockRevokeBlobUrl(url),
}));

const UPLOADED = 'https://appflowy.io/api/file_storage/w/v1/blob/w/avatar.png';

describe('AvatarImage', () => {
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

  function avatar(src: string) {
    return (
      <Avatar>
        <AvatarImage src={src} alt={'Ada'} />
      </Avatar>
    );
  }

  /** The image Radix draws: jsdom never loads one, so every image counts as loaded here. */
  function shownSrc(): string | null {
    return screen.queryByTestId('avatar-image')?.getAttribute('src') ?? null;
  }

  beforeEach(() => {
    mockGetImageUrl.mockReset();
    mockRevokeBlobUrl.mockReset();
    jest.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    jest.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(24);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the image it fetched, and revokes it when it unmounts', async () => {
    const load = pendingImage();
    const view = render(avatar(UPLOADED));

    await load('blob:avatar');
    expect(shownSrc()).toBe('blob:avatar');

    view.unmount();
    expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:avatar']]);
  });

  it('revokes an image that loads after it unmounts', async () => {
    const load = pendingImage();
    const view = render(avatar(UPLOADED));

    view.unmount();
    await load('blob:late');

    expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:late']]);
  });

  it("keeps the newer source's image when the older one loads after it", async () => {
    const loadOlder = pendingImage();
    const loadNewer = pendingImage();
    const view = render(avatar('https://appflowy.io/api/file_storage/w/v1/blob/w/old.png'));

    view.rerender(avatar('https://appflowy.io/api/file_storage/w/v1/blob/w/new.png'));
    await loadNewer('blob:new');
    await loadOlder('blob:old');

    expect(shownSrc()).toBe('blob:new');
    expect(mockRevokeBlobUrl.mock.calls).toEqual([['blob:old']]);
  });

  it('never revokes a blob URL it was given', async () => {
    const load = pendingImage();
    const view = render(avatar('blob:shared'));

    await load('blob:shared');
    expect(shownSrc()).toBe('blob:shared');

    view.unmount();
    expect(mockRevokeBlobUrl).not.toHaveBeenCalled();
  });
});
