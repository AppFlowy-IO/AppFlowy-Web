import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { RowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import { RowPeekSurface } from '@/components/database/row-peek/RowPeekSurface';

import { ChartDrillDialog } from '../ChartDrillDialog';

let mockOpenRow: () => void;

jest.mock('../ChartDrillContent', () => ({
  ChartDrillContent: ({ onClose }: { onClose: () => void }) => (
    <>
      <button onClick={() => mockOpenRow()}>Open row</button>
      <button onClick={onClose}>Close preview</button>
    </>
  ),
  useDrillMobileContext: () => false,
}));
jest.mock('@/components/database/row-peek/side-peek-width', () => ({
  loadSidePeekWidth: async () => undefined,
  saveSidePeekWidth: async () => undefined,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      key === 'grid.rowPage.sidePeek' ? 'Side peek' : options?.defaultValue ?? key,
  }),
}));

function Draft() {
  const [value, setValue] = useState('Original title');

  return <input aria-label='Row title' value={value} onChange={(event) => setValue(event.target.value)} />;
}

function Fixture({ onPreviewClose }: { onPreviewClose?: () => void }) {
  const [preview, setPreview] = useState(true);
  const [row, setRow] = useState(false);
  const [mode, setMode] = useState<'side' | 'center'>('side');

  mockOpenRow = () => setRow(true);

  return (
    <RowPeekLayout>
      <button onClick={() => setPreview(true)}>Open preview</button>
      {preview && (
        <ChartDrillDialog
          target={{ xKey: 'bucket', xLabel: 'Bucket', xIsEmpty: false, rowIds: ['row'] }}
          title='Bucket'
          onClose={() => {
            onPreviewClose?.();
            setPreview(false);
          }}
        />
      )}
      {row && (
        <RowPeekSurface
          mode={mode}
          open
          onClose={() => setRow(false)}
          closeImmediately={() => setRow(false)}
          prepare={async () => true}
        >
          <div data-testid='row-detail'>
            <Draft />
            <button onClick={() => setRow(false)}>Close row</button>
            <button onClick={() => setMode(mode === 'side' ? 'center' : 'side')}>Switch peek mode</button>
          </div>
        </RowPeekSurface>
      )}
    </RowPeekLayout>
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
});

it('keeps a row opened from the preview accessible and preserves its draft when the preview closes', async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: 'Open row' }));

  await screen.findByRole('dialog', { name: 'Side peek' });
  const input = screen.getByRole('textbox', { name: 'Row title' });

  fireEvent.change(input, { target: { value: 'Unsaved title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Table data preview' })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Side peek' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Row title' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Unsaved title');

  fireEvent.click(screen.getByRole('button', { name: 'Open preview' }));
  await screen.findByRole('dialog', { name: 'Table data preview' });
  await screen.findByRole('dialog', { name: 'Side peek' });
  expect(screen.getByRole('textbox', { name: 'Row title' })).toBe(input);
});

it('keeps the row accessible and its draft intact when switching peek modes above the preview', async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: 'Open row' }));
  await screen.findByRole('dialog', { name: 'Side peek' });
  const input = screen.getByRole('textbox', { name: 'Row title' });

  fireEvent.change(input, { target: { value: 'Unsaved title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Switch peek mode' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Side peek' })).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Row title' })).toBe(input);

  fireEvent.click(screen.getByRole('button', { name: 'Switch peek mode' }));
  await screen.findByRole('dialog', { name: 'Side peek' });
  expect(screen.getByRole('textbox', { name: 'Row title' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Unsaved title');
});

it('leaves Escape to the open row and lets the preview close after the row closes', async () => {
  const onPreviewClose = jest.fn();

  render(<Fixture onPreviewClose={onPreviewClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open row' }));
  await screen.findByTestId('row-detail');

  act(() => (document.activeElement as HTMLElement).blur());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onPreviewClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Table data preview' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close row' }));
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  act(() => (document.activeElement as HTMLElement).blur());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Table data preview' })).toBeNull());
});
