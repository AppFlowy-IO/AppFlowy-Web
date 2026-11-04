import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getViewPdfBlob } from '@/application/services/js-services/http/export-api';
import { ViewLayout } from '@/application/types';
import { updateServerInfo } from '@/utils/server-info';

import ExportPanel from '../ExportPanel';

const mockTranslate = (key: string) => key;
const mockViewLayout = ViewLayout;
// A cleared page title is stored as an empty name.
const mockViewNames: Record<string, string> = { 'database-container': 'Project tracker', 'untitled-container': '' };
const serverUrl = 'https://workspace.example.com';
const mockGetViewPdfBlob = getViewPdfBlob as jest.MockedFunction<typeof getViewPdfBlob>;
const mockDownloadBlob = jest.fn();
// Must stay referentially stable: the subscription hook refetches when it changes.
const mockGetSubscriptions = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: () => 'https://workspace.example.com',
}));
jest.mock('@/utils/download', () => ({ downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args) }));
jest.mock('@/application/services/domains', () => ({ BillingService: { getSubscriptionLink: jest.fn() } }));
jest.mock('@/application/services/js-services/http/export-api', () => ({
  ...jest.requireActual('@/application/services/js-services/http/export-api'),
  getViewPdfBlob: jest.fn(),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (viewId: string) => ({
    view_id: viewId,
    name: mockViewNames[viewId] ?? 'Page',
    layout: viewId.startsWith('grid') ? mockViewLayout.Grid : mockViewLayout.Document,
  }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useGetSubscriptions: () => mockGetSubscriptions,
}));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ showBlockingLoader: jest.fn(), hideBlockingLoader: jest.fn() }),
}));

// Issue #545: a database row shares through its database, but "Export as PDF"
// must export the row document instead of the database grid.
describe('ExportPanel export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSubscriptions.mockResolvedValue([]);
    updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
    mockGetViewPdfBlob.mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'Row title.pdf' });
  });

  it('exports the target row document after preparing it, not the shared database', async () => {
    const calls: string[] = [];
    const prepare = jest.fn(async () => {
      calls.push('prepare');
    });

    mockGetViewPdfBlob.mockImplementation(async () => {
      calls.push('export');
      return { blob: new Blob(['%PDF']), filename: 'Row title.pdf' };
    });

    render(<ExportPanel viewId='database-container' exportTarget={{ viewId: 'row-document', prepare }} />);
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockGetViewPdfBlob).toHaveBeenCalledTimes(1);
    expect(mockGetViewPdfBlob).toHaveBeenCalledWith('workspace-1', 'row-document', expect.any(Object));
    expect(calls).toEqual(['prepare', 'export']);
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Row title.pdf');
  });

  it('keeps export disabled while the target is resolving instead of exporting the shared view', () => {
    render(<ExportPanel viewId='database-container' exportTarget={{ viewId: undefined }} />);

    const button = screen.getByTestId('export-pdf-button');

    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(mockGetViewPdfBlob).not.toHaveBeenCalled();
  });

  it('exports the shared view when no separate target is given', async () => {
    render(<ExportPanel viewId='document-view' />);
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockGetViewPdfBlob).toHaveBeenCalledWith('workspace-1', 'document-view', expect.any(Object));
  });

  it('names the PDF of a page whose title was cleared after the untitled page name', async () => {
    // The server names the file after the page, so a cleared title arrives as a bare ".pdf".
    mockGetViewPdfBlob.mockResolvedValue({ blob: new Blob(['%PDF']), filename: '.pdf' });
    render(<ExportPanel viewId='document-view' />);
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'menuAppHeader.defaultNewPageName.pdf');
  });
});

// Desktop #1545 / AppFlowy#9106: database PDFs keep wide tables readable on the
// paper the user picks, and export the tab on screen.
describe('ExportPanel database PDF options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSubscriptions.mockResolvedValue([]);
    updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
    mockGetViewPdfBlob.mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'Board.pdf' });
  });

  function chooseLetterLandscape() {
    const trigger = screen.getByTestId('export-pdf-page-size-trigger');

    expect(trigger.textContent).toContain('A4');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('export-pdf-page-size-letter'));
    expect(screen.getByTestId('export-pdf-page-size-trigger').textContent).toContain('shareAction.pdfLetter');
    fireEvent.click(screen.getByTestId('export-pdf-landscape-switch'));
  }

  it('exports the database target on A4 portrait by default, without linked pages', async () => {
    render(<ExportPanel viewId='database-container' exportTarget={{ viewId: 'board-view', isDatabase: true }} />);

    expect(screen.queryByTestId('export-include-linked-pages-switch')).toBeNull();
    expect(screen.getByText('shareAction.pdfWideTableHint')).toBeTruthy();
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockGetViewPdfBlob).toHaveBeenCalledWith('workspace-1', 'board-view', {
      includeNested: false,
      pageSize: 'a4',
      landscape: false,
    });
    // The server names the file after the tab; the download keeps the page name.
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Project tracker.pdf');
  });

  it('names the export of a tab on an untitled database page "Untitled", not after the tab', async () => {
    render(<ExportPanel viewId='untitled-container' exportTarget={{ viewId: 'board-view', isDatabase: true }} />);
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'menuAppHeader.defaultNewPageName.pdf');
  });

  it('labels the paper size menu with its purpose', () => {
    render(<ExportPanel viewId='database-container' exportTarget={{ viewId: 'board-view', isDatabase: true }} />);

    expect(screen.getByRole('button', { name: 'shareAction.pdfPageFormat' }).textContent).toContain('A4');
  });

  it('sends the chosen paper and orientation with the database export', async () => {
    render(<ExportPanel viewId='database-container' exportTarget={{ viewId: 'board-view', isDatabase: true }} />);

    chooseLetterLandscape();
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockGetViewPdfBlob).toHaveBeenCalledWith('workspace-1', 'board-view', {
      includeNested: false,
      pageSize: 'letter',
      landscape: true,
    });
  });

  it('offers paper options for a shared database view without a separate target', async () => {
    render(<ExportPanel viewId='grid-view' />);

    chooseLetterLandscape();
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockGetViewPdfBlob).toHaveBeenCalledWith(
      'workspace-1',
      'grid-view',
      expect.objectContaining({ pageSize: 'letter', landscape: true })
    );
    // Exporting the shared view itself keeps the server's name for it.
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Board.pdf');
  });

  it('keeps documents and row pages on the linked-pages option without paper settings', async () => {
    render(<ExportPanel viewId='grid-container' exportTarget={{ viewId: 'row-document' }} />);

    expect(screen.queryByTestId('export-pdf-page-size-trigger')).toBeNull();
    expect(screen.getByTestId('export-include-linked-pages-switch')).toBeTruthy();
    fireEvent.click(screen.getByTestId('export-pdf-button'));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    const options = mockGetViewPdfBlob.mock.calls[0][2];

    expect(options).not.toHaveProperty('pageSize');
    expect(options).not.toHaveProperty('landscape');
  });
});
