import { copyDiagramImage, downloadDiagram, prepareDiagramExport } from '../download-diagram';

const diagram = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" style="max-width: ${width}px;">
    <path d="M 10 10 L 30 30"/><text x="10" y="20">Diagram</text>
  </svg>`;

test('SVG uses natural dimensions and retains vector text, paths, theme styles and negative viewBox origin', () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="-12 -8 132.625 159"
    style="max-width:132.625px;max-height:100%;min-width:40px;width:100%;height:auto;background:transparent;">
    <style>text{fill:#e2e4ef}</style><path d="M 0 0 L 100 100"/><text>Mermaid → Diagram</text>
  </svg>`;
  const result = prepareDiagramExport(input, 'svg');
  const root = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;

  expect(result.width).toBe(132.625);
  expect(result.height).toBe(159);
  expect(root.getAttribute('viewBox')).toBe('-12 -8 132.625 159');
  expect(root.getAttribute('width')).toBe('132.625');
  expect(root.getAttribute('height')).toBe('159');
  expect(root.getAttribute('style')).toBe('background: transparent;');
  expect(root.querySelector('text')?.textContent).toBe('Mermaid → Diagram');
  expect(root.querySelector('path')).not.toBeNull();
  expect(root.querySelector('style')?.textContent).toBe('text{fill:#e2e4ef}');
  expect(root.querySelector('image')).toBeNull();
});

test.each([
  [100, 200, 1024, 2048],
  [200, 100, 2048, 1024],
  [800, 600, 3200, 2400],
  [10000, 100, 8192, 81],
  [100, 10000, 81, 8192],
  [10000, 10000, 4096, 4096],
])('PNG sizes %s × %s for sharp output within edge and pixel limits', (width, height, expectedWidth, expectedHeight) => {
  const result = prepareDiagramExport(diagram(width, height), 'png');
  const root = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;

  expect([result.width, result.height]).toEqual([expectedWidth, expectedHeight]);
  expect(root.getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`);
  expect(root.getAttribute('width')).toBe(String(expectedWidth));
  expect(root.getAttribute('height')).toBe(String(expectedHeight));
  expect(Math.abs(result.width * height - result.height * width)).toBeLessThanOrEqual(Math.max(width, height));
  expect(result.width * result.height).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8192);
});

test('SVG with fixed pixel dimensions gets a viewBox so PNG scales the complete diagram', () => {
  const result = prepareDiagramExport(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100"><text>Content</text></svg>',
    'png'
  );

  expect(result).toMatchObject({ width: 2048, height: 1024 });
  expect(result.svg).toContain('viewBox="0 0 200 100"');
  expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test.each([
  '<svg><text></svg>',
  '<html/>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 100"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -10 100"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 Infinity 100"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100"/>',
])('refuses invalid or unmeasurable SVG rather than silently downloading a tiny image: %s', (input) => {
  expect(() => prepareDiagramExport(input, 'png')).toThrow('Unable to export diagram');
});

describe('download lifecycle', () => {
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    createObjectURL.mockReset().mockReturnValueOnce('blob:source').mockReturnValueOnce('blob:png');
    revokeObjectURL.mockReset();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('SVG downloads directly and keeps its URL alive until the browser starts the download', async () => {
    await downloadDiagram(diagram(200, 100), 'svg');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
  });

  test('PNG renders at export resolution and releases canvas memory and both URLs', async () => {
    const drawImage = jest.fn();
    let exportedSize: number[] = [];

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob');

    toBlob.mockImplementation((callback) => {
      const canvas = toBlob.mock.contexts[0];

      exportedSize = [canvas.width, canvas.height];
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    await downloadDiagram(diagram(200, 100), 'png');
    expect(exportedSize).toEqual([2048, 1024]);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 2048, 1024);
    expect(toBlob.mock.contexts[0]).toMatchObject({ width: 0, height: 0 });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:source'], ['blob:png']]);
  });

  test('failed image decoding revokes the source without triggering a download', async () => {
    (HTMLImageElement.prototype.decode as jest.Mock).mockRejectedValue(new Error('decode failed'));
    await expect(downloadDiagram(diagram(200, 100), 'png')).rejects.toThrow('decode failed');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
  });

  test.each(['context', 'blob'])('failed canvas %s does not download an empty file', async (failure) => {
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(failure === 'context' ? null : ({ drawImage: jest.fn() } as unknown as CanvasRenderingContext2D));
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    await expect(downloadDiagram(diagram(200, 100), 'png')).rejects.toThrow('Unable to export diagram');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
  });

  describe('image clipboard', () => {
    const write = jest.fn();
    const ClipboardItemMock = jest.fn((data: Record<string, Promise<Blob>>) => ({
      types: Object.keys(data),
      getType: (type: string) => data[type],
    }));

    beforeEach(() => {
      write.mockReset().mockImplementation(async (items: ClipboardItem[]) => {
        await items[0].getType('image/png');
      });
      ClipboardItemMock.mockClear();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
      Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: ClipboardItemMock });
      jest
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({ drawImage: jest.fn() } as unknown as CanvasRenderingContext2D);
      jest
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    });

    test('starts the clipboard write synchronously before PNG rendering finishes, preserving the click gesture', async () => {
      let finishDecode!: () => void;

      (HTMLImageElement.prototype.decode as jest.Mock).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishDecode = resolve;
          })
      );
      const copying = copyDiagramImage(diagram(200, 100));

      expect(write).toHaveBeenCalledTimes(1);
      expect(ClipboardItemMock.mock.calls[0][0]['image/png']).toBeInstanceOf(Promise);
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
      finishDecode();
      await copying;
      const item = write.mock.calls[0][0][0] as ClipboardItem;

      expect((await item.getType('image/png')).type).toBe('image/png');
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
    });

    test('reports denied clipboard permission and still cleans up rendering after the rejection', async () => {
      write.mockRejectedValue(new DOMException('Clipboard permission denied', 'NotAllowedError'));
      await expect(copyDiagramImage(diagram(200, 100))).rejects.toThrow('Clipboard permission denied');
      await write.mock.calls[0][0][0].getType('image/png');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    });

    test('failed PNG rendering rejects copying and a later copy can succeed', async () => {
      (HTMLImageElement.prototype.decode as jest.Mock).mockRejectedValueOnce(new Error('decode failed'));
      await expect(copyDiagramImage(diagram(200, 100))).rejects.toThrow('decode failed');
      await expect(copyDiagramImage(diagram(200, 100))).resolves.toBeUndefined();
      expect(write).toHaveBeenCalledTimes(2);
    });

    test.each(['write', 'ClipboardItem'])(
      'does not render or silently copy text when %s is unavailable',
      async (missing) => {
        if (missing === 'write') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        else Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined });
        await expect(copyDiagramImage(diagram(200, 100))).rejects.toThrow('Image clipboard is unavailable');
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
      }
    );
  });
});
