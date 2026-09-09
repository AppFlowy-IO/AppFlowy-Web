import { act, fireEvent, render, screen } from '@testing-library/react';

import { TextareaAutosize } from '../textarea-autosize';

describe('TextareaAutosize retained drafts', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let notifyResize: (width: number) => void;
  let mirrorHeight: number;
  let observedElement: Element;
  const observe = jest.fn((element: Element) => { observedElement = element; });
  const disconnect = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mirrorHeight = 200;
    globalThis.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
      notifyResize = (width: number) => callback([
        { target: observedElement, contentRect: { width } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
      return { observe, unobserve: jest.fn(), disconnect };
    }) as unknown as typeof ResizeObserver;
    const layout = {
      clientRects(this: HTMLElement) {
        return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
      },
      bounds(this: HTMLElement) {
        return { width: this.closest('[hidden]') ? 0 : 360 } as DOMRect;
      },
      height(this: HTMLElement) {
        return this.closest('[hidden]') ? 0 : mirrorHeight;
      },
    };

    jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(layout.clientRects);
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout.bounds);
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(layout.height);
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function editor(hidden: boolean, value: string, maxRows = 6) {
    return (
      <div hidden={hidden}>
        <TextareaAutosize
          aria-label='Reply draft'
          value={value}
          readOnly
          maxRows={maxRows}
          style={{ lineHeight: '20px', padding: 0 }}
        />
      </div>
    );
  }

  it('preserves a scrollable multiline draft across a hidden resize and remeasures when shown', () => {
    const draft = Array.from({ length: 10 }, (_, index) => `Draft line ${index}`).join('\n');
    const { rerender } = render(editor(false, draft));
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    act(() => { jest.runOnlyPendingTimers(); notifyResize(360); });
    expect(input.style.height).toBe('120px');
    expect(input.style.overflowY).toBe('auto');

    rerender(editor(true, draft));
    act(() => notifyResize(0));
    fireEvent.resize(window);
    expect(input.style.height).toBe('120px');

    // A changed row limit while hidden also needs to wait for real layout.
    rerender(editor(true, draft, 4));
    act(() => { jest.runOnlyPendingTimers(); });
    expect(input.style.height).toBe('120px');
    rerender(editor(false, draft, 4));
    act(() => notifyResize(300));

    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe(draft);
    expect(input.style.height).toBe('80px');
    expect(input.style.overflowY).toBe('auto');
  });

  it('uses current draft measurements without resubscribing or reacting to its own height changes', () => {
    const { rerender, unmount } = render(editor(false, 'First draft'));
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    act(() => { jest.runOnlyPendingTimers(); notifyResize(360); });
    mirrorHeight = 40;
    rerender(editor(false, 'Updated draft'));
    act(() => { jest.runOnlyPendingTimers(); });
    expect(input.style.height).toBe('40px');
    expect(observe).toHaveBeenCalledTimes(1);

    mirrorHeight = 100;
    act(() => notifyResize(360));
    expect(input.style.height).toBe('40px');
    act(() => notifyResize(200));
    expect(input.style.height).toBe('100px');

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
