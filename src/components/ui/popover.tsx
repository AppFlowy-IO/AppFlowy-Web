import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  ComponentProps,
  createContext,
  forwardRef,
  MutableRefObject,
  Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

type PopoverContainer = ComponentProps<typeof PopoverPrimitive.Portal>['container'];

/** What a backdrop popover (`modal='backdrop'`) shares with its trigger and content. */
interface PopoverBackdropState {
  open: boolean;
  /** The trigger: it gets the focus back on close, as a modal popover gives it. */
  triggerRef: MutableRefObject<HTMLElement | null>;
}

/** Set by a `modal='backdrop'` popover; `null` resets it for any other popover nested in one. */
const PopoverBackdropContext = createContext<PopoverBackdropState | null>(null);

/**
 * The backdrop popovers open on the page, innermost last: only the last one
 * keeps the focus inside its content.
 */
const backdropLayers: object[] = [];

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

/** One ref callback that sets both refs; `second` may take a wider element type. */
function useMergedRef<T extends U, U = T>(first: Ref<T> | undefined, second: Ref<U> | undefined) {
  return useCallback(
    (value: T | null) => {
      assignRef(first, value);
      assignRef<U>(second, value);
    },
    [first, second]
  );
}

type PopoverProps = Omit<ComponentProps<typeof PopoverPrimitive.Root>, 'modal'> & {
  /**
   * `true`: Radix's modal popover. `'backdrop'`: the same behaviour without
   * writing to `<body>`: a fixed transparent backdrop under the content takes
   * outside presses (they close the popover and reach nothing under it) and
   * wheel or touch scrolling (the page does not scroll under it); the focus
   * stays in the content and returns to the trigger on close; Escape closes.
   * A modal popover sets `pointer-events` and a scroll-lock custom property
   * on `<body>`, both inherited, so each open and each close restyles the
   * whole page (W11).
   */
  modal?: boolean | 'backdrop';
};

function BackdropPopover({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof PopoverPrimitive.Root>, 'modal'>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const triggerRef = useRef<HTMLElement | null>(null);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );
  const state = useMemo<PopoverBackdropState>(() => ({ open, triggerRef }), [open]);

  return (
    <PopoverBackdropContext.Provider value={state}>
      <PopoverPrimitive.Root data-slot='popover' {...props} modal={false} onOpenChange={handleOpenChange} open={open} />
    </PopoverBackdropContext.Provider>
  );
}

function Popover({ modal, ...props }: PopoverProps) {
  if (modal === 'backdrop') return <BackdropPopover {...props} />;
  return (
    <PopoverBackdropContext.Provider value={null}>
      <PopoverPrimitive.Root data-slot='popover' modal={modal} {...props} />
    </PopoverBackdropContext.Provider>
  );
}

const PopoverTrigger = forwardRef<HTMLButtonElement, React.ComponentProps<typeof PopoverPrimitive.Trigger>>(
  ({ ...props }, ref) => {
    const backdrop = useContext(PopoverBackdropContext);
    const mergedRef = useMergedRef<HTMLButtonElement, HTMLElement>(ref, backdrop?.triggerRef);

    return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} ref={mergedRef} />;
  }
);

const CONTENT_CLASS = cn(
  'z-50 min-w-[240px] rounded-400 bg-surface-layer-03  p-0 shadow-popover',

  'origin-(--radix-popover-content-transform-origin)',

  'data-[state=open]:animate-in',

  'data-[state=open]:fade-in-0',

  'data-[state=open]:zoom-in-95',

  'data-[side=bottom]:slide-in-from-top-2',
  'data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2',
  'data-[side=top]:slide-in-from-bottom-2',

  'focus:outline-none focus-visible:outline-none'
);

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: PopoverContainer;
};

/**
 * The backdrop of a `modal='backdrop'` popover: fixed over the viewport, transparent,
 * in the same container as the content and just before it, so it covers the
 * page but not the content (the content takes its z-index). It eats wheel and
 * touch scrolling; an outside press lands on it, so nothing under it is
 * activated, and Radix closes the popover.
 */
const PopoverBackdrop = forwardRef<HTMLDivElement, { container?: PopoverContainer }>(function PopoverBackdrop(
  { container },
  forwardedRef
) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = useMergedRef<HTMLDivElement>(forwardedRef, setElement);

  useEffect(() => {
    if (!element) return;
    const block = (event: Event) => event.preventDefault();
    // Not React's handlers: React listens to wheel and touchmove passively, so they cannot prevent scrolling.
    const options = { passive: false } as const;

    element.addEventListener('wheel', block, options);
    element.addEventListener('touchmove', block, options);
    return () => {
      element.removeEventListener('wheel', block);
      element.removeEventListener('touchmove', block);
    };
  }, [element]);

  return createPortal(
    <div
      aria-hidden='true'
      className='fixed inset-0 z-50'
      data-slot='popover-backdrop'
      data-testid='popover-backdrop'
      ref={ref}
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    />,
    container ?? document.body
  );
});

