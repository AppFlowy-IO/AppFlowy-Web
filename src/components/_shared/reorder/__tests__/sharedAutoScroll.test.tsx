import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { renderHook } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';

import { registerSharedAutoScroll } from '../sharedAutoScroll';

jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: jest.fn(),
}));

const mockAutoScroll = jest.mocked(autoScrollForElements);

type Feedback = Parameters<NonNullable<Parameters<typeof autoScrollForElements>[0]['canScroll']>>[0];

function feedback(element: Element, instanceId: symbol): Feedback {
  return {
    element,
    source: { element: document.createElement('div'), dragHandle: null, data: { instanceId } },
    input: {
      altKey: false,
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    },
  };
}

describe('registerSharedAutoScroll', () => {
  beforeEach(() => {
    mockAutoScroll.mockReset();
    mockAutoScroll.mockImplementation(() => jest.fn());
  });

  it('shares one registration across grids and retains the remaining grid after cleanup', () => {
    const element = document.createElement('div');
    const firstGrid = Symbol('first grid');
    const secondGrid = Symbol('second grid');
    const unregisterFirst = registerSharedAutoScroll({
      element,
      canScroll: ({ source }) => source.data.instanceId === firstGrid,
    });
    const unregisterSecond = registerSharedAutoScroll({
      element,
      canScroll: ({ source }) => source.data.instanceId === secondGrid,
    });
    const canScroll = mockAutoScroll.mock.calls[0][0].canScroll!;
    const cleanup = mockAutoScroll.mock.results[0].value;

    expect(mockAutoScroll).toHaveBeenCalledTimes(1);
    expect(canScroll(feedback(element, firstGrid))).toBe(true);
    expect(canScroll(feedback(element, secondGrid))).toBe(true);
    expect(canScroll(feedback(element, Symbol('unrelated grid')))).toBe(false);

    unregisterFirst();
    unregisterFirst();
    expect(cleanup).not.toHaveBeenCalled();
    expect(canScroll(feedback(element, firstGrid))).toBe(false);
    expect(canScroll(feedback(element, secondGrid))).toBe(true);

    unregisterSecond();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(canScroll(feedback(element, secondGrid))).toBe(false);
  });

  it('preserves an unfiltered editor registration alongside filtered database participants', () => {
    const element = document.createElement('div');
    const unregisterGrid = registerSharedAutoScroll({ element, canScroll: () => false });
    const unregisterEditor = registerSharedAutoScroll({ element });
    const canScroll = mockAutoScroll.mock.calls[0][0].canScroll!;
    const drag = feedback(element, Symbol('editor block'));

    expect(canScroll(drag)).toBe(true);
    unregisterEditor();
    expect(canScroll(drag)).toBe(false);
    unregisterGrid();
  });

  it('keeps different elements independent and ignores an old cleanup after re-registration', () => {
    const firstElement = document.createElement('div');
    const secondElement = document.createElement('div');
    const unregisterFirst = registerSharedAutoScroll({ element: firstElement });
    const unregisterSecond = registerSharedAutoScroll({ element: secondElement });

    expect(mockAutoScroll).toHaveBeenCalledTimes(2);
    unregisterFirst();
    expect(mockAutoScroll.mock.results[0].value).toHaveBeenCalledTimes(1);
    expect(mockAutoScroll.mock.results[1].value).not.toHaveBeenCalled();

    const unregisterReplacement = registerSharedAutoScroll({ element: firstElement });

    unregisterFirst();
    expect(mockAutoScroll.mock.results[2].value).not.toHaveBeenCalled();

    const unregisterSibling = registerSharedAutoScroll({ element: firstElement });

    expect(mockAutoScroll).toHaveBeenCalledTimes(3);
    unregisterReplacement();
    expect(mockAutoScroll.mock.results[2].value).not.toHaveBeenCalled();
    unregisterSibling();
    unregisterSecond();
    expect(mockAutoScroll.mock.results[1].value).toHaveBeenCalledTimes(1);
    expect(mockAutoScroll.mock.results[2].value).toHaveBeenCalledTimes(1);
  });

  it('balances shared subscriptions during StrictMode replay, predicate changes and unmount', () => {
    const element = document.createElement('div');
    const firstGrid = Symbol('first grid');
    const secondGrid = Symbol('second grid');
    const replacementGrid = Symbol('replacement grid');
    const { rerender, unmount } = renderHook(
      ({ instanceId }) => {
        useEffect(
          () => registerSharedAutoScroll({ element, canScroll: ({ source }) => source.data.instanceId === instanceId }),
          [instanceId]
        );
        useEffect(
          () => registerSharedAutoScroll({ element, canScroll: ({ source }) => source.data.instanceId === secondGrid }),
          []
        );
      },
      { initialProps: { instanceId: firstGrid }, wrapper: StrictMode }
    );

    expect(mockAutoScroll).toHaveBeenCalledTimes(2);
    expect(mockAutoScroll.mock.results[0].value).toHaveBeenCalledTimes(1);
    expect(mockAutoScroll.mock.results[1].value).not.toHaveBeenCalled();

    rerender({ instanceId: replacementGrid });

    const canScroll = mockAutoScroll.mock.calls[1][0].canScroll!;

    expect(mockAutoScroll).toHaveBeenCalledTimes(2);
    expect(canScroll(feedback(element, firstGrid))).toBe(false);
    expect(canScroll(feedback(element, secondGrid))).toBe(true);
    expect(canScroll(feedback(element, replacementGrid))).toBe(true);
    unmount();
    expect(mockAutoScroll.mock.results[1].value).toHaveBeenCalledTimes(1);
  });
});
