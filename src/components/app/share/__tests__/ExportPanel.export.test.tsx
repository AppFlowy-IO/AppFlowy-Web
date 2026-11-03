import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getViewPdfBlob } from '@/application/services/js-services/http/export-api';
import { updateServerInfo } from '@/utils/server-info';

import ExportPanel from '../ExportPanel';

const mockTranslate = (key: string) => key;
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
  useAppView: (viewId: string) => ({ view_id: viewId }),
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
