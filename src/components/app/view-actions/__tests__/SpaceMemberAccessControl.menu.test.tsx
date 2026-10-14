import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AccessLevel } from '@/application/types';

import { SpaceMemberAccessControl } from '../SpaceMemberAccessControl';

// Uses the real Radix menu (the Manage Space tests flatten it) to check how the explanation of
// your own access reaches screen readers.
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const NOTE = 'You can also edit this space through the Marketing group.';

beforeAll(() => {
  global.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});

function control(note: string | null) {
  return (
    <SpaceMemberAccessControl
      value={AccessLevel.ReadOnly}
      effectiveAccess={AccessLevel.ReadOnly}
      defaultAccess={AccessLevel.ReadAndWrite}
      disabled={false}
      pending={false}
      principalName='Nathan'
      testId='own-access'
      onChange={jest.fn()}
      note={note}
    />
  );
}

async function openMenu() {
  fireEvent.keyDown(screen.getByTestId('own-access'), { key: 'ArrowDown' });
  return screen.findByRole('menu');
}

describe('the explanation in your own Access menu', () => {
  it('describes the menu when it is there as the menu opens', async () => {
    render(control(NOTE));
    const menu = await openMenu();
    const note = within(menu).getByTestId('own-access-note');

    expect(note.textContent).toBe(NOTE);
    expect(menu.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('is read out when it arrives while the menu is open', async () => {
    const view = render(control(null));
    const menu = await openMenu();
    const region = within(menu).getByTestId('own-access-note-region');

    // A polite live region is already in place, empty, before the explanation arrives.
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(menu.hasAttribute('aria-describedby')).toBe(false);

    view.rerender(control(NOTE));

    expect(within(menu).getByTestId('own-access-note-region')).toBe(region);
    expect(region.textContent).toBe(NOTE);
    expect(menu.getAttribute('aria-describedby')).toBe(within(region).getByTestId('own-access-note').id);
  });

  it('adds no empty line to a menu without an explanation', async () => {
    render(control(null));
    const menu = await openMenu();

    expect(within(menu).queryByTestId('own-access-note')).toBeNull();
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });
});

describe('your extra access while the menu is closed', () => {
  it('shows an info icon next to the closed menu that says where the extra access comes from', async () => {
    render(control(NOTE));
    const hint = screen.getByTestId('own-access-extra-access');

    // Seen in the table without opening the menu, and named for screen readers.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hint.getAttribute('aria-label')).toBe(NOTE);
    expect(hint.getAttribute('type')).toBe('button');
    act(() => hint.focus());
    expect((await screen.findByRole('tooltip')).textContent).toContain(NOTE);
  });

  it('adds nothing when there is no extra access', () => {
    render(control(null));
    expect(screen.queryByTestId('own-access-extra-access')).toBeNull();
  });
});