/**
 * Keeps the focus in `content` while it is the innermost backdrop popover, as
 * a modal popover's focus scope does: focus that lands behind the backdrop
 * (on the page, by Tab or by script) goes back to the content's last focused
 * element, or the content. Focus in a layer opened from the content (a nested
 * menu, a dialog) is left alone: those come after the backdrop in the
 * document.
 */
function useBackdropFocusTrap(content: HTMLElement | null, backdropRef: MutableRefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!content) return;
    const layer = {};
    // The content may have taken the focus on mount already (Radix focuses its first field).
    const active = document.activeElement;
    let lastFocused: HTMLElement | null = active instanceof HTMLElement && content.contains(active) ? active : null;
    // A closing popover may still be listed while its content is already gone: it traps nothing then.
    const isInnermost = () => content.isConnected && backdropLayers[backdropLayers.length - 1] === layer;
    const isBehindBackdrop = (target: Node) => {
      const backdrop = backdropRef.current;

      if (!backdrop || content.contains(target)) return false;
      return Boolean(backdrop.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING);
    };

    const focusContent = () => {
      const target = lastFocused?.isConnected && content.contains(lastFocused) ? lastFocused : content;

      target.focus({ preventScroll: true });
      // As Radix's focus scope does when it brings the focus back to a field.
      if (target instanceof HTMLInputElement) target.select();
    };

    const onContentFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused = event.target;
    };

    const onDocumentFocusIn = (event: FocusEvent) => {
      if (isInnermost() && event.target instanceof Node && isBehindBackdrop(event.target)) focusContent();
    };

    // A focused element removed from the content leaves the focus on <body>.
    const observer = new MutationObserver((records) => {
      if (!isInnermost() || document.activeElement !== document.body) return;
      if (records.some((record) => record.removedNodes.length > 0)) content.focus({ preventScroll: true });
    });

    backdropLayers.push(layer);
    content.addEventListener('focusin', onContentFocusIn);
    document.addEventListener('focusin', onDocumentFocusIn);
    observer.observe(content, { childList: true, subtree: true });
    return () => {
      const index = backdropLayers.indexOf(layer);

      if (index !== -1) backdropLayers.splice(index, 1);
      content.removeEventListener('focusin', onContentFocusIn);
      document.removeEventListener('focusin', onDocumentFocusIn);
      observer.disconnect();
    };
  }, [backdropRef, content]);
}

function BackdropPopoverContent({
  state,
  container,
  className,
  align,
  sideOffset,
  onCloseAutoFocus,
  onFocusOutside,
  onPointerDownOutside,
  ...props
}: PopoverContentProps & { state: PopoverBackdropState }) {
  const { open, triggerRef } = state;
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const rightClickOutsideRef = useRef(false);

  useBackdropFocusTrap(content, backdropRef);

  // The backdrop sits right under the content, on whatever layer the content is.
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;

    if (!content || !backdrop) return;
    const zIndex = window.getComputedStyle(content).zIndex;

    if (zIndex && zIndex !== 'auto') backdrop.style.zIndex = zIndex;
  }, [content, open]);

  return (
    <>
      {open ? <PopoverBackdrop container={container} ref={backdropRef} /> : null}
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          align={align}
          aria-modal='true'
          className={cn(CONTENT_CLASS, className)}
          data-slot='popover-content'
          sideOffset={sideOffset}
          {...props}
          // A modal popover's close: the trigger gets the focus back, unless
          // the content's own handler took it or a right click closed it.
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (!rightClickOutsideRef.current) triggerRef.current?.focus();
          }}
          // Focus that leaves is brought back (`useBackdropFocusTrap`); it never closes the popover.
          onFocusOutside={(event) => {
            onFocusOutside?.(event);
            event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            onPointerDownOutside?.(event);
            const original = event.detail.originalEvent;

            rightClickOutsideRef.current = original.button === 2 || (original.button === 0 && original.ctrlKey);
          }}
          ref={setContent}
        />
      </PopoverPrimitive.Portal>
    </>
  );
}

function PopoverContent({ className, align = 'center', sideOffset = 4, container, ...props }: PopoverContentProps) {
  const backdrop = useContext(PopoverBackdropContext);

  if (backdrop) {
    return (
      <BackdropPopoverContent
        align={align}
        className={className}
        container={container}
        sideOffset={sideOffset}
        state={backdrop}
        {...props}
      />
    );
  }

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot='popover-content'
        align={align}
        sideOffset={sideOffset}
        className={cn(CONTENT_CLASS, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot='popover-anchor' {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
