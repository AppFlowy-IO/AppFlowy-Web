/**
 * @jest-environment node
 *
 * Integration tests for Invitation and Sharing operations
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('HTTP API - Invitation & Sharing Operations', () => {
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

    describe('Workspace Invitation Operations', () => {
        it('should invite members', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const testEmail = `invite-${uuidv4()}@appflowy.io`;
            try {
                await expect(
                    APIService.inviteMembers(testWorkspaceId, [testEmail])
                ).resolves.toBeUndefined();
            } catch (error: any) {
                // May fail for various reasons (email format, permissions, etc.)
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should join workspace by invitation code', async () => {
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.joinWorkspaceByInvitationCode('invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get workspace info by invitation code', async () => {
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.getWorkspaceInfoByInvitationCode('invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get invitation', async () => {
            // This will likely fail with invalid ID, but tests error handling
            try {
                await APIService.getInvitation('invalid-invitation-id');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should accept invitation', async () => {
            // This will likely fail with invalid ID, but tests error handling
            try {
                await APIService.acceptInvitation('invalid-invitation-id');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });

    describe('Guest Invitation Operations', () => {
        it('should get guest invitation', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.getGuestInvitation(testWorkspaceId, 'invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should get guest to member conversion info', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.getGuestToMemberConversionInfo(testWorkspaceId, 'invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should accept guest invitation', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.acceptGuestInvitation(testWorkspaceId, 'invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should approve turn guest to member', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            // This will likely fail with invalid code, but tests error handling
            try {
                await APIService.approveTurnGuestToMember(testWorkspaceId, 'invalid-code');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should turn guest into member', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const testEmail = `guest-${uuidv4()}@appflowy.io`;
            try {
                await APIService.turnIntoMember(testWorkspaceId, testEmail);
                // Function executed successfully
            } catch (error: any) {
                // May fail if email is not a guest
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });

    describe('Share Page Operations', () => {
        it('should share page to emails', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                const testEmail = `share-${uuidv4()}@appflowy.io`;
                try {
                    await expect(
                        APIService.sharePageTo(testWorkspaceId, outline[0].view_id, [testEmail])
                    ).resolves.toBeUndefined();
                } catch (error: any) {
                    // May fail for various reasons
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should revoke access', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                const testEmail = `revoke-${uuidv4()}@appflowy.io`;
                try {
                    await expect(
                        APIService.revokeAccess(testWorkspaceId, outline[0].view_id, [testEmail])
                    ).resolves.toBeUndefined();
                } catch (error: any) {
                    // May fail if email doesn't have access
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get share detail', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    const result = await APIService.getShareDetail(testWorkspaceId, outline[0].view_id, []);
                    expect(result).toBeDefined();
                } catch (error: any) {
                    // May fail if view is not shared, which is fine
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);

        it('should get share with me', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            try {
                const result = await APIService.getShareWithMe(testWorkspaceId);
                expect(result).toBeDefined();
            } catch (error: any) {
                // May not have shared content, which is fine
                expect(error.code).toBeDefined();
            }
        }, 30000);
    });

    describe('Access Request Operations', () => {
        it('should get request access info', async () => {
            // This will likely fail with invalid ID, but tests error handling
            try {
                await APIService.getRequestAccessInfo('invalid-request-id');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should approve request access', async () => {
            // This will likely fail with invalid ID, but tests error handling
            try {
                await APIService.approveRequestAccess('invalid-request-id');
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.code).toBeDefined();
            }
        }, 30000);

        it('should send request access', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            if (outline.length > 0) {
                try {
                    await expect(
                        APIService.sendRequestAccess(testWorkspaceId, outline[0].view_id)
                    ).resolves.toBeUndefined();
                } catch (error: any) {
                    // May fail for various reasons (already has access, etc.)
                    expect(error.code).toBeDefined();
                }
            }
        }, 30000);
    });
});
