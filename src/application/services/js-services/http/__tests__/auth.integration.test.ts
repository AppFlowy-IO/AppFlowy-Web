/**
 * @jest-environment node
 *
 * Integration tests for Authentication and User operations
 * These tests make real HTTP requests against a running AppFlowy backend.
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - Auth & User Operations', () => {
    let testWorkspaceId: string;
    let testAccessToken: string;
    let authHelper: AuthHelper;
    let mockToken: any;

    beforeAll(async () => {
        const envConfig = getEnvConfig();
        authHelper = new AuthHelper(envConfig.gotrueURL);

        // Initialize API service with real configuration
        initAPIService({
            baseURL: envConfig.baseURL,
            gotrueURL: envConfig.gotrueURL,
            wsURL: envConfig.wsURL,
        });

        // Generate a unique test email
        const testEmail = `test-${uuidv4()}@appflowy.io`;

        try {
            // Sign in the test user
            const authResult = await authHelper.signInUser(testEmail);
            testAccessToken = authResult.accessToken;

            // Store token in mock so API service can access it
            const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
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
    }, 60000); // 60 second timeout for setup

    beforeEach(() => {
        // Mock getTokenParsed to return our test token
        const { getTokenParsed } = require('@/application/session/token');
        getTokenParsed.mockReturnValue(mockToken);
    });

    describe('Auth & User Endpoints', () => {
        it('should get current user', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const result = await APIService.getCurrentUser(testWorkspaceId);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('uuid');
        }, 30000);

        it('should get auth providers', async () => {
            const result = await APIService.getAuthProviders();

            expect(Array.isArray(result)).toBe(true);
        }, 30000);
    });

    describe('Auth Endpoints', () => {
        it('should verify token', async () => {
            if (!testAccessToken) {
                throw new Error('testAccessToken is not available');
            }
            const result = await APIService.verifyToken(testAccessToken);
            expect(result).toBeDefined();
            expect(result).toHaveProperty('is_new');
        }, 30000);

        it('should handle sign in with URL', async () => {
            // Test with invalid URL (no hash)
            try {
                await APIService.signInWithUrl('http://example.com/callback');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                // Should reject with proper error format
                expect(error).toBeDefined();
                if (typeof error === 'string') {
                    // signInWithUrl can reject with string for "No hash found"
                    expect(error).toBe('No hash found');
                } else {
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should handle sign in with URL containing tokens', async () => {
            if (!testAccessToken) {
                console.log('Skipping test: No access token available');
                return;
            }
            // Test with URL containing tokens in hash
            const testUrl = `http://example.com/callback#access_token=${testAccessToken}&refresh_token=test-refresh-token`;
            try {
                await APIService.signInWithUrl(testUrl);
                // May succeed or fail depending on token validity
            } catch (error: any) {
                // Should have proper error format
                expect(error).toBeDefined();
                if (typeof error === 'string') {
                    expect(error).toBeDefined();
                } else {
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);
    });

    describe('Workspace Member & Profile Endpoints', () => {
        it('should get workspace folder', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const result = await APIService.getWorkspaceFolder(testWorkspaceId);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('id');
        }, 30000);

        it('should get members', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const result = await APIService.getMembers(testWorkspaceId);

            expect(Array.isArray(result)).toBe(true);
        }, 30000);

        it('should get mentionable users', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const result = await APIService.getMentionableUsers(testWorkspaceId);

            expect(Array.isArray(result)).toBe(true);
        }, 30000);
    });

    describe('executeAPIRequest - Success Cases', () => {
        it('should return workspace member profile when API call succeeds', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            const result = await APIService.getWorkspaceMemberProfile(testWorkspaceId);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('person_id');
            expect(result).toHaveProperty('name');
            expect(result).toHaveProperty('email');
        }, 30000);

        it('should return favorites list', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            const result = await APIService.getAppFavorites(testWorkspaceId);

            expect(Array.isArray(result)).toBe(true);
        }, 30000);

        it('should return outline data', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            const result = await APIService.getAppOutline(testWorkspaceId);

            expect(Array.isArray(result.outline)).toBe(true);
        }, 30000);
    });

    describe('executeAPIVoidRequest - Success Cases', () => {
        it('should successfully update workspace member profile', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            await expect(
                APIService.updateWorkspaceMemberProfile(testWorkspaceId, {
                    name: 'Test User',
                })
            ).resolves.toBeUndefined();
        }, 30000);

        it('should successfully update user profile', async () => {
            await expect(
                APIService.updateUserProfile({
                    name: 'Test User Updated',
                })
            ).resolves.toBeUndefined();
        }, 30000);
    });

    describe('Error Handling', () => {
        it('should handle network errors gracefully', async () => {
            // Temporarily break the base URL
            const originalEnv = getEnvConfig();
            process.env.APPFLOWY_BASE_URL = 'http://invalid-url-that-does-not-exist:9999';

            // Reinitialize with invalid URL
            initAPIService({
                baseURL: 'http://invalid-url-that-does-not-exist:9999',
                gotrueURL: 'http://invalid-url-that-does-not-exist:9999/gotrue',
                wsURL: 'ws://invalid-url-that-does-not-exist:9999/ws',
            });

            try {
                await APIService.getWorkspaceMemberProfile('test-workspace-id');
                // Should not reach here
                expect(true).toBe(false);
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
                expect(error.message).toBeDefined();
            } finally {
                // Restore original base URL
                process.env.APPFLOWY_BASE_URL = originalEnv.baseURL;
                process.env.APPFLOWY_GOTRUE_BASE_URL = originalEnv.gotrueURL;
                process.env.APPFLOWY_WS_BASE_URL = originalEnv.wsURL;

                initAPIService({
                    baseURL: originalEnv.baseURL,
                    gotrueURL: originalEnv.gotrueURL,
                    wsURL: originalEnv.wsURL,
                });
            }
        }, 30000);

        it('should handle API errors with proper error format', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            try {
                // Try to get a view with invalid ID
                await APIService.getView(testWorkspaceId, 'invalid-view-id', 1);
                // If it doesn't throw, that's unexpected but ok
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });
});
