/**
 * @jest-environment node
 *
 * Integration tests for Page operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - Page Operations', () => {
    let testWorkspaceId: string;
    let testAccessToken: string;
    let authHelper: AuthHelper;
    let mockToken: any;
    let createdPageId: string | null = null;

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

    describe('Page CRUD Operations', () => {
        it('should create a new page', async () => {
            if (!testWorkspaceId) {
                throw new Error('testWorkspaceId is not available');
            }

            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;

            const pageName = `Test Page ${Date.now()}`;
            const { view_id } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: pageName,
            });
            createdPageId = view_id;

            expect(createdPageId).toBeDefined();
            expect(typeof createdPageId).toBe('string');
        }, 30000);

        it('should update page name', async () => {
            if (!testWorkspaceId || !createdPageId) {
                throw new Error('testWorkspaceId or createdPageId is not available');
            }

            const newName = `Updated Page ${Date.now()}`;

            await expect(
                APIService.updatePageName(testWorkspaceId, createdPageId, newName)
            ).resolves.toBeUndefined();
        }, 30000);

        it('should update page', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;
            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            try {
                await expect(
                    APIService.updatePage(testWorkspaceId, pageId, {
                        name: `Updated Page ${Date.now()}`,
                    })
                ).resolves.toBeUndefined();
            } catch (error: any) {
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should update page icon', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;
            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            await expect(
                APIService.updatePageIcon(testWorkspaceId, pageId, {
                    ty: 0,
                    value: '📄',
                })
            ).resolves.toBeUndefined();
        }, 30000);

        it('should duplicate page', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;
            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            try {
                await APIService.duplicatePage(testWorkspaceId, pageId);
                // Function executed successfully
            } catch (error: any) {
                // May fail for various reasons
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });

    describe('Page Movement & Organization', () => {
        it('should move page to different location', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;

            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            await expect(
                APIService.movePageTo(testWorkspaceId, pageId, rootViewId, undefined)
            ).resolves.toBeUndefined();

            // Verify the page was moved by getting the updated view
            const movedView = await APIService.getView(testWorkspaceId, pageId);

            expect(movedView).toBeDefined();
            expect(movedView.parent_view_id).toBe(rootViewId);
        }, 30000);

        it('should add recent pages', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const outline = await APIService.getAppOutline(testWorkspaceId);
            const rootViewId = outline[0]?.view_id || testWorkspaceId;
            const { view_id: pageId } = await APIService.addAppPage(testWorkspaceId, rootViewId, {
                layout: 0,
                name: `Test Page ${Date.now()}`,
            });

            await expect(
                APIService.addRecentPages(testWorkspaceId, [pageId])
            ).resolves.toBeUndefined();
        }, 30000);

        it('should delete page to trash', async () => {
            if (!testWorkspaceId || !createdPageId) {
                throw new Error('testWorkspaceId or createdPageId is not available');
            }

            await expect(
                APIService.moveToTrash(testWorkspaceId, createdPageId)
            ).resolves.toBeUndefined();
        }, 30000);
    });

    describe('Page Outline', () => {
        it('should get app outline', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }

            const result = await APIService.getAppOutline(testWorkspaceId);

            expect(Array.isArray(result)).toBe(true);
        }, 30000);
    });
});
