/// <reference types="jest" />
import { buildGoogleDriveEmbeddedUrl, isGoogleDriveUrl, resolveGoogleDriveName } from '../google-drive-utils';

describe('isGoogleDriveUrl', () => {
  it('accepts supported Google hosts', () => {
    expect(isGoogleDriveUrl('https://drive.google.com/file/d/abc123/view')).toBe(true);
    expect(isGoogleDriveUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true);
    expect(isGoogleDriveUrl('https://docs.google.com/spreadsheets/d/abc123/edit')).toBe(true);
    expect(isGoogleDriveUrl('https://docs.google.com/presentation/d/abc123/edit')).toBe(true);
    expect(isGoogleDriveUrl('https://docs.google.com/forms/d/abc123/viewform')).toBe(true);
  });

  it('accepts Drive URLs with file ids in query parameters', () => {
    expect(isGoogleDriveUrl('https://drive.google.com/open?id=abc123')).toBe(true);
    expect(isGoogleDriveUrl('https://drive.google.com/uc?id=abc123')).toBe(true);
  });

  it('rejects look-alike hosts (regression: open-redirect via endsWith)', () => {
    expect(isGoogleDriveUrl('https://evilgoogle.com/file/d/abc123/view')).toBe(false);
    expect(isGoogleDriveUrl('https://notgoogle.com/file/d/abc123/view')).toBe(false);
    expect(isGoogleDriveUrl('https://fake-drive.google.com.attacker.com/file/d/abc123')).toBe(false);
    expect(isGoogleDriveUrl('https://drive.google.com.attacker.com/file/d/abc123')).toBe(false);
  });

  it('rejects unrelated hosts', () => {
    expect(isGoogleDriveUrl('https://example.com/file/d/abc123')).toBe(false);
    expect(isGoogleDriveUrl('https://dropbox.com/s/abc123/file')).toBe(false);
  });

  it('rejects supported host with unsupported path', () => {
    expect(isGoogleDriveUrl('https://drive.google.com/about')).toBe(false);
    expect(isGoogleDriveUrl('https://docs.google.com/random/path')).toBe(false);
  });

  it('accepts bare-domain inputs by normalizing via processUrl', () => {
    expect(isGoogleDriveUrl('drive.google.com/file/d/abc123/view')).toBe(true);
    expect(isGoogleDriveUrl('docs.google.com/document/d/abc123')).toBe(true);
  });

  it('returns false for malformed inputs', () => {
    expect(isGoogleDriveUrl('not a url')).toBe(false);
    expect(isGoogleDriveUrl('')).toBe(false);
  });
});

describe('buildGoogleDriveEmbeddedUrl', () => {
  it('builds Drive file preview URL', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://drive.google.com/file/d/abc123/view')).toBe(
      'https://drive.google.com/file/d/abc123/preview'
    );
  });

  it('builds Drive folder embed URL', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://drive.google.com/drive/folders/folder123')).toBe(
      'https://drive.google.com/embeddedfolderview?id=folder123#grid'
    );
  });

  it('builds Drive file preview URL from query id links', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://drive.google.com/open?id=abc123')).toBe(
      'https://drive.google.com/file/d/abc123/preview'
    );
    expect(buildGoogleDriveEmbeddedUrl('https://drive.google.com/uc?id=abc123')).toBe(
      'https://drive.google.com/file/d/abc123/preview'
    );
  });

  it('builds Docs document preview URL', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/document/d/doc123/edit')).toBe(
      'https://docs.google.com/document/d/doc123/preview'
    );
  });

  it('builds Docs spreadsheets preview URL', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/spreadsheets/d/sheet123/edit')).toBe(
      'https://docs.google.com/spreadsheets/d/sheet123/preview'
    );
  });

  it('builds Docs presentation embed URL', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/presentation/d/slide123/edit')).toBe(
      'https://docs.google.com/presentation/d/slide123/embed?start=false&loop=false'
    );
  });

  it('builds Docs forms viewform URL using /d/e/ id resolution', () => {
    expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/forms/d/e/form123/viewform')).toBe(
      'https://docs.google.com/forms/d/e/form123/viewform?embedded=true'
    );
  });

  describe('preserves resourcekey query parameter', () => {
    it('on Drive file URL', () => {
      expect(buildGoogleDriveEmbeddedUrl('https://drive.google.com/file/d/abc123/view?resourcekey=key-xyz')).toBe(
        'https://drive.google.com/file/d/abc123/preview?resourcekey=key-xyz'
      );
    });

    it('on Drive folder URL — placed before #grid fragment', () => {
      const result = buildGoogleDriveEmbeddedUrl(
        'https://drive.google.com/drive/folders/folder123?resourcekey=key-xyz'
      );

      expect(result).toBe('https://drive.google.com/embeddedfolderview?id=folder123&resourcekey=key-xyz#grid');
      // Make absolutely sure the key is not after the fragment (would be ignored by browser)
      expect(result.indexOf('resourcekey')).toBeLessThan(result.indexOf('#'));
    });

    it('on Docs document URL', () => {
      expect(buildGoogleDriveEmbeddedUrl('https://docs.google.com/document/d/doc123/edit?resourcekey=key-xyz')).toBe(
        'https://docs.google.com/document/d/doc123/preview?resourcekey=key-xyz'
      );
    });

    it('on Docs presentation URL — merged with existing query string', () => {
      expect(
        buildGoogleDriveEmbeddedUrl('https://docs.google.com/presentation/d/slide123/edit?resourcekey=key-xyz')
      ).toBe('https://docs.google.com/presentation/d/slide123/embed?start=false&loop=false&resourcekey=key-xyz');
    });

    it('url-encodes resourcekey values that contain special characters', () => {
      const result = buildGoogleDriveEmbeddedUrl(
        'https://drive.google.com/file/d/abc123/view?resourcekey=a+b%2Fc'
      );

      // The original raw value (decoded by URL parser) is "a b/c"; output must re-encode.
      expect(result).toBe('https://drive.google.com/file/d/abc123/preview?resourcekey=a%20b%2Fc');
    });
  });

  it('returns the original URL when no Drive id can be extracted', () => {
    const input = 'https://drive.google.com/file/preview';

    expect(buildGoogleDriveEmbeddedUrl(input)).toBe(input);
  });

  it('returns the raw input when URL parsing fails', () => {
    expect(buildGoogleDriveEmbeddedUrl('not a url')).toBe('not a url');
  });
});

describe('resolveGoogleDriveName', () => {
  it('returns the resource id for file URLs', () => {
    expect(resolveGoogleDriveName('https://drive.google.com/file/d/abc123/view')).toBe('abc123');
  });

  it('returns the folder id for folder URLs', () => {
    expect(resolveGoogleDriveName('https://drive.google.com/drive/folders/folder123')).toBe('folder123');
  });

  it('falls back to the raw input for malformed URLs', () => {
    expect(resolveGoogleDriveName('not a url')).toBe('not a url');
  });
});
