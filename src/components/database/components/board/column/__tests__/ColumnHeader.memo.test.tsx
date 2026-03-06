/**
 * Tests for ColumnHeader optimizations:
 * 1. React.memo — prevents re-renders on unchanged props
 * 2. useMemo on style objects — prevents new object refs causing child re-renders
 */
import { render } from '@testing-library/react';
import React from 'react';

import ColumnHeader from '../ColumnHeader';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/application/database-yjs', () => ({
  useReadOnly: jest.fn().mockReturnValue(false),
}));

jest.mock('../useColumnHeaderDrag', () => ({
  useColumnHeaderDrag: jest.fn().mockReturnValue({
    columnRef: { current: null },
    headerRef: { current: null },
    state: { type: 'IDLE' },
    isDragging: false,
  }),
  StateType: { IS_COLUMN_OVER: 'IS_COLUMN_OVER' },
}));

jest.mock('../ColumnHeaderPrimitive', () =>
  jest.fn(({ style }: { style: React.CSSProperties }) => (
    <div data-testid="column-header-primitive" data-cursor={style?.cursor} />
  ))
);

jest.mock('@/components/database/components/board/drag-and-drop/DropColumnIndicator', () => ({
  DropColumnIndicator: jest.fn(() => null),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

const defaultProps = {
  id: 'col-1',
  fieldId: 'field-1',
  rowCount: 5,
  addCardBefore: jest.fn(),
  getCards: jest.fn().mockReturnValue([]),
  groupId: 'group-1',
};

describe('ColumnHeader — memo + style memoization', () => {
  it('is wrapped with React.memo', () => {
    expect((ColumnHeader as any).$$typeof?.toString()).toContain('memo');
  });

  it('renders without crashing', () => {
    const { getByTestId } = render(<ColumnHeader {...defaultProps} />);
    expect(getByTestId('column-header-primitive')).toBeTruthy();
  });

  it('applies grab cursor when not dragging and not readOnly', () => {
    const { getByTestId } = render(<ColumnHeader {...defaultProps} />);
    expect(getByTestId('column-header-primitive').dataset.cursor).toBe('grab');
  });

  it('applies default cursor when readOnly', () => {
    const { useReadOnly } = require('@/application/database-yjs');
    useReadOnly.mockReturnValueOnce(true);
    const { getByTestId } = render(<ColumnHeader {...defaultProps} />);
    expect(getByTestId('column-header-primitive').dataset.cursor).toBe('default');
  });

  it('applies grabbing cursor when dragging', () => {
    const { useColumnHeaderDrag } = require('../useColumnHeaderDrag');
    useColumnHeaderDrag.mockReturnValueOnce({
      columnRef: { current: null },
      headerRef: { current: null },
      state: { type: 'IDLE' },
      isDragging: true,
    });
    const { getByTestId } = render(<ColumnHeader {...defaultProps} />);
    expect(getByTestId('column-header-primitive').dataset.cursor).toBe('grabbing');
  });

  it('does not re-render when props are unchanged (memo check)', () => {
    const renderCount = { count: 0 };
    const OriginalColumnHeaderPrimitive = require('../ColumnHeaderPrimitive');

    OriginalColumnHeaderPrimitive.default.mockImplementation(({ style }: any) => {
      renderCount.count++;
      return <div data-testid="column-header-primitive" data-cursor={style?.cursor} />;
    });

    const { rerender } = render(<ColumnHeader {...defaultProps} />);
    const initial = renderCount.count;

    rerender(<ColumnHeader {...defaultProps} />);
    // With React.memo, the inner mock should not be called again
    expect(renderCount.count).toBe(initial);
  });
});
