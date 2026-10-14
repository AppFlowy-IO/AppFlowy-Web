import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { UnavailableMenuItem } from '../UnavailableMenuItem';

mockResizeObserver();

const reason = "Your administrator hasn't allowed you to create workspaces.";

function Menu({ unavailable }: { unavailable: 'disabled-item' | 'unavailable-item' }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger>Workspaces</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Existing workspace</DropdownMenuItem>
        {unavailable === 'disabled-item' ? (
          <DropdownMenuItem disabled>Create workspace</DropdownMenuItem>
        ) : (
          <UnavailableMenuItem icon={null} label='Create workspace' reason={reason} />
        )}
        <DropdownMenuItem>Settings</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function focusFirstItem() {
  const trigger = screen.getByRole('button', { name: 'Workspaces' });

  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const first = await screen.findByRole('menuitem', { name: 'Existing workspace' });

  await waitFor(() => expect(document.activeElement).toBe(first));
  return first;
}

test('arrow keys skip a disabled Radix item, so a reason placed on one is unreachable', async () => {
  render(<Menu unavailable='disabled-item' />);
  fireEvent.keyDown(await focusFirstItem(), { key: 'ArrowDown' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Settings' })));
});

test('an unavailable entry is reached by arrow keys, explains why, and does nothing when chosen', async () => {
  render(<Menu unavailable='unavailable-item' />);
  fireEvent.keyDown(await focusFirstItem(), { key: 'ArrowDown' });
  const entry = screen.getByRole('menuitem', { name: 'Create workspace' });

  await waitFor(() => expect(document.activeElement).toBe(entry));
  expect(entry.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(entry.getAttribute('aria-describedby') ?? '')?.textContent).toBe(reason);
  fireEvent.keyDown(entry, { key: 'Enter' });
  // Choosing it keeps the menu open on the same entry instead of starting the action.
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(document.activeElement).toBe(entry);
});

test('an unavailable entry does not look clickable: no fill under the pointer, a not-allowed cursor', async () => {
  render(<Menu unavailable='unavailable-item' />);
  await focusFirstItem();
  const classes = screen.getByRole('menuitem', { name: 'Create workspace' }).className.split(/\s+/);

  // Radix focuses the item under the pointer, so the focus fill is what a hover shows.
  expect(classes).toEqual(expect.arrayContaining(['cursor-not-allowed', 'hover:bg-transparent', 'focus:bg-transparent']));
  // Keyboard users still see where they are.
  expect(classes).toContain('focus-visible:bg-fill-content-hover');
});

test('its reason opens beside the menu, clear of the menu border', async () => {
  render(<Menu unavailable='unavailable-item' />);
  fireEvent.keyDown(await focusFirstItem(), { key: 'ArrowDown' });
  await screen.findAllByText(reason);

  // jsdom lays nothing out, so the tooltip's position is just its offset from the entry: the menu's
  // 8px padding and 1px border, and a gap.
  await waitFor(() => {
    const wrapper = document.querySelector('[data-slot="tooltip-content"]')?.closest<HTMLElement>(
      '[data-radix-popper-content-wrapper]'
    );

    expect(wrapper?.style.transform).toMatch(/^translate\((1[3-9]|2\d)px, /);
  });
});
