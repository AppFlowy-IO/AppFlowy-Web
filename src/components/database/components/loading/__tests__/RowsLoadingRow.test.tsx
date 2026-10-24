import { render, screen } from '@testing-library/react';

import { RowsLoadingPill, RowsLoadingRow } from '../RowsLoadingRow';

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string; loaded?: number; total?: number }) => {
    const text = options?.defaultValue ?? key;

    return text.replace('{{loaded}}', String(options?.loaded)).replace('{{total}}', String(options?.total));
  };

  return { useTranslation: () => ({ t }) };
});

describe('RowsLoadingRow', () => {
  it('is a status row that counts the rows read so far', () => {
    render(<RowsLoadingRow hydration={{ ready: 256, total: 603 }} testId='grid-loading-indicator' progressTestId='grid-loading-progress' />);

    const row = screen.getByRole('status', { name: 'Loading rows' });

    expect(row.dataset.testid).toBe('grid-loading-indicator');
    expect(row.dataset.loadedRowCount).toBe('256');
    expect(row.dataset.totalRowCount).toBe('603');
    expect(screen.getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 256/603');
  });

  it('shows only the dots without a count', () => {
    render(<RowsLoadingRow testId='grid-loading-indicator' progressTestId='grid-loading-progress' />);

    expect(screen.getByRole('status', { name: 'Loading rows' }).dataset.loadedRowCount).toBeUndefined();
    expect(screen.queryByTestId('grid-loading-progress')).toBeNull();
  });
});

describe('RowsLoadingPill', () => {
  it('is a status pill saying the rows load, floating over the view', () => {
    render(<RowsLoadingPill testId='calendar-loading-indicator' className='z-30' />);

    const pill = screen.getByRole('status');

    expect(pill.dataset.testid).toBe('calendar-loading-indicator');
    expect(pill.textContent).toBe('Loading rows…');
    expect(pill.className).toContain('absolute');
    expect(pill.className).toContain('z-30');
    expect(pill.className).not.toContain('z-10');
  });
});
