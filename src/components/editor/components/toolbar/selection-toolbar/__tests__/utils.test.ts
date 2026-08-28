import { getRangeRect } from '../utils';

/**
 * Helper: build a DOMRect-like object. jsdom does not run layout, so every real
 * `getBoundingClientRect()` would otherwise return all zeros — which is exactly the
 * shape we want to control here.
 */
function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Mock `window.getSelection()` to return a single collapsed range whose
 * `getBoundingClientRect()` and `startContainer` are fully under our control.
 */
function mockSelection(rangeRect: DOMRect, startContainer: Node) {
  const domRange = {
    getBoundingClientRect: () => rangeRect,
    startContainer,
  } as unknown as Range;

  const selection = {
    rangeCount: 1,
    getRangeAt: () => domRange,
  } as unknown as Selection;

  jest.spyOn(window, 'getSelection').mockReturnValue(selection);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getRangeRect', () => {
  it('returns the range rect when it has a real layout box', () => {
    const valid = rect(120, 240, 0, 18);

    mockSelection(valid, document.createElement('span'));

    expect(getRangeRect()).toEqual(valid);
  });

  // Regression: typing "/" inside an empty checklist/to-do item.
  //
  // In Chrome, a collapsed selection at an empty text node that sits next to a
  // `contentEditable=false` element (the checklist icon AND the block placeholder)
  // returns a degenerate {0,0,0,0} rect. Because that rect is a truthy object, the
  // slash panel used to anchor at the viewport's top-left corner instead of at the
  // caret. getRangeRect() must instead fall back to the nearest ancestor element that
  // has a real layout box.
  it('falls back to the nearest laid-out ancestor when the caret rect is degenerate', () => {
    // <span class="text-element">                 (flex row, has real box)
    //   <span contenteditable=false>icon</span>
    //   <span class="text-content">               (real box at the caret position)
    //     <span contenteditable=false placeholder></span>
    //     <span class="leaf">{""}</span>          (empty leaf, degenerate box)
    //   </span>
    // </span>
    const textElement = document.createElement('span');
    const textContent = document.createElement('span');
    const leaf = document.createElement('span');
    const emptyText = document.createTextNode('');

    leaf.appendChild(emptyText);
    textContent.appendChild(leaf);
    textElement.appendChild(textContent);

    // Empty leaf has no usable box (mirrors Chrome for the empty editable span).
    leaf.getBoundingClientRect = () => rect(0, 0, 0, 0);
    // The content wrapper is where the caret actually sits.
    textContent.getBoundingClientRect = () => rect(300, 220, 0, 24);
    textElement.getBoundingClientRect = () => rect(300, 180, 400, 24);

    // The collapsed caret lives in the empty text node and reports a degenerate rect.
    mockSelection(rect(0, 0, 0, 0), emptyText);

    const result = getRangeRect();

    // Must NOT be the {0,0,0,0} rect that anchors the panel to the top-left corner.
    expect(result).not.toBeNull();
    expect(result!.top).toBe(300);
    expect(result!.left).toBe(220);
  });

  it('returns null when there is no selection range', () => {
    jest.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 0 } as unknown as Selection);

    expect(getRangeRect()).toBeNull();
  });
});
