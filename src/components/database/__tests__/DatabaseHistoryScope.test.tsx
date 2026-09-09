import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it.each(['inline', 'portaled'])('keeps history ownership after clicking a non-focusable %s surface', async (surface) => {
    render(
      <DatabaseHistoryScope>
        <input aria-label='Cell editor' />
        <span data-testid='inline-database-surface'>Database surface</span>
        <PortaledSurface />
      </DatabaseHistoryScope>
    );
    const input = screen.getByRole('textbox');

    act(() => input.focus());
    fireEvent.pointerDown(screen.getByTestId(`${surface}-database-surface`));
    // Browsers drain microtasks after pointerdown, before mousedown blurs the input.
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.mouseDown(screen.getByTestId(`${surface}-database-surface`));
    fireEvent.blur(input, { relatedTarget: null });

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: true,
      ignoreInput: true,
      useLatest: true,
    });
  });

  it('clears history ownership when a click outside blurs the input without a new focus target', () => {
    render(
      <>
        <DatabaseHistoryScope>
          <input aria-label='Cell editor' />
        </DatabaseHistoryScope>
        <span data-testid='outside-surface'>Outside surface</span>
      </>
    );
    const input = screen.getByRole('textbox');

    act(() => input.focus());
    fireEvent.pointerDown(screen.getByTestId('outside-surface'));
    fireEvent.blur(input, { relatedTarget: null });

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });
  });

  it('clears history ownership when keyboard focus moves outside the database', () => {
    render(
      <>
        <DatabaseHistoryScope>
          <input aria-label='Cell editor' />
        </DatabaseHistoryScope>
        <button>Outside database</button>
      </>
    );

    act(() => screen.getByRole('textbox').focus());
    act(() => screen.getByRole('button').focus());

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });
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
