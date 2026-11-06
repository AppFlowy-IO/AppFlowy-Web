import {
  driveDetails,
  driveFileData,
  driveLink,
  driveLinkData,
  driveName,
  driveSize,
  validDriveSource,
} from '../drive-data';
import { buildGoogleDriveEmbeddedUrl, getGoogleDriveFileId } from '../google-drive-utils';

it.each([
  'javascript:alert(1)',
  'data:text/html,hi',
  'https://user:password@docs.google.com/document/d/id',
  'not a url',
])('rejects unsafe input %s', (url) => {
  expect(driveLink(url)).toBeUndefined();
  expect(validDriveSource(url)).toBeFalsy();
});
it('keeps the original link and clears private metadata when replacing with a public link', () => {
  const url = 'https://docs.google.com/document/d/id/edit?resourcekey=key';
  expect(driveLinkData(url)).toMatchObject({ url, file_id: '', email: '', size: '', modified_time: '' });
  expect(validDriveSource(url)).toBe(url);
});
it('never saves authenticated thumbnail URLs or provider-supplied destination URLs', () => {
  expect(
    driveFileData(
      {
        id: 'file',
        name: 'Roadmap',
        mimeType: 'application/vnd.google-apps.document',
        thumbnailLink: 'secret',
        webViewLink: 'https://evil.example',
        size: '123',
      },
      'work@example.com'
    )
  ).toMatchObject({
    url: 'https://docs.google.com/document/d/file/edit',
    name: 'Roadmap',
    email: 'work@example.com',
    size: '123',
  });
  expect(driveFileData({ id: 'file', name: 'Roadmap', mimeType: '', thumbnailLink: 'secret' })).not.toHaveProperty(
    'thumbnailLink'
  );
});
it('preserves names and bounds corrupt persisted dimensions', () => {
  expect(driveName({ name: ' Roadmap ', url: '' })).toBe('Roadmap');
  expect(driveSize({ width_factor: NaN, height_factor: Infinity })).toEqual({ width_factor: 1, height_factor: 1 });
  expect(driveSize({ width_factor: 2, height_factor: -1 })).toEqual({ width_factor: 1, height_factor: 0.3 });
});
it('formats optional metadata without making public links require metadata', () => {
  expect(driveDetails({}, 'en', 'document')).toBe('');
  expect(
    driveDetails(
      { size: '2632', modified_time: '2026-11-01T00:00:00Z', url: 'https://docs.google.com/document/d/id' },
      'en',
      'document',
      Date.parse('2026-11-01T00:36:00Z')
    )
  ).toBe('2.57 KB • 36 minutes ago • document • https://docs.google.com');
});
it('does not mistake a resource key for a file ID or change unpublished form IDs', () => {
  expect(getGoogleDriveFileId('https://drive.google.com/file/?resourcekey=secret')).toBeUndefined();
  expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/forms/d/form/viewform')).toBe(
    'https://docs.google.com/forms/d/form/viewform?embedded=true'
  );
});
