import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';

import { ViewLayout } from '@/application/types';

import { createDragGhostStore } from '../arrange-stores';
import { DashboardDragGhost } from '../DashboardDragGhost';

const GHOST = {
  widgetId: 'w1',
  name: 'Tasks Board',
  layout: ViewLayout.Board,
  width: 412,
  height: 360,
  offsetX: 40,
  offsetY: 12,
};

function renderGhost() {
  const store = createDragGhostStore();
  const onRender = jest.fn();

  render(
    <Profiler id='ghost' onRender={onRender}>
      <DashboardDragGhost store={store} />
    </Profiler>
  );
  return { store, onRender };
}

const ghost = () => screen.queryByTestId('dashboard-drag-ghost');

describe('DashboardDragGhost', () => {
  it('renders nothing until a drag starts', () => {
    renderGhost();

    expect(ghost()).toBeNull();
  });

  it('replicates the dragged box at its size and 50% opacity, with its title and layout glyph, on top of the page', () => {
    const { store } = renderGhost();

    act(() => store.start(GHOST, 300, 200));
    const element = ghost() as HTMLElement;

    // Portaled to the body, outside the dashboard's scroll container.
    expect(element.parentElement).toBe(document.body);
    expect(element.getAttribute('data-widget-id')).toBe('w1');
    expect([element.style.width, element.style.height]).toEqual(['412px', '360px']);
    expect(element.className.split(' ')).toEqual(
      expect.arrayContaining(['fixed', 'left-0', 'top-0', 'pointer-events-none', 'z-[1400]', 'opacity-50'])
    );
    // Grabbed where the pointer went down.
    expect(element.style.transform).toBe('translate3d(260px, 188px, 0)');

    const box = element.firstElementChild as HTMLElement;

    expect(box.className).toContain('bg-dash-edit-tint');
    expect(box.className).toContain('rounded-500');
    expect(box.style.padding).toBe('0px 6px 6px');
    expect(screen.getByTestId('dashboard-drag-ghost-title').textContent).toBe('Tasks Board');
    expect(screen.getByTestId('dashboard-drag-ghost-title').className).toContain('text-dash-edit-title');

    // The card is the dashboard card (`dash-card-bg`, edit ring), never the page body.
    const card = screen.getByTestId('dashboard-drag-ghost-icon').parentElement as HTMLElement;

    expect(card.className).toContain('dash-card');
    expect(card.className).toContain('bg-dash-card-bg');
    expect(card.getAttribute('data-editing')).toBe('true');
    expect(card.className).not.toContain('bg-body');
    expect(screen.getByTestId('dashboard-drag-ghost-icon').getAttribute('class')).toContain('h-8 w-8');
  });

  it('follows the pointer through a style write, without a render', () => {
    const { store, onRender } = renderGhost();

    act(() => store.start(GHOST, 300, 200));
    const renders = onRender.mock.calls.length;

    act(() => {
      store.move(320, 240);
      store.move(500, 410);
    });

    expect(ghost()?.style.transform).toBe('translate3d(460px, 398px, 0)');
    expect(onRender.mock.calls.length).toBe(renders);
  });

  it('clears on drop', () => {
    const { store } = renderGhost();

    act(() => store.start(GHOST, 300, 200));
    expect(ghost()).not.toBeNull();
    act(() => store.clear());
    expect(ghost()).toBeNull();
    expect(store.get()).toBeNull();
  });
});
