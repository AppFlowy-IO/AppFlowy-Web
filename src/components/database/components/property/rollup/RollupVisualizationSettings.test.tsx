import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CalculationType } from '@/application/database-yjs/database.type';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { RollupVisualizationSettings } from './RollupVisualizationSettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('RollupVisualizationSettings accessibility', () => {
  it('registers every setting with the menu keyboard model', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open visualization settings</DropdownMenuTrigger>
        <DropdownMenuContent>
          <RollupVisualizationSettings
            option={{
              type: RollupShowAsType.Bar,
              color: 'fill-default',
              divisor: 100,
              showNumber: false,
            }}
            calculationType={CalculationType.Sum}
            onChange={jest.fn()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'Open visualization settings' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(3));
    const showNumberItem = screen.getByRole('menuitemcheckbox', { name: 'Show number' });

    expect(showNumberItem.getAttribute('aria-checked')).toBe('false');
    expect(showNumberItem.querySelector('button')).toBeNull();

    const input = screen.getByRole('textbox', { name: 'Divide by' });
    const divideByItem = input.closest('[role="menuitem"]');

    expect(divideByItem).toBeTruthy();
    fireEvent.click(divideByItem as HTMLElement);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('registers color choices as keyboard-reachable radio items', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open visualization colors</DropdownMenuTrigger>
        <DropdownMenuContent>
          <RollupVisualizationSettings
            option={{
              type: RollupShowAsType.Ring,
              color: 'fill-default',
              divisor: 100,
              showNumber: false,
            }}
            calculationType={CalculationType.Sum}
            onChange={jest.fn()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'Open visualization colors' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const colorItem = await screen.findByRole('menuitem', { name: 'Color Default' });

    act(() => colorItem.focus());
    fireEvent.keyDown(colorItem, { key: 'ArrowRight' });
    expect(await screen.findByRole('menuitemradio', { name: 'Papaya' })).toBeTruthy();
  });
});
