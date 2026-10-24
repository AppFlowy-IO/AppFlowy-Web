import { render, screen } from '@testing-library/react';
import { ReactElement } from 'react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import { createWidgetContextValue } from '@/components/database/dashboard/__tests__/dashboardTestHarness';
import { WidgetFilterTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetFilterTool';
import { WidgetSearchTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetSearchTool';
import { WidgetSortTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetSortTool';
import { WidgetContext } from '@/components/database/dashboard/WidgetContext';

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Person: 7, Rollup: 10 },
  useFiltersSelector: () => [],
  useConditionsReadOnly: () => false,
  useSortsSelector: () => [],
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddFilter: () => jest.fn(),
  useAddSort: () => jest.fn(),
}));

jest.mock('@/components/database/components/conditions/context', () => ({
  useConditionsContext: () => ({}),
}));

jest.mock('@/components/database/components/conditions/PropertiesMenu', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/dashboard/WidgetConditionsPopover', () => ({
  WidgetConditionsPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/sorts/utils', () => ({
  useRollupSortableIds: () => new Set<string>(),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'grid.settings.filter': 'Filter',
        'grid.settings.sort': 'Sort',
        'search.label': 'Search',
      }[key] ?? key),
  }),
}));

describe('Gallery compact condition actions', () => {
  it.each([
    ['Filter', <FiltersButton compact key='filter' />, 'database-actions-filter'],
    ['Sort', <SortsButton compact key='sort' />, 'database-actions-sort'],
  ])('renders the %s action as an accessible 24px button', (label, action, testId) => {
    render(action);

    const button = screen.getByTestId(testId);

    expect(button.getAttribute('aria-label')).toBe(label);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('h-6');
    expect(button.className).toContain('w-6');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

/** A widget tool inside its widget (View mode unless `editing`). */
function inWidget(tool: ReactElement, editing = false) {
  return <WidgetContext.Provider value={createWidgetContextValue({ editing })}>{tool}</WidgetContext.Provider>;
}

describe('Dashboard widget condition tools', () => {
  it.each([
    ['Filter', () => <WidgetFilterTool />, 'database-actions-filter', 'dash-widget-tool-filter'],
    ['Sort', () => <WidgetSortTool />, 'database-actions-sort', 'dash-widget-tool-sort'],
  ])('renders the %s tool as a quiet 24px button with a 16px glyph', (label, tool, testId, parityId) => {
    render(inWidget(tool()));

    const button = screen.getByTestId(testId);
    const glyphs = button.querySelectorAll('svg');

    expect(button.getAttribute('aria-label')).toBe(label);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(false);
    // Icon only: one hidden glyph, which the parity probe measures with the button.
    expect(button.textContent).toBe('');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute('aria-hidden')).toBe('true');
    expect(glyphs[0].getAttribute('data-parity-id')).toBe(`${parityId}__icon`);
    expect(button.getAttribute('data-active')).toBe('false');
    expect(button.getAttribute('data-parity-id')).toBe(parityId);
    // The toolbar's blue inline color is for standalone views only.
    expect(button.style.color).toBe('');
  });

  it.each([
    ['Filter', () => <WidgetFilterTool />, 'database-actions-filter'],
    ['Sort', () => <WidgetSortTool />, 'database-actions-sort'],
  ])('turns the %s tool accent in Edit mode', (_label, tool, testId) => {
    const { rerender } = render(inWidget(tool()));
    const viewModeLook = screen.getByTestId(testId).className;

    rerender(inWidget(tool(), true));
    // Edit mode alone restyles the tool: no rule made it active.
    expect(screen.getByTestId(testId).className).not.toBe(viewModeLook);
    expect(screen.getByTestId(testId).getAttribute('data-active')).toBe('false');
  });

  it('renders the Search tool (WP09) as a quiet 24px button with a 16px glyph', () => {
    render(inWidget(<WidgetSearchTool />));

    const button = screen.getByTestId('database-actions-search');
    const glyphs = button.querySelectorAll('svg');

    expect(button.getAttribute('aria-label')).toBe('Search');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe('');
    expect(button.className).toContain('h-6');
    expect(button.className).toContain('w-6');
    expect(button.className).toContain('!rounded-200');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute('class')).toContain('h-4');
    expect(glyphs[0].getAttribute('data-parity-id')).toBe('dash-widget-tool-search__icon');
    expect(button.getAttribute('data-parity-id')).toBe('dash-widget-tool-search');
  });

  it('keeps the standalone toolbar buttons free of the widget attributes', () => {
    render(<FiltersButton compact />);

    expect(screen.getByTestId('database-actions-filter').hasAttribute('data-active')).toBe(false);
    expect(screen.getByTestId('database-actions-filter').hasAttribute('data-parity-id')).toBe(false);
  });
});
