import { renderHook, waitFor } from '@testing-library/react';
import { Editor, Element } from 'slate';
import { ReactEditor } from 'slate-react';

import { useResizePositioning } from '../useResizePositioning';

function createRect({ left, width }: { left: number; width: number }): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 600,
    width,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('useResizePositioning', () => {
  const observe = jest.fn();
  const disconnect = jest.fn();

  beforeAll(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserverMock {
        observe = observe;
        disconnect = disconnect;
      },
    });
  });

  beforeEach(() => {
    observe.mockClear();
    disconnect.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('measures the version-history scroller before its content overflows', async () => {
    const scroller = document.createElement('div');
    const block = document.createElement('div');

    scroller.className = 'appflowy-scroller';
    scroller.append(block);
    document.body.append(scroller);

    scroller.getBoundingClientRect = () => createRect({ left: 100, width: 800 });
    block.getBoundingClientRect = () => createRect({ left: 200, width: 500 });

    jest.spyOn(ReactEditor, 'toDOMNode').mockReturnValue(block);

    const { result, unmount } = renderHook(() =>
      useResizePositioning({
        editor: {} as Editor,
        node: {} as Element,
      })
    );

    await waitFor(() => expect(result.current.width).toBe(800));

    expect(result.current.paddingStart).toBe(100);
    expect(result.current.paddingEnd).toBe(200);
    expect(observe).toHaveBeenCalledWith(scroller);

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
