import { act, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Descendant, Transforms } from 'slate';
import { ReactEditor, Slate, withReact } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';

import { OutlineNavigationProvider, useOutlineNavigation } from '../OutlineNavigation';
import { OutlineHeading } from '../utils';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

function value(): Descendant[] {
  return [1, 2, 3].map((index) => ({
    type: BlockType.HeadingBlock,
    blockId: `section-${index}`,
    data: { level: index },
    children: [{ type: YjsEditorKey.text, children: [{ text: `Section ${index}` }] }],
  })) as Descendant[];
}

function Probe() {
  const { headings, activeId, jumpToHeading } = useOutlineNavigation();

  return (
    <div>
      <output data-testid='heading-count'>{headings.length}</output>
      <output data-testid='active-heading'>{activeId}</output>
      <button onClick={() => jumpToHeading(headings[1])}>Jump</button>
    </div>
  );
}

describe('shared outline navigation', () => {
  let scroller: HTMLElement;
  let root: HTMLElement;
  let headingElements: HTMLElement[];
  let tops: number[];
  const disconnect = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    scroller = document.createElement('div');
    scroller.className = 'appflowy-scroll-container';
    root = document.createElement('div');
    scroller.append(root);
    document.body.append(scroller);
    tops = [10, 300, 700];
    headingElements = [1, 2, 3].map((index) => {
      const element = document.createElement('div');

      element.id = `heading-section-${index}`;
      element.getBoundingClientRect = () => ({ top: tops[index - 1] } as DOMRect);
      element.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList;
      element.scrollIntoView = jest.fn();
      root.append(element);
      return element;
    });
    jest.spyOn(ReactEditor, 'toDOMNode').mockReturnValue(root);
    global.ResizeObserver = jest.fn().mockImplementation(() => ({ observe: jest.fn(), disconnect }));
  });

  afterEach(() => {
    scroller.remove();
    jest.restoreAllMocks();
    jest.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('updates scrollspy on article scrolling and removes its observer on unmount', () => {
    const editor = withReact(createEditor());
    const { unmount } = render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );

    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-1');
    tops = [-300, 48, 400];
    fireEvent.scroll(scroller);
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('jumps smoothly inside this editor and preserves URL parameters and router history state', () => {
    const duplicate = document.createElement('div');

    duplicate.id = 'heading-section-2';
    duplicate.scrollIntoView = jest.fn();
    document.body.prepend(duplicate);
    window.history.replaceState({ route: 'document' }, '', '/?other=kept#anchor');
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    expect(headingElements[1].scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });
    expect(duplicate.scrollIntoView).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('blockId')).toBe('section-2');
    expect(new URLSearchParams(window.location.search).get('other')).toBe('kept');
    expect(window.location.hash).toBe('#anchor');
    expect(window.history.state).toEqual({ route: 'document' });
    duplicate.remove();
  });

  it('refreshes when collaboration replaces content without emitting a Slate operation', () => {
    const editor = withReact(createEditor());
    const { rerender } = render(
      <Slate editor={editor} initialValue={[]}>
        <OutlineNavigationProvider dockable contentVersion={0}>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );

    expect(screen.getByTestId('heading-count').textContent).toBe('0');
    // This is how withYjs initially loads and restores document content.
    editor.children = value();
    rerender(
      <Slate editor={editor} initialValue={[]}>
        <OutlineNavigationProvider dockable contentVersion={1}>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    expect(screen.getByTestId('heading-count').textContent).toBe('3');
  });

  it('reveals headings inside collapsed toggles before scrolling to the anchor', async () => {
    const editor = withReact(createEditor());
    const initialValue = [
      value()[0],
      {
        type: BlockType.ToggleListBlock,
        blockId: 'toggle',
        data: { collapsed: true },
        children: [{ type: YjsEditorKey.text, children: [{ text: 'Details' }] }, value()[1]],
      },
    ] as Descendant[];

    render(
      <Slate editor={editor} initialValue={initialValue}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    });
    expect(editor.children[1]).toMatchObject({ data: { collapsed: false } });
    expect(headingElements[1].scrollIntoView).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(headingElements[1].scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });
  });

  it('reflects heading edits and removal through ordinary Slate operations', async () => {
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    await act(async () => {
      Transforms.removeNodes(editor, { at: [1] });
    });
    expect(screen.getByTestId('heading-count').textContent).toBe('2');
    const remaining = editor.children[0] as OutlineHeading;

    expect(remaining.blockId).toBe('section-1');
  });
});
