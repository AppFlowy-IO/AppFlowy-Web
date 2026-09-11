// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { VersionList } from '../DocumentHistoryVersionList';

import type { ComponentProps } from 'react';


jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function listProps(): ComponentProps<typeof VersionList> {
  return {
    versions: [
      { versionId: 'latest', parentId: 'previous', name: 'Latest version', createdAt: new Date('2026-09-11'), deletedAt: null, editors: [1] },
      { versionId: 'previous', parentId: null, name: 'Previous version', createdAt: new Date('2026-09-10'), deletedAt: null, editors: [2] },
    ],
    selectedVersionId: 'latest',
    onSelect: jest.fn(),
    isPro: false,
    dateFilter: 'all',
    onlyShowMine: false,
    onDateFilterChange: jest.fn(),
    onOnlyShowMineChange: jest.fn(),
    onRestoreClicked: jest.fn(),
    onClose: jest.fn(),
  };
}

async function openFilters() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'versionHistory.filter' }), { key: 'ArrowDown' });
  await screen.findByRole('menu');
}

test('free plans keep Only Yours available while extended date ranges remain gated', async () => {
  const props = listProps();
  const { rerender } = render(<VersionList {...props} />);

  expect(screen.getByText('versionHistory.upgrade')).toBeInTheDocument();
  await openFilters();
  expect(screen.getByRole('menuitem', { name: 'versionHistory.all' })).toBeInTheDocument();
  for (const range of ['last7Days', 'last30Days', 'last60Days']) {
    expect(screen.queryByRole('menuitem', { name: `versionHistory.${range}` })).not.toBeInTheDocument();
  }

  fireEvent.click(screen.getByRole('menuitem', { name: 'versionHistory.onlyYours' }));
  expect(props.onOnlyShowMineChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('menu')).toBeInTheDocument();

  rerender(<VersionList {...props} onlyShowMine />);
  fireEvent.click(screen.getByRole('menuitem', { name: 'versionHistory.onlyYours' }));
  expect(props.onOnlyShowMineChange).toHaveBeenLastCalledWith(false);
  expect(props.onDateFilterChange).not.toHaveBeenCalled();
});

test('Pro date filters forward each original range and keep the dropdown open', async () => {
  const props = listProps();

  render(<VersionList {...props} isPro />);
  expect(screen.queryByText('versionHistory.upgrade')).not.toBeInTheDocument();
  await openFilters();

  for (const range of ['last7Days', 'last30Days', 'last60Days', 'all']) {
    fireEvent.click(screen.getByRole('menuitem', { name: `versionHistory.${range}` }));
    expect(props.onDateFilterChange).toHaveBeenLastCalledWith(range);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  }

  expect(props.onDateFilterChange).toHaveBeenCalledTimes(4);
  expect(props.onOnlyShowMineChange).not.toHaveBeenCalled();
});

test('selection, restore, and close keep their document callbacks and test IDs', () => {
  const props = listProps();
  const { rerender } = render(<VersionList {...props} />);

  expect(screen.getByTestId('version-history-item-latest')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('version-history-item-previous'));
  expect(props.onSelect).toHaveBeenCalledWith('previous');
  rerender(<VersionList {...props} selectedVersionId='previous' />);
  expect(screen.getByTestId('version-history-item-latest')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('version-history-item-previous')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByTestId('version-history-restore-button'));
  expect(props.onRestoreClicked).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId('version-history-close-button'));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test('restore remains disabled without a selection or callback and busy during restoration', () => {
  const props = listProps();
  const { rerender } = render(<VersionList {...props} selectedVersionId='' />);
  const restoreButton = () => screen.getByTestId('version-history-restore-button');

  expect(restoreButton()).toBeDisabled();
  fireEvent.click(restoreButton());
  expect(props.onRestoreClicked).not.toHaveBeenCalled();

  rerender(<VersionList {...props} onRestoreClicked={undefined} />);
  expect(restoreButton()).toBeDisabled();

  rerender(<VersionList {...props} isRestoring />);
  expect(restoreButton()).toBeDisabled();
  expect(restoreButton()).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(restoreButton());
  expect(props.onRestoreClicked).not.toHaveBeenCalled();

  rerender(<VersionList {...props} isRestoring={false} />);
  expect(restoreButton()).toBeEnabled();
  expect(restoreButton()).not.toHaveAttribute('aria-busy');
  fireEvent.click(restoreButton());
  expect(props.onRestoreClicked).toHaveBeenCalledTimes(1);
});
