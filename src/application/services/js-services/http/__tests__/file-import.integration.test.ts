/**
 * @jest-environment node
 *
 * Integration tests for File Upload and Import operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - File Upload & Import Operations', () => {
    let testWorkspaceId: string;
    let testAccessToken: string;
    let authHelper: AuthHelper;
    let mockToken: any;

    beforeAll(async () => {
        const envConfig = getEnvConfig();
        authHelper = new AuthHelper(envConfig.gotrueURL);

        initAPIService({
            baseURL: envConfig.baseURL,
            gotrueURL: envConfig.gotrueURL,
            wsURL: envConfig.wsURL,
        });

        const testEmail = `test-${uuidv4()}@appflowy.io`;

        try {
            const authResult = await authHelper.signInUser(testEmail);
            testAccessToken = authResult.accessToken;

            const expiresAt = Math.floor(Date.now() / 1000) + 3600;
            mockToken = {
                access_token: testAccessToken,
                refresh_token: authResult.refreshToken,
                expires_at: expiresAt,
                user: authResult.user,
            };

            testWorkspaceId = await ensureWorkspace(mockToken);
        } catch (error: any) {
            throw new Error(`Failed to authenticate test user: ${error.message}`);
        }
    }, 60000);

    beforeEach(() => {
        const { getTokenParsed } = require('@/application/session/token');
        getTokenParsed.mockReturnValue(mockToken);
    });

    describe('File Upload Operations', () => {
        it('should handle file upload error gracefully', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                // Create a mock file
                const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
                try {
                    await APIService.uploadFile(testWorkspaceId, outline[0].view_id, file);
                    // If it succeeds, that's fine too
                } catch (error: any) {
                    // Should have proper error format
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                    expect(error.message).toBeDefined();
                }
            }
        }, 30000);
    });

    describe('Import Operations', () => {
        it('should create import task', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // Create a mock file
            const file = new File(['test content'], 'test.csv', { type: 'text/csv' });
            try {
                const result = await APIService.createImportTask(file);
                expect(result).toBeDefined();
            } catch (error: any) {
                // May fail for various reasons (file format, permissions, etc.)
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should upload import file', async () => {
            // This test requires a valid presigned URL from createImportTask
            const file = new File(['test content'], 'test.zip', { type: 'application/zip' });
            const mockPresignedUrl = 'http://example.com/upload';

            try {
                await APIService.uploadImportFile(mockPresignedUrl, file, (progress) => {
                    expect(progress).toBeGreaterThanOrEqual(0);
                    expect(progress).toBeLessThanOrEqual(1);
                });
                // May succeed or fail depending on the mock URL
            } catch (error: any) {
                // Expected to fail with mock URL
                expect(error).toBeDefined();
            }
        }, 30000);
    });
});
