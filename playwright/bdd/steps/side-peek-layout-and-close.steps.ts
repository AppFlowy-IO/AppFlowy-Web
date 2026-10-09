import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  activeSidePeekPage,
  expectPeekOpen,
  PEEK_MENU_TEST_IDS,
  peekResizer,
  readPeekWidth,
  sidePeekState,
  type PeekMenuItem,
} from '../../support/side-peek-helpers';

// Reused steps defined elsewhere (do not redefine):
// - the shared side peek library: sign-in, grids, opening rows, modes, close,
//   resizer, viewport, persistence (side-peek.steps.ts)
// - 'I open the comments panel from the page header', 'I close the comments panel',
//   'the comments panel is closed' (inline-comment.steps.ts)

const { Then, When } = createBdd();

/** Mirrors RowPeekLayout: the page beside the peek keeps at least this much room. */
const MIN_PAGE_WIDTH = 320;

const PEEK_MODE_OPTIONS: readonly PeekMenuItem[] = ['Side peek', 'Center peek'];

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

/** The "Open page in" dropdown, told apart from other open menus by its Side peek item. */
function peekModeMenu(page: Page): Locator {
  return page.locator('[data-slot="dropdown-menu-content"]').filter({ has: page.getByTestId('row-peek-mode-side') });
}

/** Options: Side peek, Center peek. */
function peekModeOption(page: Page, option: string): Locator {
  const testId = PEEK_MENU_TEST_IDS[assertOneOf(option, PEEK_MODE_OPTIONS, 'Menu option')];

  if (!testId) throw new Error(`The "${option}" option has no test id`);
  return peekModeMenu(page).getByTestId(testId);
}

/**
 * The width the layout offers the peek: the viewport minus the outline drawer
 * (the page content is translated by its width) and the right-hand panels
 * (the side slot is inset by their width).
 */
async function availablePeekWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layout = document.querySelector('.appflowy-layout');
    const slot = document.querySelector('[data-testid="database-side-peek"]');

    if (!(layout instanceof HTMLElement) || !(slot instanceof HTMLElement)) {
      throw new Error('The page layout and the side peek slot must both be rendered');
    }

    const leftOffset = layout.getBoundingClientRect().left;
    const rightOffset = parseFloat(getComputedStyle(slot).right) || 0;

    return window.innerWidth - leftOffset - rightOffset;
  });
}

// ---------------------------------------------------------------------------
// The "Open page in" menu
// ---------------------------------------------------------------------------

When('I open the peek mode menu', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await active.getByTestId('row-peek-mode-menu').click();
  await expect(peekModeMenu(active)).toBeVisible({ timeout: 10_000 });
});

Then('the peek mode menu is open', async ({ page }) => {
  await expect(peekModeMenu(activeSidePeekPage(page))).toBeVisible();
});

Then('the peek mode menu is closed', async ({ page }) => {
  await expect(peekModeMenu(activeSidePeekPage(page))).toHaveCount(0, { timeout: 10_000 });
});

/** A raw key press, unlike the close steps: the open menu must own Escape, not the peek. */
When('I press Escape while the peek mode menu is open', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await expect(peekModeMenu(active)).toBeVisible();
  await active.keyboard.press('Escape');
});

/** Radix marks a disabled item with aria-disabled. */
Then('the {string} option of the peek mode menu is {word}', async ({ page }, option: string, state: string) => {
  const item = peekModeOption(activeSidePeekPage(page), option);

  await expect(item).toBeVisible();
  if (assertOneOf(state, ['enabled', 'disabled'], 'Option state') === 'disabled') {
    await expect(item).toHaveAttribute('aria-disabled', 'true');
  } else {
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  }
});

/** Unlike 'I switch the open row to {string}', this expects the menu to be open already. */
When('I choose {string} from the open peek mode menu', async ({ page }, option: string) => {
  const active = activeSidePeekPage(page);

  await peekModeOption(active, option).click();
  await expect(peekModeMenu(active)).toHaveCount(0, { timeout: 10_000 });
  await expectPeekOpen(active, option === 'Side peek' ? 'side' : 'center');
});

// ---------------------------------------------------------------------------
// Side slot width limits
// ---------------------------------------------------------------------------

/** Snapshot for the shared 'the side peek is {word} than before' comparison. */
When('I remember the side peek width', async ({ page }) => {
  sidePeekState(page).peekWidthBefore = await readPeekWidth(activeSidePeekPage(page));
});

Then('the side peek minimum width is {int} px', async ({ page }, pixels: number) => {
  const active = activeSidePeekPage(page);

  await expect(peekResizer(active)).toHaveAttribute('aria-valuemin', String(pixels));
  expect(await readPeekWidth(active)).toBeGreaterThanOrEqual(pixels);
});

/**
 * The cap is two thirds of the available width while that leaves the page its
 * minimum, which holds from 960 px of available width upwards.
 */
Then('the side peek maximum width is two thirds of the available width', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const available = await availablePeekWidth(active);

  if (available < 3 * MIN_PAGE_WIDTH) {
    throw new Error(`Only ${available}px is available, so the ${MIN_PAGE_WIDTH}px page minimum caps the peek instead`);
  }

  // The panels animate the layout, so let the cap settle instead of reading it once.
  await expect
    .poll(
      async () => {
        const twoThirds = Math.round(((await availablePeekWidth(active)) * 2) / 3);
        const maximum = Number(await peekResizer(active).getAttribute('aria-valuemax'));

        return Math.abs(maximum - twoThirds) <= 1 ? 'two thirds' : `${maximum}px instead of ${twoThirds}px`;
      },
      { timeout: 15_000, message: 'Waiting for the side peek cap to settle at two thirds of the available width' }
    )
    .toBe('two thirds');
});
