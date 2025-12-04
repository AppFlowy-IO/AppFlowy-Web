import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the runtime-config module BEFORE importing the module that uses it.
// This prevents the "import.meta" syntax error because the actual file is never loaded.
jest.mock('@/utils/runtime-config', () => ({
    getConfigValue: jest.fn(),
}));

// Import the module under test
import { isAppFlowyFileStorageUrl, resolveFileUrl } from '../file-storage-url';
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

        it('should return false for external URLs that do not match the path', () => {
            const url = 'https://google.com/search';
            expect(isAppFlowyFileStorageUrl(url)).toBe(false);
        });
    });
});
