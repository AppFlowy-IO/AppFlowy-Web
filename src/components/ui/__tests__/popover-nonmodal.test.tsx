/**
 * The backdrop popover, `modal='backdrop'` (W11): modal behaviour without writing to <body>. An
 * outside press closes it without reaching what is under it, wheel and touch
 * scrolling on the backdrop are blocked, Escape closes, the focus stays in
 * the content and returns to the trigger, and neither opening nor closing
 * writes a style or an attribute on <body> (a modal popover writes both,
 * which restyles the whole page).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Radix registers its outside-press listener on the next task after opening. */
const nextTask = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function Harness({
  modal = false,
  onPageClick = () => undefined,
  keepFocusOnClose = false,
  children,
}: {
  /** The control: today's modal popover. */
  modal?: boolean;
  onPageClick?: () => void;
  /** The content handles the close focus itself (`onCloseAutoFocus` prevented). */
  keepFocusOnClose?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button data-testid='page-button' onClick={onPageClick} type='button'>
        Page
      </button>
      <Popover modal={modal ? true : 'backdrop'} onOpenChange={setOpen} open={open}>
        <PopoverTrigger data-testid='trigger'>Open</PopoverTrigger>
        <PopoverContent
          data-testid='content'
          onCloseAutoFocus={keepFocusOnClose ? (event) => event.preventDefault() : undefined}
        >
          <input data-testid='first' />
          <button data-testid='inside' type='button'>
            Inside
          </button>
          {children}
        </PopoverContent>
      </Popover>
      <button data-testid='page-after' type='button'>
        After
      </button>
    </div>
  );
}

/** Every attribute of <body>, as `name=value`. */
const bodyAttributes = () =>
  document.body.getAttributeNames().map((name) => `${name}=${document.body.getAttribute(name)}`);

async function open() {
  fireEvent.click(screen.getByTestId('trigger'));
  expect(screen.getByTestId('content')).toBeTruthy();
  await nextTask();
}

function pressBackdrop(button = 0) {
  const backdrop = screen.getAllByTestId('popover-backdrop').at(-1) as HTMLElement;

  fireEvent.pointerDown(backdrop, { button, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.mouseDown(backdrop, { button });
  fireEvent.pointerUp(backdrop, { button, pointerType: 'mouse' });
  fireEvent.mouseUp(backdrop, { button });
  fireEvent.click(backdrop, { button });
}

describe('Popover backdrop', () => {
  it('writes no style or attribute on <body> while it opens, is open and closes', async () => {
    const before = bodyAttributes();
    const writes: string[] = [];
    const observer = new MutationObserver((records) =>
      records.forEach((record) => writes.push(record.attributeName ?? ''))
    );

    observer.observe(document.body, { attributes: true });
    render(<Harness />);
    await open();

    expect(bodyAttributes()).toEqual(before);
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByTestId('content')).toBeNull();
    await nextTask();

    await act(async () => {
      await Promise.resolve();
    });
    observer.disconnect();
    expect(writes).toEqual([]);
    expect(bodyAttributes()).toEqual(before);
  });

  it('differs from a modal popover, which writes pointer-events and the scroll lock on <body> (control)', async () => {
    render(<Harness modal />);
    await open();

    expect(document.body.style.pointerEvents).toBe('none');
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    expect(screen.queryByTestId('popover-backdrop')).toBeNull();
  });

  it('puts a fixed backdrop under the content, before it in the document', async () => {
    render(<Harness />);
    await open();
    const backdrop = screen.getByTestId('popover-backdrop');
    const content = screen.getByTestId('content');

    expect(backdrop.className).toContain('fixed');
    expect(backdrop.className).toContain('inset-0');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(content.getAttribute('aria-modal')).toBe('true');
  });

  it('closes on an outside press that reaches nothing under the backdrop', async () => {
    const onPageClick = jest.fn();

    render(<Harness onPageClick={onPageClick} />);
    await open();
    pressBackdrop();

    expect(screen.queryByTestId('content')).toBeNull();
    expect(screen.queryByTestId('popover-backdrop')).toBeNull();
    expect(onPageClick).not.toHaveBeenCalled();
  });

  it('blocks wheel and touch scrolling on the backdrop', async () => {
    render(<Harness />);
    await open();
    const backdrop = screen.getByTestId('popover-backdrop');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });

    backdrop.dispatchEvent(wheel);
    backdrop.dispatchEvent(touchMove);

    expect(wheel.defaultPrevented).toBe(true);
    expect(touchMove.defaultPrevented).toBe(true);
    expect(backdrop.style.touchAction).toBe('none');
  });

  it('closes on Escape and gives the focus back to the trigger', async () => {
    render(<Harness />);
    screen.getByTestId('trigger').focus();
    await open();
    expect(screen.getByTestId('content').contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByTestId('content')).toBeNull();
    await nextTask();
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });

  it('gives the focus back to the trigger after an outside press, unless the content keeps it', async () => {
    const { unmount } = render(<Harness />);

    await open();
    pressBackdrop();
    await nextTask();
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
    unmount();

    render(<Harness keepFocusOnClose />);
    await open();
    pressBackdrop();
    await nextTask();
    expect(document.activeElement).not.toBe(screen.getByTestId('trigger'));
  });

  it('keeps the focus in the content: focus moved behind the backdrop comes back', async () => {
    render(<Harness />);
    await open();
    act(() => screen.getByTestId('inside').focus());

    act(() => screen.getByTestId('page-after').focus());
    expect(document.activeElement).toBe(screen.getByTestId('inside'));
    act(() => screen.getByTestId('page-button').focus());
    expect(document.activeElement).toBe(screen.getByTestId('inside'));
    // Focus moving out never closes it.
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('nests: the inner backdrop takes the press and the focus, and only the inner popover closes', async () => {
    function Inner() {
      const [innerOpen, setInnerOpen] = useState(false);

      return (
        <Popover modal='backdrop' onOpenChange={setInnerOpen} open={innerOpen}>
          <PopoverTrigger data-testid='inner-trigger'>Inner</PopoverTrigger>
          <PopoverContent data-testid='inner-content'>
            <input data-testid='inner-input' />
          </PopoverContent>
        </Popover>
      );
    }

    render(
      <Harness>
        <Inner />
      </Harness>
    );
    await open();
    fireEvent.click(screen.getByTestId('inner-trigger'));
    await nextTask();
    expect(screen.getAllByTestId('popover-backdrop')).toHaveLength(2);

    // The inner popover keeps the focus, even from its outer content.
    act(() => screen.getByTestId('inner-input').focus());
    act(() => screen.getByTestId('inside').focus());
    expect(document.activeElement).toBe(screen.getByTestId('inner-input'));

    pressBackdrop();
    expect(screen.queryByTestId('inner-content')).toBeNull();
    expect(screen.getByTestId('content')).toBeTruthy();
    expect(screen.getAllByTestId('popover-backdrop')).toHaveLength(1);
  });
});
