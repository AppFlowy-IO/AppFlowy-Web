import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { YjsDatabaseKey } from '@/application/types';
import {
  contextOf,
  createDrillFixture,
  DatabaseWrapper,
  selectFilterPlain,
  toYFilter,
} from '@/components/database/chart/drill/__tests__/drillTestFixture';

import Filter from '../Filter';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

function renderFilter(variant?: 'default' | 'pill', parityId?: string) {
  const fixture = createDrillFixture();

  (fixture.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
    toYFilter(selectFilterPlain('f1', 'status', 'o_new')),
  ]);
  render(
    <DatabaseWrapper value={contextOf(fixture)}>
      <Filter filterId='f1' parityId={parityId} variant={variant} />
    </DatabaseWrapper>
  );
  return screen.findByTestId('database-filter-condition');
}

describe('Filter variant="pill" (the drill-down chip, WP13 §3.4)', () => {
  it('is a 24px fully rounded chip in the active pill colours with a 12px chevron', async () => {
    const chip = await renderFilter('pill', 'dash-drilldown-chip');

    expect(chip.getAttribute('data-variant')).toBe('pill');
    expect(chip.className).toContain('h-6');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('bg-dash-pill-bg-active');
    expect(chip.className).toContain('text-dash-pill-fg-active');
    expect(chip.getAttribute('data-parity-id')).toBe('dash-drilldown-chip');
    const chevron = chip.querySelector('[data-testid="filter-chip-chevron"]') as Element;

    expect(chevron.getAttribute('class')).toContain('h-3 w-3');
    expect(chip.lastElementChild).toBe(chevron);
    expect(chip.textContent).toContain('Status');
    // Still the editable chip: it opens the filter editor.
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('leaves the default chip as it was', async () => {
    const chip = await renderFilter();

    expect(chip.getAttribute('data-variant')).toBeNull();
    expect(chip.className).toContain('h-7');
    expect(chip.className).toContain('border');
    expect(chip.getAttribute('data-parity-id')).toBeNull();
  });
});
