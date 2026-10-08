import { act, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Descendant, Transforms } from 'slate';
import { ReactEditor, Slate, withReact } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, MentionType, YjsEditorKey } from '@/application/types';

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
      <output data-testid='heading-labels'>{headings.map((heading) => heading.data.text).join('|')}</output>
      <output data-testid='active-heading'>{activeId}</output>
      <button onClick={() => jumpToHeading(headings[1])}>Jump</button>
      <button onClick={() => jumpToHeading(headings[0])}>Jump first</button>
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
    disconnect.mockClear();
    scroller = document.createElement('div');
    scroller.className = 'appflowy-scroll-container';
    root = document.createElement('div');
    scroller.append(root);
    document.body.append(scroller);
    tops = [10, 300, 700];
    headingElements = [1, 2, 3].map((index) => {
      const element = document.createElement('div');

      element.id = `heading-section-${index}`;
      element.className = 'heading';
      element.dataset.blockType = BlockType.HeadingBlock;
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

  it('switches the selected heading at the document bottom even when all headings are already visible', () => {
    Object.defineProperties(scroller, {
      clientHeight: { value: 900, configurable: true },
      scrollHeight: { value: 1100, configurable: true },
      scrollTop: { value: 200, configurable: true },
    });
    tops = [100, 200, 300];
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-3');
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    fireEvent.scroll(scroller);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    fireEvent.click(screen.getByRole('button', { name: 'Jump first' }));
    fireEvent.scroll(scroller);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-1');
  });

  it.each(['wheel', 'touchmove', 'pointerdown', 'keydown'])(
    'resumes scroll tracking when a reader uses %s during a jump',
    (input) => {
      const editor = withReact(createEditor());

      render(
        <Slate editor={editor} initialValue={value()}>
          <OutlineNavigationProvider dockable>
            <Probe />
          </OutlineNavigationProvider>
        </Slate>
      );
      act(() => {
        jest.advanceTimersByTime(20);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
      tops = [-700, -300, 48];
      fireEvent(scroller, input === 'keydown' ? new KeyboardEvent(input, { key: 'PageDown' }) : new Event(input));
      fireEvent.scroll(scroller);
      act(() => {
        jest.advanceTimersByTime(20);
      });
      expect(screen.getByTestId('active-heading').textContent).toBe('section-3');
    }
  );

  it('keeps scroll subscriptions and the clicked selection when heading labels change during or after navigation', async () => {
    Object.defineProperties(scroller, {
      clientHeight: { value: 900, configurable: true },
      scrollHeight: { value: 1100, configurable: true },
      scrollTop: { value: 200, configurable: true },
    });
    tops = [100, 200, 300];
    const subscribe = jest.spyOn(scroller, 'addEventListener');
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    act(() => {
      jest.advanceTimersByTime(20);
    });
    const observerCount = jest.mocked(ResizeObserver).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    await act(async () => {
      Transforms.insertText(editor, ' renamed', { at: { path: [1, 0, 0], offset: 9 } });
    });
    expect(screen.getByTestId('heading-labels').textContent).toContain('Section 2 renamed');
    expect(subscribe.mock.calls.filter(([event]) => event === 'scroll')).toHaveLength(1);
    expect(jest.mocked(ResizeObserver).mock.calls).toHaveLength(observerCount);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    await act(async () => {
      Transforms.insertText(editor, ' again', { at: { path: [1, 0, 0], offset: 17 } });
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('heading-labels').textContent).toContain('Section 2 renamed again');
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    fireEvent.wheel(scroller);
    fireEvent.scroll(scroller);
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-3');
  });

  it('remeasures a moved block after DOM commit even when heading order and editor height stay unchanged', async () => {
    const paragraph = document.createElement('div');

    paragraph.dataset.blockType = BlockType.Paragraph;
    root.insertBefore(paragraph, headingElements[1]);
    const initialValue = value();

    initialValue.splice(1, 0, {
      type: BlockType.Paragraph,
      blockId: 'paragraph',
      data: {},
      children: [{ type: YjsEditorKey.text, children: [{ text: 'Paragraph content' }] }],
    } as Descendant);
    const editor = withReact(createEditor());
    const subscribe = jest.spyOn(scroller, 'addEventListener');

    render(
      <Slate editor={editor} initialValue={initialValue}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-1');
    const labels = screen.getByTestId('heading-labels').textContent;

    await act(async () => {
      Transforms.moveNodes(editor, { at: [2], to: [1] });
      // Simulate the renderer committing the move; the ResizeObserver does not fire.
      root.insertBefore(headingElements[1], paragraph);
      tops[1] = 48;
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('active-heading').textContent).toBe('section-2');
    expect(screen.getByTestId('heading-labels').textContent).toBe(labels);
    expect(subscribe.mock.calls.filter(([event]) => event === 'scroll')).toHaveLength(1);
    expect(ResizeObserver).toHaveBeenCalledTimes(1);
  });

  it('does not parse heading labels in an inactive editor, and activates when an inline outline is inserted', async () => {
    const readText = jest.spyOn(CustomEditor, 'getBlockTextContent');
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value()}>
        <OutlineNavigationProvider>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    expect(readText).not.toHaveBeenCalled();
    expect(screen.getByTestId('heading-count').textContent).toBe('0');
    expect(ResizeObserver).not.toHaveBeenCalled();
    await act(async () => {
      Transforms.insertNodes(
        editor,
        {
          type: BlockType.OutlineBlock,
          blockId: 'outline',
          data: {},
          children: [{ text: '' }],
        } as Descendant,
        { at: [3] }
      );
    });
    expect(screen.getByTestId('heading-count').textContent).toBe('3');
    expect(readText).toHaveBeenCalled();
    expect(ResizeObserver).toHaveBeenCalledTimes(1);
  });

  it('starts scroll tracking only when the floating outline reaches its three-heading threshold', async () => {
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={value().slice(0, 2)}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    expect(ResizeObserver).not.toHaveBeenCalled();
    await act(async () => {
      Transforms.insertNodes(editor, value()[2], { at: [2] });
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(ResizeObserver).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('active-heading').textContent).toBe('section-1');
    await act(async () => {
      Transforms.removeNodes(editor, { at: [2] });
    });
    expect(disconnect).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
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

  it('refreshes page-mention labels and surrounding text after asynchronous rendering, without editing the document', async () => {
    const editor = withReact(createEditor());
    const initialValue = value();
    const first = initialValue[0] as { children: Descendant[] };
    const second = initialValue[1] as { children: Descendant[] };

    first.children = [
      { type: YjsEditorKey.text, children: [{ text: '@', mention: { type: MentionType.PageRef, page_id: 'desktop' } }] },
    ] as Descendant[];
    second.children = [
      {
        type: YjsEditorKey.text,
        children: [{ text: '@', mention: { type: MentionType.PageRef, page_id: 'todos' } }, { text: ' quick start' }],
      },
    ] as Descendant[];
    const mentions = ['desktop', 'todos'].map((id, index) => {
      const mention = document.createElement('span');

      mention.dataset.mentionId = id;
      headingElements[index].append(mention);
      return mention;
    });
    const { unmount } = render(
      <Slate editor={editor} initialValue={initialValue}>
        <OutlineNavigationProvider dockable>
          <Probe />
        </OutlineNavigationProvider>
      </Slate>
    );
    const originalContent = JSON.stringify(editor.children);

    expect(screen.getByTestId('heading-labels').textContent).toBe('|quick start|Section 3');
    await act(async () => {
      mentions[0].textContent = '📎Desktop guide';
      mentions[1].textContent = '✅To-dos';
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('heading-labels').textContent).toBe('📎Desktop guide|✅To-dos quick start|Section 3');
    await act(async () => {
      mentions[0].firstChild!.textContent = '📎Renamed desktop guide';
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('heading-labels').textContent).toBe(
      '📎Renamed desktop guide|✅To-dos quick start|Section 3'
    );
    expect(JSON.stringify(editor.children)).toBe(originalContent);
    unmount();
    await act(async () => {
      mentions[0].textContent = 'After unmount';
    });
    expect(jest.getTimerCount()).toBe(0);
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
