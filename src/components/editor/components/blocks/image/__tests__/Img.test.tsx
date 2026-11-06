import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { checkImage, CheckImageResult } from '@/utils/image';

import Img from '../Img';

jest.mock('@/utils/image', () => ({ checkImage: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));
jest.mock('@/utils/file-storage-url', () => ({ isAppFlowyFileStorageUrl: () => false }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const mockCheck = jest.mocked(checkImage);
const success = (validatedUrl: string): CheckImageResult => ({ ok: true, status: 200, statusText: 'OK', validatedUrl });

beforeEach(() => jest.clearAllMocks());

it('does not request an empty source while a duplicated image is being resolved', async () => {
  let resolve!: (result: CheckImageResult) => void;

  mockCheck.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(<Img url='https://example.com/photo.png' width='100%' />);
  expect(screen.getByRole('img', { hidden: true }).hasAttribute('src')).toBe(false);

  await act(async () => resolve(success('https://example.com/photo.png')));
  fireEvent.load(screen.getByRole('img', { hidden: true }));
  expect(screen.getByRole('img', { hidden: true }).style.visibility).toBe('visible');
  expect(screen.queryByRole('button', { name: 'editor.imageLoadFailedRetry' })).toBeNull();
});

it('does not apply a late error from the previous source to its replacement', async () => {
  mockCheck.mockImplementation(async (url) => success(url));
  const { rerender } = render(<Img url='https://example.com/first.png' width='100%' />);

  await waitFor(() =>
    expect(screen.getByRole('img', { hidden: true }).getAttribute('src')).toBe('https://example.com/first.png')
  );
  const previous = screen.getByRole('img', { hidden: true });

  fireEvent.load(previous);
  rerender(<Img url='https://example.com/second.png' width='100%' />);
  await waitFor(() =>
    expect(screen.getByRole('img', { hidden: true }).getAttribute('src')).toBe('https://example.com/second.png')
  );
  fireEvent.load(screen.getByRole('img', { hidden: true }));
  fireEvent.error(previous);
  expect(screen.getByRole('img', { hidden: true }).style.visibility).toBe('visible');
  expect(screen.queryByRole('button', { name: 'editor.imageLoadFailedRetry' })).toBeNull();
});
