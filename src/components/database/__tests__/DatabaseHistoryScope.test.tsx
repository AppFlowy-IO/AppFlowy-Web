import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';

import { useDatabaseContext } from '@/application/database-yjs';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/components/database/hooks/useDatabaseRowHistoryHotkeys', () => ({
  useDatabaseRowHistoryHotkeys: jest.fn(),
}));

const mockUseDatabaseContext = jest.mocked(useDatabaseContext);
const mockUseDatabaseRowHistoryHotkeys = jest.mocked(useDatabaseRowHistoryHotkeys);

function PortaledSurface() {
  return createPortal(<span data-testid='portaled-database-surface'>Portaled database surface</span>, document.body);
}

describe('DatabaseHistoryScope', () => {
  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({ readOnly: false } as ReturnType<typeof useDatabaseContext>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps keyboard history ownership for portaled descendants', () => {
    render(
      <>
        <DatabaseHistoryScope>
          <PortaledSurface />
        </DatabaseHistoryScope>
        <span data-testid='outside-surface'>Outside surface</span>
      </>
    );

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });

    fireEvent.pointerDown(screen.getByTestId('portaled-database-surface'));

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: true,
      ignoreInput: true,
      useLatest: true,
    });

    fireEvent.pointerDown(screen.getByTestId('outside-surface'));

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });
  });
});
