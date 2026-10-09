import { act, fireEvent, render, screen } from '@testing-library/react';

import { BlockType, UIVariant } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { ColorEnum } from '@/utils/color';

import { DockableOutline, DockableOutlinePanel } from '../DockableOutline';
import { OutlineHeading } from '../utils';

const mockNavigation = {
  headings: [] as OutlineHeading[],
  activeId: 'heading-1',
  color: '' as ColorEnum,
  jumpToHeading: jest.fn(),
  getEditorElement: jest.fn<HTMLElement, []>(),
};
let mockCommentsOpen = false;
let mockPublished = false;
let mockViewId = 'document';

jest.mock('../OutlineNavigation', () => ({ useOutlineNavigation: () => mockNavigation }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ viewId: mockViewId, variant: mockPublished ? UIVariant.Publish : UIVariant.App }),
}));
jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentPanelOptional: () => ({ isPanelOpen: mockCommentsOpen }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        dockableTitle: 'Table of contents',
        showOutline: 'Show table of contents',
        displayOptions: 'Outline display options',
        alwaysShow: 'Always show',
        showOnHover: 'Show on hover',
      }[key.split('.').pop()!] || key),
  }),
}));
jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

function headings(count: number): OutlineHeading[] {
  return Array.from({ length: count }, (_, index) => ({
    blockId: `heading-${index + 1}`,
    type: BlockType.HeadingBlock,
    data: { level: (index % 6) + 1, text: `Section ${index + 1}` },
    children: [],
  }));
}

