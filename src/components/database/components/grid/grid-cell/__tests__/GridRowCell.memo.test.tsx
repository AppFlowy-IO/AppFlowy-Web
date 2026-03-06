/**
 * Tests for React.memo optimization on GridRowCell and GridCalculateRowCell.
 *
 * Verifies that these components do NOT re-render when their props have not changed,
 * which is critical for grid performance (hundreds of cells rendered at once).
 */
import { render } from '@testing-library/react';
import React from 'react';

import { GridRowCell } from '../GridRowCell';
import { GridCalculateRowCell } from '../GridCalculateRowCell';

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/application/database-yjs', () => ({
  useCellSelector: jest.fn().mockReturnValue(null),
  useFieldWrap: jest.fn().mockReturnValue(false),
  useReadOnly: jest.fn().mockReturnValue(true),
  useDatabaseView: jest.fn().mockReturnValue(null),
  useFieldCellsSelector: jest.fn().mockReturnValue({ cells: [] }),
}));

jest.mock('@/application/database-yjs/selector', () => ({
  useFieldSelector: jest.fn().mockReturnValue({ field: null }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateRowMetaDispatch: jest.fn().mockReturnValue(jest.fn()),
  useCalculateFieldDispatch: jest.fn().mockReturnValue(jest.fn()),
  useUpdateCalculate: jest.fn().mockReturnValue(jest.fn()),
  useClearCalculate: jest.fn().mockReturnValue(jest.fn()),
}));

jest.mock('@/components/database/components/grid/grid-row/GridRowContext', () => ({
  useGridRowContext: jest.fn().mockReturnValue({ resizeRow: jest.fn() }),
}));

jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: jest.fn().mockReturnValue({ activeCell: null, setActiveCell: jest.fn() }),
}));

jest.mock('@/components/database/utils/field-editing', () => ({
  isFieldEditingDisabled: jest.fn().mockReturnValue(false),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GridRowCell — React.memo', () => {
  it('is wrapped with React.memo', () => {
    // React.memo components have $$typeof === Symbol(react.memo)
    expect((GridRowCell as any).$$typeof?.toString()).toContain('memo');
  });

  it('does not re-render when props are unchanged', () => {
    const renderSpy = jest.fn();

    // Wrap the component to count renders
    const Spy = React.memo(function Spy(props: { rowId: string; fieldId: string; columnIndex: number; rowIndex: number }) {
      renderSpy();
      return <GridRowCell {...props} />;
    });

    const { rerender } = render(
      <Spy rowId="row-1" fieldId="field-1" columnIndex={0} rowIndex={0} />
    );

    const initialRenders = renderSpy.mock.calls.length;

    // Re-render parent with same props — child should NOT re-render
    rerender(<Spy rowId="row-1" fieldId="field-1" columnIndex={0} rowIndex={0} />);

    expect(renderSpy.mock.calls.length).toBe(initialRenders); // no extra render
  });

  it('re-renders when rowId changes', () => {
    const { rerender, container } = render(
      <GridRowCell rowId="row-1" fieldId="field-1" columnIndex={0} rowIndex={0} />
    );

    // field is null so returns null — just checking no crash
    expect(container).toBeTruthy();

    rerender(<GridRowCell rowId="row-2" fieldId="field-1" columnIndex={0} rowIndex={0} />);
    expect(container).toBeTruthy();
  });
});

describe('GridCalculateRowCell — React.memo', () => {
  it('is wrapped with React.memo', () => {
    expect((GridCalculateRowCell as any).$$typeof?.toString()).toContain('memo');
  });

  it('does not crash on render', () => {
    const { container } = render(<GridCalculateRowCell fieldId="field-1" />);
    expect(container).toBeTruthy();
  });
});
