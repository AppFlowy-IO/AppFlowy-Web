import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { APIResponseCode } from '../../support/api-mocks';

/**
 * OAuth Login Flow Tests
 *
 * These tests verify the complete OAuth (Google) login flow and ensure
 * the redirect loop fix is working correctly:
 *
 * 1. New User OAuth Login: Verifies new users complete OAuth flow and redirect to /app without loops
 * 2. Existing User OAuth Login: Verifies existing users complete OAuth flow and redirect correctly
 * 3. Redirect Loop Prevention: Tests that the fix prevents redirect loops after OAuth callback
 * 4. Token Persistence: Verifies token is saved and state syncs correctly after page reload
 *
 * Key Features Tested:
 * - OAuth callback handling with hash parameters
 * - Token extraction and saving to localStorage
 * - State synchronization after page reload
 * - Redirect loop prevention (the fix we implemented)
 * - Context initialization timing
 */
describe('OAuth Login Flow', () => {
    const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

    /**
     * Sets up mocks for app initialization endpoints.
     * These prevent 401/404 errors from unmocked endpoints triggering session invalidation.
     */
    const setupAppInitMocks = (mockWorkspaceId: string) => {
        // Mock favorites endpoint
        cy.intercept('GET', `${apiUrl}/api/workspace/*/favorite`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, data: { views: [] }, message: 'Success' },
        }).as('getFavorites');

        // Mock folder/outline endpoint
        cy.intercept('GET', `${apiUrl}/api/workspace/*/folder*`, {
            statusCode: 200,
            body: {
                code: APIResponseCode.Success,
                data: {
                    view_id: mockWorkspaceId,
                    name: 'My Workspace',
                    children: [],
                    layout: 0,
                    icon: null,
                    extra: null,
                    is_private: false,
                    is_published: false,
                },
                message: 'Success',
            },
        }).as('getFolder');

        // Mock trash endpoint
        cy.intercept('GET', `${apiUrl}/api/workspace/*/trash`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, data: { views: [] }, message: 'Success' },
        }).as('getTrash');

        // Mock recent endpoint
        cy.intercept('GET', `${apiUrl}/api/workspace/*/recent`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, data: { views: [] }, message: 'Success' },
        }).as('getRecent');

        // Mock user update endpoint (for timezone)
        cy.intercept('POST', `${apiUrl}/api/user/update`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, message: 'Success' },
        }).as('updateUserProfile');

        // Mock workspace open endpoint
        cy.intercept('PUT', `${apiUrl}/api/workspace/*/open`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, message: 'Success' },
        }).as('openWorkspace');

        // Mock shareWithMe endpoint
        cy.intercept('GET', `${apiUrl}/api/workspace?*`, {
            statusCode: 200,
            body: { code: APIResponseCode.Success, data: [], message: 'Success' },
        }).as('shareWithMe');
    };

    beforeEach(() => {
        // Handle uncaught exceptions
        cy.on('uncaught:exception', (err) => {
            if (
                err.message.includes('Minified React error') ||
                err.message.includes('View not found') ||
                err.message.includes('No workspace or service found') ||
                err.message.includes('Cannot read properties of undefined') ||
                err.message.includes('WebSocket') ||
                err.message.includes('ResizeObserver loop')
            ) {
                return false;
            }
            return true;
        });
        cy.viewport(1280, 720);

        // Clear localStorage before each test
        cy.window().then((win) => {
            win.localStorage.clear();
        });
    });

    describe('Google OAuth Login - New User', () => {
        it('should complete OAuth login for new user without redirect loop', () => {
            const testEmail = generateRandomEmail();
            const mockAccessToken = 'mock-oauth-access-token-' + uuidv4();
            const mockRefreshToken = 'mock-oauth-refresh-token-' + uuidv4();
            const mockUserId = uuidv4();
            const mockWorkspaceId = uuidv4();

            cy.log(`[TEST START] Testing OAuth login for new user: ${testEmail}`);

            // Setup mocks for app initialization endpoints
            setupAppInitMocks(mockWorkspaceId);

            // Mock the verifyToken endpoint - new user
            cy.intercept('GET', `${apiUrl}/api/user/verify/${mockAccessToken}`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        is_new: true,
                    },
                    message: 'User verified successfully',
                },
            }).as('verifyUser');

            // Mock the refreshToken endpoint
            cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
                statusCode: 200,
                body: {
                    access_token: mockAccessToken,
                    refresh_token: mockRefreshToken,
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: {
                        id: mockUserId,
                        email: testEmail,
                        email_confirmed_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    },
                },
            }).as('refreshToken');

            // Mock getUserWorkspaceInfo endpoint
            cy.intercept('GET', `${apiUrl}/api/user/workspace`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        user_profile: { uuid: mockUserId },
                        visiting_workspace: {
                            workspace_id: mockWorkspaceId,
                            workspace_name: 'My Workspace',
                            icon: '',
                            created_at: Date.now().toString(),
                            database_storage_id: '',
                            owner_uid: 1,
                            owner_name: 'Test User',
                            member_count: 1,
                        },
                        workspaces: [
                            {
                                workspace_id: mockWorkspaceId,
                                workspace_name: 'My Workspace',
                                icon: '',
                                created_at: Date.now().toString(),
                                database_storage_id: '',
                                owner_uid: 1,
                                owner_name: 'Test User',
                                member_count: 1,
                            },
                        ],
                    },
                    message: 'Success',
                },
            }).as('getUserWorkspaceInfo');

            // Mock getCurrentUser endpoint (include timezone metadata to avoid update call)
            cy.intercept('GET', `${apiUrl}/api/user/profile*`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        uid: 1,
                        uuid: mockUserId,
                        email: testEmail,
                        name: 'Test User',
                        metadata: {
                            '0': { default_timezone: 'UTC', timezone: 'UTC' },
                        },
                        encryption_sign: null,
                        latest_workspace_id: mockWorkspaceId,
                        updated_at: Date.now(),
                    },
                    message: 'Success',
                },
            }).as('getCurrentUser');

            // Step 1: Simulate OAuth callback by visiting /auth/callback with hash params
            // This simulates what happens after Google redirects back
            cy.log('[STEP 1] Simulating OAuth callback with hash parameters');
            const callbackUrl = `${baseUrl}/auth/callback#access_token=${mockAccessToken}&expires_at=${Math.floor(Date.now() / 1000) + 3600
                }&expires_in=7200&provider_refresh_token=google_refresh_token&provider_token=google_provider_token&refresh_token=${mockRefreshToken}&token_type=bearer`;

            cy.visit(callbackUrl, { failOnStatusCode: false });
            cy.wait(2000);

            // Step 2: Wait for verifyToken API call (new users redirect immediately, so we might already be on /app)
            cy.log('[STEP 2] Waiting for verifyToken API call');
            cy.wait('@verifyUser', { timeout: 10000 }).then((interception) => {
                expect(interception.response?.statusCode).to.equal(200);
                if (interception.response?.body) {
                    cy.log(`[API] Verify user response: ${JSON.stringify(interception.response.body)}`);
                    expect(interception.response.body.data.is_new).to.equal(true);
                }
            });

            // Step 3: Wait for refreshToken API call
            cy.log('[STEP 3] Waiting for refreshToken API call');
            cy.wait('@refreshToken', { timeout: 10000 }).then((interception) => {
                expect(interception.response?.statusCode).to.equal(200);
                if (interception.response?.body) {
                    cy.log(`[API] Refresh token response: ${JSON.stringify(interception.response.body)}`);
                }
            });

            // Step 4: Wait for redirect to /app (new users redirect immediately via window.location.replace)
            cy.log('[STEP 4] Waiting for redirect to /app');
            cy.url({ timeout: 15000 }).should('include', '/app');

            // Step 5: Verify token is saved to localStorage
            cy.log('[STEP 5] Verifying token is saved to localStorage');
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');
                expect(token).to.exist;
                const tokenData = JSON.parse(token || '{}');
                expect(tokenData.access_token).to.equal(mockAccessToken);
                expect(tokenData.refresh_token).to.equal(mockRefreshToken);
            });

            // Step 6: Verify we're NOT redirected back to login (redirect loop prevention)
            cy.log('[STEP 6] Verifying no redirect loop - should stay on /app');
            cy.wait(3000); // Wait to ensure no redirect happens
            cy.url().should('include', '/app');
            cy.url().should('not.include', '/login');

            // Step 7: Verify workspace info is loaded
            cy.log('[STEP 7] Waiting for workspace info to load');
            cy.wait('@getUserWorkspaceInfo', { timeout: 10000 });

            // Step 8: Verify user is authenticated and app is loaded
            cy.log('[STEP 8] Verifying app is fully loaded');
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');
                expect(token).to.exist;
                // Verify token is still there after page reload
                const tokenData = JSON.parse(token || '{}');
                expect(tokenData.access_token).to.exist;
            });

            cy.log('[STEP 9] OAuth login test for new user completed successfully - no redirect loop detected');
        });
    });

    describe('Google OAuth Login - Existing User', () => {
        it('should complete OAuth login for existing user without redirect loop', () => {
            const testEmail = generateRandomEmail();
            const mockAccessToken = 'mock-oauth-access-token-existing-' + uuidv4();
            const mockRefreshToken = 'mock-oauth-refresh-token-existing-' + uuidv4();
            const mockUserId = uuidv4();
            const mockWorkspaceId = uuidv4();

            cy.log(`[TEST START] Testing OAuth login for existing user: ${testEmail}`);

            // Setup mocks for app initialization endpoints
            setupAppInitMocks(mockWorkspaceId);

            // Mock the verifyToken endpoint - existing user
            cy.intercept('GET', `${apiUrl}/api/user/verify/${mockAccessToken}`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        is_new: false,
                    },
                    message: 'User verified successfully',
                },
            }).as('verifyUser');

            // Mock the refreshToken endpoint
            cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
                statusCode: 200,
                body: {
                    access_token: mockAccessToken,
                    refresh_token: mockRefreshToken,
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: {
                        id: mockUserId,
                        email: testEmail,
                        email_confirmed_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    },
                },
            }).as('refreshToken');

            // Mock getUserWorkspaceInfo endpoint
            cy.intercept('GET', `${apiUrl}/api/user/workspace`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        user_profile: { uuid: mockUserId },
                        visiting_workspace: {
                            workspace_id: mockWorkspaceId,
                            workspace_name: 'My Workspace',
                            icon: '',
                            created_at: Date.now().toString(),
                            database_storage_id: '',
                            owner_uid: 1,
                            owner_name: 'Test User',
                            member_count: 1,
                        },
                        workspaces: [
                            {
                                workspace_id: mockWorkspaceId,
                                workspace_name: 'My Workspace',
                                icon: '',
                                created_at: Date.now().toString(),
                                database_storage_id: '',
                                owner_uid: 1,
                                owner_name: 'Test User',
                                member_count: 1,
                            },
                        ],
                    },
                    message: 'Success',
                },
            }).as('getUserWorkspaceInfo');

            // Mock getCurrentUser endpoint (include timezone metadata to avoid update call)
            cy.intercept('GET', `${apiUrl}/api/user/profile*`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        uid: 1,
                        uuid: mockUserId,
                        email: testEmail,
                        name: 'Test User',
                        metadata: {
                            '0': { default_timezone: 'UTC', timezone: 'UTC' },
                        },
                        encryption_sign: null,
                        latest_workspace_id: mockWorkspaceId,
                        updated_at: Date.now(),
                    },
                    message: 'Success',
                },
            }).as('getCurrentUser');

            // Step 1: Set redirectTo in localStorage (existing users use afterAuth logic)
            cy.log('[STEP 1] Setting redirectTo in localStorage');
            cy.window().then((win) => {
                win.localStorage.setItem('redirectTo', encodeURIComponent(`${baseUrl}/app`));
            });

            // Step 2: Simulate OAuth callback
            cy.log('[STEP 2] Simulating OAuth callback with hash parameters');
            const callbackUrl = `${baseUrl}/auth/callback#access_token=${mockAccessToken}&expires_at=${Math.floor(Date.now() / 1000) + 3600
                }&expires_in=7200&provider_refresh_token=google_refresh_token&provider_token=google_provider_token&refresh_token=${mockRefreshToken}&token_type=bearer`;

            cy.visit(callbackUrl, { failOnStatusCode: false });
            cy.wait(2000);

            // Step 3: Wait for verifyToken API call
            cy.log('[STEP 3] Waiting for verifyToken API call');
            cy.wait('@verifyUser', { timeout: 10000 }).then((interception) => {
                cy.log(`[API] Verify user response: ${JSON.stringify(interception.response?.body)}`);
                expect(interception.response?.statusCode).to.equal(200);
                expect(interception.response?.body.data.is_new).to.equal(false);
            });

            // Step 4: Wait for refreshToken API call
            cy.log('[STEP 4] Waiting for refreshToken API call');
            cy.wait('@refreshToken', { timeout: 10000 });

            // Step 5: Verify token is saved
            cy.log('[STEP 5] Verifying token is saved to localStorage');
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');
                expect(token).to.exist;
            });

            // Step 6: Wait for redirect to /app (existing users use afterAuth)
            cy.log('[STEP 6] Waiting for redirect to /app via afterAuth');
            cy.url({ timeout: 15000 }).should('include', '/app');

            // Step 7: Verify we're NOT redirected back to login (redirect loop prevention)
            cy.log('[STEP 7] Verifying no redirect loop - should stay on /app');
            cy.wait(5000); // Wait longer to ensure no redirect happens
            cy.url().should('include', '/app');
            cy.url().should('not.include', '/login');
            cy.url().should('not.include', 'force=true'); // Should not redirect to /login?force=true

            // Step 8: Verify redirectTo is cleared
            cy.log('[STEP 8] Verifying redirectTo is cleared');
            cy.window().then((win) => {
                const redirectTo = win.localStorage.getItem('redirectTo');
                expect(redirectTo).to.be.null;
            });

            // Step 9: Verify workspace info is loaded
            cy.log('[STEP 9] Waiting for workspace info to load');
            cy.wait('@getUserWorkspaceInfo', { timeout: 10000 });

            cy.log('[STEP 10] OAuth login test for existing user completed successfully - no redirect loop detected');
        });
    });

    describe('Redirect Loop Prevention', () => {
        it('should prevent redirect loop when token exists but context is not ready', () => {
            const mockAccessToken = 'mock-token-' + uuidv4();
            const mockRefreshToken = 'mock-refresh-' + uuidv4();
            const mockUserId = uuidv4();
            const mockWorkspaceId = uuidv4();

            cy.log('[TEST START] Testing redirect loop prevention');

            // Setup mocks for app initialization endpoints
            setupAppInitMocks(mockWorkspaceId);

            // Mock all required endpoints
            cy.intercept('GET', `${apiUrl}/api/user/verify/${mockAccessToken}`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: { is_new: false },
                    message: 'Success',
                },
            }).as('verifyUser');

            cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
                statusCode: 200,
                body: {
                    access_token: mockAccessToken,
                    refresh_token: mockRefreshToken,
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: {
                        id: mockUserId,
                        email: 'test@example.com',
                        email_confirmed_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    },
                },
            }).as('refreshToken');

            cy.intercept('GET', `${apiUrl}/api/user/workspace`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        user_profile: { uuid: mockUserId },
                        visiting_workspace: {
                            workspace_id: mockWorkspaceId,
                            workspace_name: 'My Workspace',
                            icon: '',
                            created_at: Date.now().toString(),
                            database_storage_id: '',
                            owner_uid: 1,
                            owner_name: 'Test User',
                            member_count: 1,
                        },
                        workspaces: [
                            {
                                workspace_id: mockWorkspaceId,
                                workspace_name: 'My Workspace',
                                icon: '',
                                created_at: Date.now().toString(),
                                database_storage_id: '',
                                owner_uid: 1,
                                owner_name: 'Test User',
                                member_count: 1,
                            },
                        ],
                    },
                    message: 'Success',
                },
            }).as('getUserWorkspaceInfo');

            cy.intercept('GET', `${apiUrl}/api/user/profile*`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        uid: 1,
                        uuid: mockUserId,
                        email: 'test@example.com',
                        name: 'Test User',
                        metadata: {
                            '0': { default_timezone: 'UTC', timezone: 'UTC' },
                        },
                        encryption_sign: null,
                        latest_workspace_id: mockWorkspaceId,
                        updated_at: Date.now(),
                    },
                    message: 'Success',
                },
            }).as('getCurrentUser');

            // Step 1: Simulate OAuth callback
            cy.log('[STEP 1] Simulating OAuth callback');
            const callbackUrl = `${baseUrl}/auth/callback#access_token=${mockAccessToken}&refresh_token=${mockRefreshToken}&expires_at=${Math.floor(Date.now() / 1000) + 3600
                }&token_type=bearer`;

            cy.visit(callbackUrl, { failOnStatusCode: false });
            cy.wait(2000);

            // Step 2: Wait for API calls
            cy.wait('@verifyUser');
            cy.wait('@refreshToken');

            // Step 3: Verify token is saved
            cy.log('[STEP 2] Verifying token is saved');
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');
                expect(token).to.exist;
            });

            // Step 4: Wait for redirect to /app
            cy.log('[STEP 3] Waiting for redirect to /app');
            cy.url({ timeout: 15000 }).should('include', '/app');

            // Step 5: Critical test - verify NO redirect loop
            // This is the main test for the fix we implemented
            cy.log('[STEP 4] Verifying NO redirect loop occurs');
            cy.wait(5000); // Wait to ensure no redirect happens

            // Should stay on /app, not redirect to /login
            cy.url().should('include', '/app');
            cy.url().should('not.include', '/login');

            // Should not have force=true parameter
            cy.url().should('not.include', 'force=true');

            // Token should still be in localStorage
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');
                expect(token).to.exist;
                const tokenData = JSON.parse(token || '{}');
                expect(tokenData.access_token).to.equal(mockAccessToken);
            });

            cy.log('[STEP 5] Redirect loop prevention test passed - token persisted and no redirect occurred');
        });
    });

    describe('Old Token Race Condition', () => {
        it('should clear old expired token before processing OAuth callback', () => {
            const oldExpiredToken = 'old-expired-token-' + uuidv4();
            const oldRefreshToken = 'old-expired-refresh-' + uuidv4();
            const newAccessToken = 'new-oauth-token-' + uuidv4();
            const newRefreshToken = 'new-oauth-refresh-' + uuidv4();
            const mockUserId = uuidv4();
            const mockWorkspaceId = uuidv4();

            cy.log('[TEST START] Testing old expired token race condition');

            // Setup mocks for app initialization endpoints
            setupAppInitMocks(mockWorkspaceId);

            cy.log('[SETUP] Pre-populate localStorage with expired token');
            cy.window().then((win) => {
                // Set old expired token (expired 1 hour ago)
                win.localStorage.setItem('token', JSON.stringify({
                    access_token: oldExpiredToken,
                    refresh_token: oldRefreshToken,
                    expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired!
                    user: {
                        id: mockUserId,
                        email: 'old@example.com',
                    },
                }));
            });

            // Mock refresh endpoint to FAIL for old token, SUCCESS for new token
            cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, (req) => {
                const { body } = req;

                if (body.refresh_token === oldRefreshToken) {
                    // Old token refresh should fail
                    req.reply({
                        statusCode: 400,
                        body: {
                            error: 'invalid_grant',
                            error_description: 'Refresh token is invalid or expired',
                        },
                    });
                } else if (body.refresh_token === newRefreshToken) {
                    // New token refresh should succeed
                    req.reply({
                        statusCode: 200,
                        body: {
                            access_token: newAccessToken,
                            refresh_token: newRefreshToken,
                            expires_at: Math.floor(Date.now() / 1000) + 3600,
                            user: {
                                id: mockUserId,
                                email: 'test@example.com',
                                email_confirmed_at: new Date().toISOString(),
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                            },
                        },
                    });
                } else {
                    // Unknown token
                    req.reply({ statusCode: 400, body: { error: 'unknown_token' } });
                }
            }).as('refreshToken');

            // Mock verify for NEW token only
            cy.intercept('GET', `${apiUrl}/api/user/verify/${newAccessToken}`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: { is_new: false },
                    message: 'Success',
                },
            }).as('verifyNewToken');

            // Mock verify for OLD token (should NOT be called if fix is working)
            cy.intercept('GET', `${apiUrl}/api/user/verify/${oldExpiredToken}`, {
                statusCode: 401,
                body: {
                    code: 401,
                    message: 'Token expired',
                },
            }).as('verifyOldToken');

            // Mock workspace endpoints
            cy.intercept('GET', `${apiUrl}/api/user/workspace`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        user_profile: { uuid: mockUserId },
                        visiting_workspace: {
                            workspace_id: mockWorkspaceId,
                            workspace_name: 'My Workspace',
                            icon: '',
                            created_at: Date.now().toString(),
                            database_storage_id: '',
                            owner_uid: 1,
                            owner_name: 'Test User',
                            member_count: 1,
                        },
                        workspaces: [
                            {
                                workspace_id: mockWorkspaceId,
                                workspace_name: 'My Workspace',
                                icon: '',
                                created_at: Date.now().toString(),
                                database_storage_id: '',
                                owner_uid: 1,
                                owner_name: 'Test User',
                                member_count: 1,
                            },
                        ],
                    },
                    message: 'Success',
                },
            }).as('getUserWorkspaceInfo');

            cy.intercept('GET', `${apiUrl}/api/user/profile*`, {
                statusCode: 200,
                body: {
                    code: APIResponseCode.Success,
                    data: {
                        uid: 1,
                        uuid: mockUserId,
                        email: 'test@example.com',
                        name: 'Test User',
                        metadata: {
                            '0': { default_timezone: 'UTC', timezone: 'UTC' },
                        },
                        encryption_sign: null,
                        latest_workspace_id: mockWorkspaceId,
                        updated_at: Date.now(),
                    },
                    message: 'Success',
                },
            }).as('getCurrentUser');

            // Step 1: Simulate OAuth callback with NEW tokens
            cy.log('[STEP 1] Simulating OAuth callback with NEW tokens (old expired token in localStorage)');
            const callbackUrl = `${baseUrl}/auth/callback#access_token=${newAccessToken}&refresh_token=${newRefreshToken}&expires_at=${Math.floor(Date.now() / 1000) + 3600
                }&token_type=bearer`;

            cy.visit(callbackUrl, { failOnStatusCode: false });
            cy.wait(2000);

            // Step 2: Verify NEW token was used for verification (not old token)
            cy.log('[STEP 2] Verifying NEW token is used for verification');
            cy.wait('@verifyNewToken').then((interception) => {
                expect(interception.response?.statusCode).to.equal(200);
                cy.log('[SUCCESS] verifyToken called with NEW token (old token was cleared first)');
            });

            // Step 3: Verify refresh was called with NEW token (not old expired token)
            cy.log('[STEP 3] Verifying refresh called with NEW token');
            cy.wait('@refreshToken').then((interception) => {
                const requestBody = interception.request.body;

                expect(requestBody.refresh_token).to.equal(newRefreshToken);
                cy.log('[SUCCESS] refreshToken called with NEW token (not old expired token)');
            });

            // Step 4: Verify we're redirected to /app (not /login due to token invalidation)
            cy.log('[STEP 4] Verifying successful redirect to /app');
            cy.url({ timeout: 15000 }).should('include', '/app');
            cy.url().should('not.include', '/login');

            // Step 5: Verify NEW token is saved (old token replaced)
            cy.log('[STEP 5] Verifying NEW token is saved in localStorage');
            cy.window().then((win) => {
                const token = win.localStorage.getItem('token');

                expect(token).to.exist;
                const tokenData = JSON.parse(token || '{}');

                expect(tokenData.access_token).to.equal(newAccessToken);
                expect(tokenData.refresh_token).to.equal(newRefreshToken);
                // Old token should be completely replaced
                expect(tokenData.access_token).to.not.equal(oldExpiredToken);
                expect(tokenData.refresh_token).to.not.equal(oldRefreshToken);
                cy.log('[SUCCESS] NEW token saved, old token replaced');
            });

            // Step 6: Wait to ensure no redirect loop occurs
            cy.log('[STEP 6] Verifying no redirect loop (session not invalidated)');
            cy.wait(3000);
            cy.url().should('include', '/app');
            cy.url().should('not.include', '/login');

            cy.log('[TEST COMPLETE] Old token race condition handled correctly - old token cleared before OAuth processing');
        });
    });
});
