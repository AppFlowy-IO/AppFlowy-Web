import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the runtime-config module BEFORE importing the module that uses it.
// This prevents the "import.meta" syntax error because the actual file is never loaded.
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn(),
}));

// Import the module under test
import {
  isAppFlowyAuthenticatedFileUrl,
  isAppFlowyFileStorageUrl,
  isAppFlowyPublicFormUploadUrl,
  resolveFileUrl,
} from '../file-storage-url';
// Import the mocked module to access the mock function
import { getConfigValue } from '@/utils/runtime-config';

describe('file-storage-url utils', () => {
  const mockBaseUrl = 'https://app.flowy.io';
  const mockWorkspaceId = 'workspace-123';
  const mockViewId = 'view-456';
  const mockFileId = 'file-789';

  // Cast the imported function to a Jest mock to access mock methods
  const mockGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;

  beforeEach(() => {
    // Default mock implementation
    mockGetConfigValue.mockImplementation((key: string) => {
      if (key === 'APPFLOWY_BASE_URL') return mockBaseUrl;
      return '';
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveFileUrl', () => {
    it('should return empty string for undefined/null/empty input', () => {
      expect(resolveFileUrl(undefined, mockWorkspaceId, mockViewId)).toBe('');
      expect(resolveFileUrl('', mockWorkspaceId, mockViewId)).toBe('');
    });

    it('should return the URL as-is if it is already a full URL', () => {
      const fullUrl = 'https://example.com/image.png';
      expect(resolveFileUrl(fullUrl, mockWorkspaceId, mockViewId)).toBe(fullUrl);
    });

    it('should return the URL as-is if it is a local full URL', () => {
      const fullUrl = 'http://localhost:8000/api/file_storage/test.png';
      expect(resolveFileUrl(fullUrl, mockWorkspaceId, mockViewId)).toBe(fullUrl);
    });

    it('should construct a full AppFlowy file storage URL when given a file ID', () => {
      // When input is just an ID like "file-789"
      // It should construct: BASE_URL/api/file_storage/WORKSPACE_ID/v1/blob/VIEW_ID/FILE_ID
      const expectedUrl = `${mockBaseUrl}/api/file_storage/${mockWorkspaceId}/v1/blob/${mockViewId}/${mockFileId}`;
      expect(resolveFileUrl(mockFileId, mockWorkspaceId, mockViewId)).toBe(expectedUrl);
    });

    it('should handle cases where isFileURL returns true but it is not a standard http URL', () => {
      // This tests the behavior of isFileURL internal check.
      // If isFileURL returns true, resolveFileUrl returns input as is.
      // Assuming "ftp://example.com/file" is considered a URL by the validator
      const ftpUrl = 'ftp://example.com/file';
      expect(resolveFileUrl(ftpUrl, mockWorkspaceId, mockViewId)).toBe(ftpUrl);
    });
  });

  describe('isAppFlowyFileStorageUrl', () => {
    it('should return true for URLs matching the configured AppFlowy base path', () => {
      const url = `${mockBaseUrl}/api/file_storage/some/path`;
      expect(isAppFlowyFileStorageUrl(url)).toBe(true);
    });

    it('should return true for relative paths matching the file storage path (when origin matches)', () => {
      // Note: The implementation of resolveAppflowyOriginAndPathname uses window.location if base url is empty,
      // or parses the configured base url. Since we mocked base url to https://app.flowy.io:

      // Test matching origin and path
      const url = `${mockBaseUrl}/api/file_storage/file-id`;
      expect(isAppFlowyFileStorageUrl(url)).toBe(true);
    });

    it('should return false for URLs not matching the file storage path', () => {
      const url = `${mockBaseUrl}/api/other_endpoint`;
      expect(isAppFlowyFileStorageUrl(url)).toBe(false);
    });

    it('rejects prefix-lookalike paths that must never receive bearer auth', () => {
      expect(isAppFlowyFileStorageUrl(`${mockBaseUrl}/api/file_storage_evil/file-id`)).toBe(false);
    });

    it('should return false for external URLs that do not match the path', () => {
      const url = 'https://google.com/search';
      expect(isAppFlowyFileStorageUrl(url)).toBe(false);
    });

    it('rejects credential-bearing file-storage URLs', () => {
      expect(isAppFlowyFileStorageUrl('https://user@app.flowy.io/api/file_storage/file-id')).toBe(false);
    });
  });

  describe('public form attachment URLs', () => {
    const token = 'c6c31f9b-c334-4e3a-be20-79f661d4ad87';
    const fileId = 'b5860623-7ab8-40a7-a8bd-594b741d5a82';

    it('recognizes only the exact first-party authenticated download route', () => {
      const url = `${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}`;

      expect(isAppFlowyPublicFormUploadUrl(url)).toBe(true);
      expect(isAppFlowyAuthenticatedFileUrl(url)).toBe(true);
      expect(resolveFileUrl(url, mockWorkspaceId, mockViewId)).toBe(url);
    });

    it('does not send authentication to an external origin with a matching path', () => {
      const url = `https://attacker.example/api/workspace/public-form/${token}/uploads/${fileId}`;

      expect(isAppFlowyPublicFormUploadUrl(url)).toBe(false);
      expect(isAppFlowyAuthenticatedFileUrl(url)).toBe(false);
    });

    it('rejects lookalike paths and malformed identifiers', () => {
      expect(isAppFlowyPublicFormUploadUrl(`${mockBaseUrl}/api/workspace/public-form/${token}/uploads/not-a-uuid`)).toBe(
        false
      );
      expect(
        isAppFlowyPublicFormUploadUrl(`${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}/extra`)
      ).toBe(false);
      expect(isAppFlowyPublicFormUploadUrl(`${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}/`)).toBe(
        false
      );
      expect(
        isAppFlowyPublicFormUploadUrl(`${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}?download=1`)
      ).toBe(false);
      expect(
        isAppFlowyPublicFormUploadUrl(`${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}#preview`)
      ).toBe(false);
      expect(
        isAppFlowyPublicFormUploadUrl(
          `https://user@${new URL(mockBaseUrl).host}/api/workspace/public-form/${token}/uploads/${fileId}`
        )
      ).toBe(false);
    });

    it('never writes opaque form attachment identifiers to debug logs', () => {
      const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
      const stableUrl = `${mockBaseUrl}/api/workspace/public-form/${token}/uploads/${fileId}`;

      expect(isAppFlowyAuthenticatedFileUrl(stableUrl)).toBe(true);
      expect(isAppFlowyAuthenticatedFileUrl(`${stableUrl}?unexpected=1`)).toBe(false);

      const logged = debug.mock.calls.flat().join(' ');

      expect(logged).not.toContain(token);
      expect(logged).not.toContain(fileId);
    });
  });
});
