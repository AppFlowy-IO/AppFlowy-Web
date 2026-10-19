import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { HoverControlsProvider } from '@/components/database/components/grid/controls/HoverControlsContext';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import RowMenu from '../RowMenu';

const mockDuplicateRow = jest.fn<Promise<void>, []>();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../HoverControls.hooks', () => {
  const { useRowCreationAction } = jest.requireActual('@/components/database/hooks/useRowCreationAction');

  return {
    useHoverControlsActions: () => {
      const { pending, run } = useRowCreationAction();

      return {
        addAboveLoading: false,
        addBelowLoading: false,
        duplicateLoading: pending,
        onAddRowAbove: jest.fn(),
        onAddRowBelow: jest.fn(),
        onDuplicateRow: () => run(mockDuplicateRow),
      };
    },
  };
});

jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  __esModule: true,
  default: () => null,
}));

function OpenRowMenu() {
  const [open, setOpen] = useState(true);

  return (
    <HoverControlsProvider value={{ showPreventDialog: (continueFn) => continueFn() }}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger>row menu</DropdownMenuTrigger>
        <RowMenu onClose={() => setOpen(false)} rowId='row-a' />
      </DropdownMenu>
    </HoverControlsProvider>
  );
}

describe('RowMenu', () => {
  beforeEach(() => {
    mockDuplicateRow.mockReset();
  });

  it('keeps the menu open on the duplicate spinner until the copy commits', async () => {
    let commit!: () => void;

    mockDuplicateRow.mockReturnValueOnce(new Promise<void>((resolve) => (commit = resolve)));
    render(<OpenRowMenu />);

    fireEvent.click(await screen.findByTestId('row-menu-duplicate'));

    await waitFor(() => expect(screen.getByTestId('row-menu-duplicate').querySelector('circle')).not.toBeNull());
    expect(screen.getByTestId('row-menu-delete')).toBeTruthy();

    // A second click on the pending item neither duplicates again nor closes the menu.
    fireEvent.click(screen.getByTestId('row-menu-duplicate'));
    expect(mockDuplicateRow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('row-menu-delete')).toBeTruthy();

    commit();
    await waitFor(() => expect(screen.queryByTestId('row-menu-duplicate')).toBeNull());
  });

  it('closes the menu after a failed duplicate', async () => {
    mockDuplicateRow.mockRejectedValueOnce(new Error('offline'));
    render(<OpenRowMenu />);

    fireEvent.click(await screen.findByTestId('row-menu-duplicate'));

    await waitFor(() => expect(screen.queryByTestId('row-menu-duplicate')).toBeNull());
  });
});