describe('dockable outline interaction', () => {
  let root: HTMLElement;
  const disconnect = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.clear();
    mockCommentsOpen = false;
    mockPublished = false;
    mockViewId = 'document';
    mockNavigation.headings = headings(6);
    mockNavigation.activeId = 'heading-1';
    mockNavigation.color = '' as ColorEnum;
    root = document.createElement('div');
    root.className = 'appflowy-layout';
    document.body.append(root);
    root.getBoundingClientRect = () => ({
      top: 0,
      right: 1200,
      bottom: 900,
      left: 0,
      height: 900,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const editor = document.createElement('div');

    editor.getBoundingClientRect = root.getBoundingClientRect;
    root.append(editor);
    mockNavigation.getEditorElement.mockReturnValue(editor);
    global.ResizeObserver = jest.fn().mockImplementation(() => ({ observe: jest.fn(), disconnect }));
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  });

  afterEach(() => {
    root.remove();
    jest.useRealTimers();
  });

  it.each([0, 1, 2])('hides the entire outline for %i headings', (count) => {
    mockNavigation.headings = headings(count);
    render(<DockableOutline />);
    expect(screen.queryByTestId('dockable-outline')).toBeNull();
  });

  it('expands on hover, delays closure, and cancels closure on reentry', () => {
    render(<DockableOutline />);
    const outline = screen.getByTestId('dockable-outline');

    expect(outline.getAttribute('data-expanded')).toBe('false');
    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    expect(outline.getAttribute('data-expanded')).toBe('true');
    fireEvent.mouseLeave(outline);
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(outline.getAttribute('data-expanded')).toBe('true');
    fireEvent.mouseEnter(outline);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(outline.getAttribute('data-expanded')).toBe('true');
    fireEvent.mouseLeave(outline);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(outline.getAttribute('data-expanded')).toBe('false');
  });

  it('navigates without closing and provides no display settings in editable documents', () => {
    render(<DockableOutline />);
    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    fireEvent.click(screen.getByRole('button', { name: 'Section 5' }));
    expect(mockNavigation.jumpToHeading).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'heading-5' }));
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Outline display options' })).toBeNull();
  });

  it('closes on mouse leave after a pointer click even while the clicked item has focus', () => {
    render(<DockableOutline />);
    const outline = screen.getByTestId('dockable-outline');

    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    const item = screen.getByRole('button', { name: 'Section 3' });

    fireEvent.pointerDown(item);
    act(() => item.focus());
    fireEvent.click(item);
    fireEvent.mouseLeave(outline);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(outline.getAttribute('data-expanded')).toBe('false');
  });

  it('supports keyboard expansion and Escape returns focus to the indicator without reopening', () => {
    render(<DockableOutline />);
    const trigger = screen.getByTestId('dockable-outline-trigger');

    act(() => trigger.focus());
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
    const item = screen.getByRole('button', { name: 'Section 2' });

    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
  });

  it('can be focused again after Escape while the indicator itself was focused', () => {
    render(<DockableOutline />);
    const trigger = screen.getByTestId('dockable-outline-trigger');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
    act(() => trigger.blur());
    act(() => trigger.focus());
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
  });

  it('hides behind comments and returns collapsed after the comment panel closes', () => {
    const { rerender } = render(<DockableOutlinePanel published={false} suppressed={false} />);

    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    rerender(<DockableOutlinePanel published={false} suppressed />);
    expect(screen.queryByTestId('dockable-outline')).toBeNull();
    rerender(<DockableOutlinePanel published={false} suppressed={false} />);
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
  });

  it('gives side peeks priority over an always-visible published outline', () => {
    mockPublished = true;
    const { rerender } = render(
      <AppNavigationContext.Provider value={{}}>
        <DockableOutline />
      </AppNavigationContext.Provider>
    );

    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
    rerender(
      <AppNavigationContext.Provider value={{ openPageModalViewId: 'peek' }}>
        <DockableOutline />
      </AppNavigationContext.Provider>
    );
    expect(screen.queryByTestId('dockable-outline')).toBeNull();
    rerender(
      <AppNavigationContext.Provider value={{}}>
        <DockableOutline />
      </AppNavigationContext.Provider>
    );
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    fireEvent.mouseLeave(screen.getByTestId('dockable-outline'));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
  });

  it('defaults published pages to always show and ignores previously saved browser preferences', () => {
    localStorage.setItem('appflowy:outline-display:document', 'hover');
    const { rerender } = render(<DockableOutlinePanel published suppressed={false} />);

    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Outline display options' })).toBeTruthy();
    rerender(<DockableOutlinePanel published={false} suppressed={false} />);
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Outline display options' })).toBeNull();
  });

  it('switches published display modes through the More menu without writing to browser storage', () => {
    mockPublished = true;
    const save = jest.spyOn(Storage.prototype, 'setItem');

    render(<DockableOutline />);
    const outline = screen.getByTestId('dockable-outline');

    fireEvent.keyDown(screen.getByRole('button', { name: 'Outline display options' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemradio', { name: 'Always show' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Show on hover' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show on hover' }));
    fireEvent.mouseLeave(outline);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(outline.getAttribute('data-expanded')).toBe('false');

    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Outline display options' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemradio', { name: 'Show on hover' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Always show' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Always show' }));
    fireEvent.mouseLeave(outline);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(outline.getAttribute('data-expanded')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it('keeps the choice through rerenders but resets it when opening another page or reopening the current page', () => {
    mockPublished = true;
    const outline = () => (
      <AppNavigationContext.Provider value={{}}>
        <DockableOutline />
      </AppNavigationContext.Provider>
    );
    const { rerender, unmount } = render(outline());

    fireEvent.keyDown(screen.getByRole('button', { name: 'Outline display options' }), { key: 'Enter' });
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Show on hover' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show on hover' }));
    fireEvent.mouseLeave(screen.getByTestId('dockable-outline'));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    rerender(outline());
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('false');
    mockViewId = 'other-document';
    rerender(outline());
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
    unmount();
    mockViewId = 'document';
    render(outline());
    expect(screen.getByTestId('dockable-outline').getAttribute('data-expanded')).toBe('true');
  });

  it('inherits the inline outline accent and applies the annotated translucent hover fill', () => {
    mockNavigation.color = ColorEnum.Tint1;
    render(<DockableOutline />);
    const outline = screen.getByTestId('dockable-outline');

    expect(outline.style.getPropertyValue('--outline-accent')).toBe('var(--block-icon-color-14)');
    expect(outline.style.getPropertyValue('--outline-hover')).toBe(
      'color-mix(in srgb, var(--block-bg-hover-color-14) 60%, transparent)'
    );
  });

  it('keeps the active item visible when a window resize reduces the panel height', () => {
    mockNavigation.headings = headings(30);
    mockNavigation.activeId = 'heading-20';
    render(<DockableOutline />);
    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    const list = document.querySelector<HTMLElement>('.dockable-outline-list')!;
    const active = screen.getByRole('button', { name: 'Section 20' });

    Object.defineProperty(active, 'offsetTop', { value: 19 * 28 });
    Object.defineProperty(list, 'clientHeight', { value: 224 });
    list.scrollTop = 0;
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    fireEvent.resize(window);
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(list.scrollTop).toBe(20 * 28 - 224);
  });

  it('coalesces resize measurements and cancels a pending measurement on unmount', () => {
    const measure = jest.spyOn(root, 'getBoundingClientRect');
    const { unmount } = render(<DockableOutline />);

    measure.mockClear();
    fireEvent.resize(window);
    fireEvent.resize(window);
    fireEvent.resize(window);
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(measure).toHaveBeenCalledTimes(1);
    fireEvent.resize(window);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans up delayed closes and resize observers when the document unmounts', () => {
    const { unmount } = render(<DockableOutline />);

    fireEvent.mouseEnter(screen.getByTestId('dockable-outline-trigger'));
    fireEvent.mouseLeave(screen.getByTestId('dockable-outline'));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
