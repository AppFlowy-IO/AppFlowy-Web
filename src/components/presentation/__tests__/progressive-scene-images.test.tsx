import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { getArtifactAsset, getArtifactScene } from '../presentation-client';
import ServerSlideCanvas, { ServerSlideSceneProvider } from '../ServerSlideCanvas';

import type { DeckScene, SceneElement, SceneSlide } from '../server-scene';
import type { SavedDeck } from '../types';

jest.mock('../presentation-client', () => ({ getArtifactScene: jest.fn(), getArtifactAsset: jest.fn() }));

const scope = { workspaceId: 'workspace', pageId: 'page' };
const bounds = { x: 128, y: 72, width: 640, height: 144 };
const text = (id: string, value: string): SceneElement => ({
  id,
  kind: 'text',
  bounds,
  text: value,
  font: 'Arial',
  size: 32,
  bold: false,
  color: '112233',
});
const image = (id: string, assetId: string, attribution: string): SceneElement => ({
  id,
  kind: 'image',
  bounds,
  asset_id: assetId,
  revision: 'rev-1',
  attribution,
});
const slide = (id: string, elements: SceneElement[]): SceneSlide => ({
  id,
  layout: 'summary',
  background: 'FFFFFF',
  elements,
  notes: '',
  sourceIds: [],
  warnings: [],
});

function sceneWith(slides: SceneSlide[]): DeckScene {
  return {
    schemaVersion: 1,
    width: 1280,
    height: 720,
    title: 'Scene',
    style: { id: 'style', version: 1 },
    theme: {
      id: 'paper',
      name: 'Paper',
      description: '',
      color: '#112233',
      background: '#FFFFFF',
      textColor: '#000000',
      font: 'Arial',
      bodyFont: 'Arial',
      footer: '',
      palette: [],
      guidelines: '',
    },
    warnings: [],
    slides,
  };
}

const scene = sceneWith([
  slide('text-only', [text('heading', 'Text slide')]),
  slide('pictures', [
    text('caption', 'Image slide'),
    image('first', 'asset-a', 'First image'),
    image('second', 'asset-b', 'Second image'),
  ]),
]);
const png = () => new Blob(['image'], { type: 'image/png' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
}

function Preview({ version = 3 }: { version?: number }) {
  return (
    <ServerSlideSceneProvider scope={scope} deck={{ id: 'deck', version } as SavedDeck}>
      <ServerSlideCanvas index={0} />
      <ServerSlideCanvas index={1} miniature />
    </ServerSlideSceneProvider>
  );
}

const assetCalls = () => jest.mocked(getArtifactAsset).mock.calls;

beforeEach(() => {
  let urls = 0;

  jest.mocked(getArtifactScene).mockReset().mockResolvedValue(scene);
  jest.mocked(getArtifactAsset).mockReset();
  URL.createObjectURL = jest.fn(() => `blob:${++urls}`);
  URL.revokeObjectURL = jest.fn();
});

test('shows every slide once the scene arrives and each image as soon as it finishes', async () => {
  const first = deferred<Blob>();
  const second = deferred<Blob>();

  jest
    .mocked(getArtifactAsset)
    .mockImplementation((...args) => (args[3] === 'asset-a' ? first.promise : second.promise));
  render(<Preview />);

  // A text-only slide does not wait for another slide's images.
  expect(await screen.findByText('Text slide')).toBeTruthy();
  expect(screen.getByText('Image slide')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'First image', busy: true })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Second image', busy: true })).toBeTruthy();

  await act(async () => first.resolve(png()));
  expect(screen.getByAltText('First image').getAttribute('src')).toBe('blob:1');
  expect(screen.getByRole('img', { name: 'Second image', busy: true })).toBeTruthy();

  await act(async () => second.resolve(png()));
  expect(screen.getByAltText('Second image').getAttribute('src')).toBe('blob:2');
  expect(screen.queryByRole('img', { busy: true })).toBeNull();
});

