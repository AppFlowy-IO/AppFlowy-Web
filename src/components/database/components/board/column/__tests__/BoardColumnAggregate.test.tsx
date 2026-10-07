import { render, screen } from '@testing-library/react';

import { boardColumnTint } from '@/application/database-yjs/board-column-color';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';
import type { BoardColumnCalculation } from '@/components/database/board/useBoardGroupCalculations';
import { BoardColumnAggregate } from '@/components/database/components/board/column/BoardColumnAggregate';
import { BoardColumnCalculationsContext } from '@/components/database/components/board/group/board-display-context';

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid='tooltip'>{children}</div>,
}));

function renderAggregate(
  calculations: ReadonlyMap<string, BoardColumnCalculation> | null,
  props: Parameters<typeof BoardColumnAggregate>[0]
) {
  return render(
    <BoardColumnCalculationsContext.Provider value={calculations}>
      <BoardColumnAggregate {...props} />
    </BoardColumnCalculationsContext.Provider>
  );
}

describe('BoardColumnAggregate (WP09 §1.6)', () => {
  it('shows the card count by default, in the secondary text colour with tabular figures', () => {
    renderAggregate(null, { columnId: 'doing', rowCount: 3 });

    const aggregate = screen.getByTestId('board-column-aggregate');

    expect(aggregate.getAttribute('data-kind')).toBe('count');
    expect(aggregate.textContent).toBe('3');
    expect(aggregate.className).toContain('text-text-secondary');
    expect(aggregate.className).toContain('tabular-nums');
    expect(aggregate.className).toContain('text-sm');
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });

  it('shows the column calculation and names it in the tooltip', () => {
    renderAggregate(new Map([['doing', { text: '$50,000', tooltip: 'Sum of Estimate' }]]), {
      columnId: 'doing',
      rowCount: 3,
    });

    const aggregate = screen.getByTestId('board-column-aggregate');

    expect(aggregate.getAttribute('data-kind')).toBe('calculation');
    expect(aggregate.textContent).toBe('$50,000');
    expect(screen.getByTestId('tooltip').textContent).toBe('Sum of Estimate');
  });

  it('shows nothing for a calculation without a value', () => {
    renderAggregate(new Map([['todo', { text: '', tooltip: 'Sum of Estimate' }]]), { columnId: 'todo', rowCount: 1 });

    const aggregate = screen.getByTestId('board-column-aggregate');

    expect(aggregate.textContent).toBe('');
    expect(aggregate.getAttribute('data-empty')).toBe('true');
  });

  it('draws in the text colour of a tinted column', () => {
    const tint = boardColumnTint(SelectOptionColor.OptionColor9);

    renderAggregate(null, { columnId: 'doing', rowCount: 3, tint });

    const aggregate = screen.getByTestId('board-column-aggregate');

    // Option colour 9 (Blue) paints with block colour 12 (`tokens.json` boardColumnTintBlockIndex).
    expect(tint?.text).toBe('var(--block-text-color-12)');
    expect(aggregate.getAttribute('data-tint')).toBe('12');
    expect(aggregate.className).not.toContain('text-text-secondary');
  });
});
