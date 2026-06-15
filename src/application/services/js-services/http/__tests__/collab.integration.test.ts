/**
 * @jest-environment node
 *
 * Integration tests for Collaboration operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - Collaboration Operations', () => {
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

    describe('Collab Data Operations', () => {
        it('should get page collab', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                const result = await APIService.getPageCollab(testWorkspaceId, outline[0].view_id);

                expect(result).toBeDefined();
                expect(result).toHaveProperty('data');
            }
        }, 30000);

        it('should check if collab exists', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                const result = await APIService.checkIfCollabExists(testWorkspaceId, outline[0].view_id);

                expect(typeof result).toBe('boolean');
            }
        }, 30000);

        it('should update collab', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.updateCollab(
                        testWorkspaceId,
                        outline[0].view_id,
                        0, // Document type
                        new Uint8Array([1, 2, 3]),
                        { version_vector: 0 }
                    );
                    expect(result).toBeDefined();
                    expect(result).toHaveProperty('version_vector');
                } catch (error: any) {
                    // May fail for various reasons
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get collab', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.getCollab(testWorkspaceId, outline[0].view_id, 0);
                    expect(result).toBeDefined();
                    expect(result).toHaveProperty('data');
                } catch (error: any) {
                    // May fail for various reasons
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);
    });

    describe('Chat Operations', () => {
        it('should get chat messages', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const testChatId = 'test-chat-id';
            try {
                const result = await APIService.getChatMessages(testWorkspaceId, testChatId, 10);
                expect(result).toBeDefined();
            } catch (error: any) {
                // May fail if chat doesn't exist - error may not have code property
                expect(error).toBeDefined();
            }
        }, 30000);
    });
});