test('a failed image degrades only that image', async () => {
  jest
    .mocked(getArtifactAsset)
    .mockImplementation((...args) =>
      args[3] === 'asset-a' ? Promise.reject(new Error('Network unavailable')) : Promise.resolve(png())
    );
  render(<Preview />);

  await waitFor(() => expect(screen.getByAltText('Second image').getAttribute('src')).toBe('blob:1'));
  expect(screen.getByRole('img', { name: 'Image unavailable' }).textContent).toContain('Image unavailable');
  expect(screen.queryByAltText('First image')).toBeNull();
  expect(screen.getByText('Text slide')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

test('revokes object URLs when the version is replaced and on unmount', async () => {
  jest.mocked(getArtifactAsset).mockImplementation(async () => png());
  const { rerender, unmount } = render(<Preview />);

  await waitFor(() => expect(screen.getByAltText('Second image').getAttribute('src')).toBe('blob:2'));
  rerender(<Preview version={4} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
  await waitFor(() => expect(screen.getByAltText('Second image').getAttribute('src')).toBe('blob:4'));
  expect(assetCalls().filter((args) => args[2] === 4)).toHaveLength(2);

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:3');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:4');
});

test('creates no object URL for an image read that finishes after an abort', async () => {
  const late = deferred<Blob>();

  jest.mocked(getArtifactAsset).mockReturnValue(late.promise);
  const { unmount } = render(<Preview />);

  await screen.findByText('Text slide');
  const signals = assetCalls().map((args) => args[5]);

  unmount();
  await act(async () => late.resolve(png()));
  expect(signals.every((signal) => signal?.aborted)).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('reads each distinct image once, at most four at a time', async () => {
  const reads = new Map<string, ReturnType<typeof deferred<Blob>>>();

  jest.mocked(getArtifactScene).mockResolvedValue(
    sceneWith([
      slide(
        'gallery',
        ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => image(`image-${id}`, `asset-${id}`, `Image ${id}`))
      ),
      // The same asset revision on another slide shares the first read.
      slide('repeat', [image('repeat-a', 'asset-a', 'Image a again')]),
    ])
  );
  jest.mocked(getArtifactAsset).mockImplementation((...args) => {
    const read = deferred<Blob>();

    reads.set(args[3], read);
    return read.promise;
  });
  render(<Preview />);

  await waitFor(() => expect(assetCalls()).toHaveLength(4));
  await act(async () => reads.get('asset-a')!.resolve(png()));
  expect(assetCalls()).toHaveLength(5);
  await act(async () => [...reads.values()].forEach((read) => read.resolve(png())));
  await waitFor(() => expect(assetCalls()).toHaveLength(6));
  await act(async () => [...reads.values()].forEach((read) => read.resolve(png())));
  expect(assetCalls().map((args) => args[3])).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => `asset-${id}`));
});

test('memoized thumbnails do not re-render when only the selected slide changes', async () => {
  const known = sceneWith([slide('one', [text('one', 'First slide')]), slide('two', [text('two', 'Second slide')])]);
  const deck = {
    id: 'deck',
    version: 3,
    scene: { workspaceId: 'workspace', id: 'deck', version: 3, value: known },
  } as SavedDeck;

  function Workflow() {
    const [selected, setSelected] = useState(0);

    return (
      <ServerSlideSceneProvider scope={scope} deck={deck}>
        <button onClick={() => setSelected(1)}>Select second</button>
        <ServerSlideCanvas index={0} miniature />
        <ServerSlideCanvas index={1} miniature />
        <ServerSlideCanvas index={selected} />
      </ServerSlideSceneProvider>
    );
  }

  // Each canvas render reads the scene context once.
  const reads = jest.spyOn(jest.requireActual<typeof import('react')>('react'), 'useContext');

  render(<Workflow />);
  await waitFor(() => expect(screen.getAllByText('First slide')).toHaveLength(2));
  reads.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Select second' }));
  expect(screen.getAllByText('Second slide')).toHaveLength(2);
  // Only the main canvas, whose index changed, rendered again.
  expect(reads).toHaveBeenCalledTimes(1);
  reads.mockRestore();
});

test('an image completion redraws only that asset, leaving other images and text-only slides untouched', async () => {
  const first = deferred<Blob>();
  const second = deferred<Blob>();
  const heading = text('static-heading', 'Unrelated static text');
  const otherImage = image('second', 'asset-b', 'Second image');
  let textReads = 0;
  let otherImageReads = 0;

  Object.defineProperty(heading, 'text', {
    enumerable: true,
    get: () => {
      textReads++;
      return 'Unrelated static text';
    },
  });
  Object.defineProperty(otherImage, 'attribution', {
    enumerable: true,
    get: () => {
      otherImageReads++;
      return 'Second image';
    },
  });
  jest
    .mocked(getArtifactScene)
    .mockResolvedValue(
      sceneWith([slide('static', [heading]), slide('pictures', [image('first', 'asset-a', 'First image'), otherImage])])
    );
  jest
    .mocked(getArtifactAsset)
    .mockImplementation((...args) => (args[3] === 'asset-a' ? first.promise : second.promise));
  render(<Preview />);

  await screen.findByText('Unrelated static text');
  textReads = 0;
  otherImageReads = 0;
  await act(async () => first.resolve(png()));
  expect(screen.getByAltText('First image').getAttribute('src')).toBe('blob:1');
  expect(screen.getByRole('img', { name: 'Second image', busy: true })).toBeTruthy();
  expect(textReads).toBe(0);
  expect(otherImageReads).toBe(0);
  // Failure also updates just its own placeholder, without rebuilding the static canvas.
  await act(async () => second.reject(new Error('Image unavailable')));
  expect(screen.getByRole('img', { name: 'Image unavailable' })).toBeTruthy();
  expect(textReads).toBe(0);
});
