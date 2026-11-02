import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { clearDisplaySizeImageCache } from '@/utils/display-size-image-cache';

import DocumentImage from '../DocumentImage';

import type { SourceBlock } from '../types';

jest.mock('@/application/session/token', () => ({
  getTokenParsed: () => ({ access_token: 'test-access-token', user: { id: 'user' } }),
}));
jest.mock('@/utils/media-disk-cache', () => ({ mediaCacheKeys: () => null }));
jest.mock('@/utils/display-size-image-resize', () => ({
  resizeImageBlob: async (blob: Blob) => ({ blob, resized: false }),
}));

const fetchImage = jest.fn();
const originalFetch = global.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const block = (url: string): SourceBlock => ({ id: 'image', type: 'image', url, text: 'Source photograph', children: [] });

beforeEach(() => {
  global.fetch = fetchImage;
  fetchImage.mockReset().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['png'], { type: 'image/png' }) });
  URL.createObjectURL = jest.fn(() => 'blob:authenticated-image');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  clearDisplaySizeImageCache();
  global.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

test.each([
  'https://test.appflowy.cloud/api/file_storage/workspace/v1/blob/page/image',
  '/api/file_storage/workspace/v1/blob/page/image',
])('shares an authenticated original for slide and ruler copies of %s', async (url) => {
  const image = block(url);

  render(<>
    <DocumentImage block={image} onSource={jest.fn()} />
    <DocumentImage block={image} onSource={jest.fn()} />
  </>);
  // Protected URLs never reach an anonymous <img> request while the bearer fetch is pending.
  expect(screen.getAllByAltText('Source photograph').every((element) => !element.hasAttribute('src'))).toBe(true);
  await waitFor(() => expect(screen.getAllByAltText('Source photograph').every(
    (element) => element.getAttribute('src') === 'blob:authenticated-image'
  )).toBe(true));
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(fetchImage).toHaveBeenCalledWith(
    'https://test.appflowy.cloud/api/file_storage/workspace/v1/blob/page/image',
    { headers: { Authorization: 'Bearer test-access-token', 'x-platform': 'web-app' } }
  );
});

test.each(['https://example.com/photo.png', 'blob:editor-owned-image'])('keeps borrowed image %s without revoking it', (url) => {
  const view = render(<DocumentImage block={block(url)} onSource={jest.fn()} />);

  expect(screen.getByAltText('Source photograph').getAttribute('src')).toBe(url);
  view.unmount();
  expect(fetchImage).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

test('unsupported image locations retain source navigation without fetching them', () => {
  const source = jest.fn();

  render(<DocumentImage block={block('javascript:alert(1)')} onSource={source} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open image in source' }));
  expect(source).toHaveBeenCalledWith('image');
  expect(screen.queryByRole('img')).toBeNull();
  expect(fetchImage).not.toHaveBeenCalled();
});
