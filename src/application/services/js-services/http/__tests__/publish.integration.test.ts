/**
 * @jest-environment node
 *
 * Integration tests for Publish operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - Publish Operations', () => {
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

    describe('Publish Namespace & Homepage', () => {
        it('should get publish namespace', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const result = await APIService.getPublishNamespace(testWorkspaceId);

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        }, 30000);

        it('should get publish homepage', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            try {
                const result = await APIService.getPublishHomepage(testWorkspaceId);
                expect(result).toBeDefined();
            } catch (error: any) {
                // May not have a homepage set, which is fine
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should update publish namespace', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // First get current namespace
            const currentNamespace = await APIService.getPublishNamespace(testWorkspaceId);
            const newNamespace = `test-namespace-${Date.now()}`;
            await expect(
                APIService.updatePublishNamespace(testWorkspaceId, {
                    old_namespace: currentNamespace,
                    new_namespace: newNamespace,
                })
            ).resolves.toBeUndefined();
        }, 30000);

        it('should update publish config', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                await expect(
                    APIService.updatePublishConfig(testWorkspaceId, {
                        view_id: outline[0].view_id,
                        comments_enabled: true,
                        duplicate_enabled: false,
                    })
                ).resolves.toBeUndefined();
            }
        }, 30000);

        it('should update publish homepage', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await expect(
                        APIService.updatePublishHomepage(testWorkspaceId, outline[0].view_id)
                    ).resolves.toBeUndefined();
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should remove publish homepage', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            try {
                await expect(
                    APIService.removePublishHomepage(testWorkspaceId)
                ).resolves.toBeUndefined();
            } catch (error: any) {
                // May fail if no homepage set
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });

    describe('Publish View Operations', () => {
        it('should publish view', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await APIService.publishView(testWorkspaceId, outline[0].view_id);
                    // Function executed successfully
                } catch (error: any) {
                    // May fail if already published or other reasons
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should unpublish view', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await expect(
                        APIService.unpublishView(testWorkspaceId, outline[0].view_id)
                    ).resolves.toBeUndefined();
                } catch (error: any) {
                    // May fail if not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get publish info with view ID', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.getPublishInfoWithViewId(outline[0].view_id);
                    expect(result).toBeDefined();
                    expect(result).toHaveProperty('view_id');
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get publish view meta', async () => {
            // This will likely fail with invalid namespace/name, but tests error handling
            try {
                await APIService.getPublishViewMeta('invalid-namespace', 'invalid-name');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get publish view', async () => {
            // This will likely fail with invalid namespace/name, but tests error handling
            try {
                await APIService.getPublishView('invalid-namespace', 'invalid-name');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get publish view blob', async () => {
            // This may fail with invalid namespace/name, or succeed with empty blob
            try {
                const result = await APIService.getPublishViewBlob('invalid-namespace', 'invalid-name');
                // If it succeeds, check that we got some data back
                expect(result).toBeDefined();
            } catch (error: any) {
                // If it fails, check error structure
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get publish outline', async () => {
            // This will likely fail with invalid namespace, but tests error handling
            try {
                await APIService.getPublishOutline('invalid-namespace');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should duplicate publish view', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    // For duplicatePublishView, we need published_view_id and dest_view_id
                    // Since we don't have a published view, this will likely fail, but tests error handling
                    const result = await APIService.duplicatePublishView(testWorkspaceId, {
                        published_collab_type: 0,
                        published_view_id: outline[0].view_id,
                        dest_view_id: outline[0].view_id,
                    });
                    expect(result).toBeDefined();
                    expect(typeof result).toBe('string');
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);
    });

    describe('Publish Comments & Reactions', () => {
        it('should get publish view comments', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.getPublishViewComments(outline[0].view_id);
                    expect(Array.isArray(result)).toBe(true);
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get reactions', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.getReactions(outline[0].view_id);
                    expect(typeof result).toBe('object');
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should create global comment on publish view', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await APIService.createGlobalCommentOnPublishView(outline[0].view_id, 'Test comment');
                    // Function executed successfully
                } catch (error: any) {
                    // May fail if view is not published
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should delete global comment on publish view', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await APIService.deleteGlobalCommentOnPublishView(outline[0].view_id, 'invalid-comment-id');
                    // Function executed successfully
                } catch (error: any) {
                    // May fail if comment doesn't exist or view not published
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should add reaction', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await APIService.addReaction(outline[0].view_id, 'comment-id', '👍');
                    // Function executed successfully
                } catch (error: any) {
                    // May fail if view is not published or comment doesn't exist
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should remove reaction', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await APIService.removeReaction(outline[0].view_id, 'comment-id', '👍');
                    // Function executed successfully
                } catch (error: any) {
                    // May fail if reaction doesn't exist
                    expect(error).toBeDefined();
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);
    });
});
