import { queryIntegration } from '@/application/services/domains/integration';

import { driveFileUrl, getDriveFile, listDriveFiles } from '../google-drive';

jest.mock('@/application/services/domains/integration', () => ({ queryIntegration: jest.fn() }));

it('browses private and shared files through the authenticated proxy, escaping searches and preserving pagination', async () => {
  const signal = new AbortController().signal;

  await listDriveFiles('workspace', 'account', "O'Brien\\draft", 'next-page', signal);
  expect(queryIntegration).toHaveBeenCalledWith(
    'workspace',
    'account',
    '/drive/v3/files',
    expect.objectContaining({
      q: "trashed = false and name contains 'O\\'Brien\\\\draft'",
      pageToken: 'next-page',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }),
    signal
  );
  await getDriveFile('workspace', 'account', 'file/id', signal);
  expect(queryIntegration).toHaveBeenLastCalledWith(
    'workspace',
    'account',
    '/drive/v3/files/file%2Fid',
    expect.any(Object),
    signal
  );
});

it('constructs Google previews from IDs without trusting a supplied web URL', () => {
  expect(
    driveFileUrl({
      id: 'file',
      name: 'Doc',
      mimeType: 'application/vnd.google-apps.document',
      webViewLink: 'javascript:alert(1)',
    })
  ).toBe('https://docs.google.com/document/d/file/edit');
  expect(driveFileUrl({ id: 'folder', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' })).toBe(
    'https://drive.google.com/drive/folders/folder'
  );
});
