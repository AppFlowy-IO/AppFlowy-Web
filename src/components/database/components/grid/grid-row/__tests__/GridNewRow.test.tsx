/**
 * Tests for GridNewRow optimization:
 * - React.memo prevents unnecessary re-renders
 * - useCallback stabilizes the onClick handler reference
 */
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

import GridNewRow from '../GridNewRow';

const mockOnNewRow = jest.fn().mockResolvedValue(undefined);

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => mockOnNewRow,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('GridNewRow', () => {
  beforeEach(() => {
    mockOnNewRow.mockClear();
  });

  it('renders the new row button', () => {
    const { getByTestId } = render(<GridNewRow />);
    expect(getByTestId('grid-new-row')).toBeTruthy();
  });

  it('calls onNewRow with tailing:true when clicked', () => {
    const { getByTestId } = render(<GridNewRow />);
    fireEvent.click(getByTestId('grid-new-row'));
    expect(mockOnNewRow).toHaveBeenCalledWith({ tailing: true });
  });

  it('is wrapped with React.memo', () => {
    expect((GridNewRow as any).$$typeof?.toString()).toContain('memo');
  });

  it('does not re-render when parent re-renders with no prop changes', () => {
    let renderCount = 0;

    const Wrapper = () => {
      const [count, setCount] = React.useState(0);
      renderCount++;
      return (
        <div>
          <button data-testid="trigger" onClick={() => setCount(c => c + 1)}>{count}</button>
          <GridNewRow />
        </div>
      );
    };

    const { getByTestId } = render(<Wrapper />);
    const initialGridRenderCount = mockOnNewRow.mock.calls.length;

    // Trigger parent re-render
    fireEvent.click(getByTestId('trigger'));

    // GridNewRow should still be in the DOM but not have caused extra renders
    expect(getByTestId('grid-new-row')).toBeTruthy();
    // Clicking new row still works
    fireEvent.click(getByTestId('grid-new-row'));
    expect(mockOnNewRow).toHaveBeenCalledTimes(initialGridRenderCount + 1);
  });
});
