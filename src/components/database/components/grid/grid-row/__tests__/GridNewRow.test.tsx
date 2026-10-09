import { fireEvent, render, screen } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';

import GridNewRow from '../GridNewRow';

const newRow = jest.fn(async () => 'row-id');
const revealCreatedRow = jest.fn();

jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
    interpolation: { escapeValue: false },
  });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n) }) };
});

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ isDocumentBlock: false }),
  useDatabaseFields: () => undefined,
  useDatabaseView: () => undefined,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => newRow,
}));

jest.mock('@/application/database-yjs/group-row', () => ({
  getGroupRowCellsData: () => ({}),
}));

jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ lastVisibleRowId: undefined, revealCreatedRow }),
}));

/** `dashboard-parity/widget-content.json` (addendum A6), shared with desktop. */
const fixture = loadParityFixture<{ labels: { new_row_label: string } }>('widget-content.json');

describe('GridNewRow (addendum A6)', () => {
  it('reads "New page", the label both clients share', () => {
    render(<GridNewRow />);

    const button = screen.getByTestId('grid-new-row');

    expect(button.textContent).toBe('New page');
    expect(button.querySelector('[data-parity-id="dash-widget-grid-new-row__label"]')?.textContent).toBe('New page');
    expect(button.querySelector('[data-parity-id="dash-widget-grid-new-row__icon"]')).not.toBeNull();
  });

  it('takes its label from en.json grid.row.newRow, which equals the shared fixture', () => {
    expect(translations.grid.row.newRow).toBe(fixture.labels.new_row_label);
    expect(fixture.labels.new_row_label).toBe('New page');
  });

  it('adds a row at the end and reveals it', async () => {
    render(<GridNewRow />);
    fireEvent.click(screen.getByTestId('grid-new-row'));
    await Promise.resolve();
    expect(newRow).toHaveBeenCalledWith({ cellsData: {}, tailing: true });
  });
});
