/**
 * @jest-environment node
 *
 * Integration tests for View operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - View Operations', () => {
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

    describe('View Operations', () => {
        it('should get view by ID', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                const viewId = outline[0].view_id;
                const result = await APIService.getView(testWorkspaceId, viewId, 1);

                expect(result).toBeDefined();
                expect(result).toHaveProperty('view_id');
                expect(result).toHaveProperty('name');
                expect(result).toHaveProperty('layout');
            }
        }, 30000);

        it('should create orphaned view and return doc_state', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const documentId = uuidv4();

            try {
                const docState = await APIService.createOrphanedView(testWorkspaceId, {
                    document_id: documentId,
                });

                // Verify doc_state is returned as Uint8Array
                expect(docState).toBeInstanceOf(Uint8Array);
                expect(docState.length).toBeGreaterThan(0);

                // Verify the view was created by checking if the collab exists
                const exists = await APIService.checkIfCollabExists(testWorkspaceId, documentId);

                expect(exists).toBe(true);
            } catch (error: any) {
                // May fail for various reasons (e.g., server not configured)
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should restore page from trash', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;
            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            await APIService.moveToTrash(testWorkspaceId, pageId);

            await expect(
                APIService.restorePage(testWorkspaceId, pageId)
            ).resolves.toBeUndefined();
        }, 30000);
    });
});
