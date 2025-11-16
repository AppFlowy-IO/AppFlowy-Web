/**
 * Centralized API mocking utilities for E2E tests
 * Consolidates common API intercept patterns to reduce duplication
 *
 * Usage:
 * ```typescript
 * import { mockAuthEndpoints, mockWorkspaceEndpoints, createAuthResponse } from '@/cypress/support/api-mocks';
 *
 * // Mock all standard auth endpoints
 * const { userId, accessToken, refreshToken } = mockAuthEndpoints(testEmail);
 *
 * // Mock workspace endpoints
 * const { workspaceId } = mockWorkspaceEndpoints();
 * ```
 */

import { v4 as uuidv4 } from 'uuid';
import { TestConfig } from './test-config';

/**
 * Creates a standard GoTrue auth response body
 * Used for password login, OTP, refresh token, etc.
 */
export const createAuthResponse = (
  email: string,
  accessToken: string,
  refreshToken: string,
  userId = uuidv4()
) => ({
  access_token: accessToken,
  refresh_token: refreshToken,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: userId,
    email,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
});

/**
 * Mocks standard authentication endpoints (password login, verify, refresh)
 * Returns the generated IDs and tokens for use in tests
 */
export const mockAuthEndpoints = (
  email: string,
  accessToken = `mock-token-${uuidv4()}`,
  refreshToken = `mock-refresh-${uuidv4()}`,
  userId = uuidv4()
) => {
  const { gotrueUrl, apiUrl } = TestConfig;

  // Password login
  cy.intercept('POST', `${gotrueUrl}/token?grant_type=password`, {
    statusCode: 200,
    body: createAuthResponse(email, accessToken, refreshToken, userId),
  }).as('passwordLogin');

  // Verify token
  cy.intercept('GET', `${apiUrl}/api/user/verify/${accessToken}`, {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        is_new: false,
      },
      message: 'User verified successfully',
    },
  }).as('verifyUser');

  // Refresh token
  cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
    statusCode: 200,
    body: createAuthResponse(email, accessToken, refreshToken, userId),
  }).as('refreshToken');

  return { userId, accessToken, refreshToken };
};

/**
 * Mocks OTP (One-Time Password) authentication endpoints
 */
export const mockOTPEndpoints = (
  email: string,
  accessToken = `mock-otp-token-${uuidv4()}`,
  refreshToken = `mock-otp-refresh-${uuidv4()}`,
  userId = uuidv4()
) => {
  const { gotrueUrl, apiUrl } = TestConfig;

  // OTP login
  cy.intercept('POST', `${gotrueUrl}/otp`, {
    statusCode: 200,
    body: {},
  }).as('sendOTP');

  // Verify OTP
  cy.intercept('POST', `${gotrueUrl}/verify`, {
    statusCode: 200,
    body: createAuthResponse(email, accessToken, refreshToken, userId),
  }).as('verifyOTP');

  // Verify token
  cy.intercept('GET', `${apiUrl}/api/user/verify/${accessToken}`, {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        is_new: false,
      },
      message: 'User verified successfully',
    },
  }).as('verifyUser');

  // Refresh token
  cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
    statusCode: 200,
    body: createAuthResponse(email, accessToken, refreshToken, userId),
  }).as('refreshToken');

  return { userId, accessToken, refreshToken };
};

/**
 * Mocks workspace-related API endpoints
 * Returns workspace and user IDs for use in tests
 */
export const mockWorkspaceEndpoints = (
  workspaceId = uuidv4(),
  userId = uuidv4(),
  workspaceName = 'Test Workspace'
) => {
  const { apiUrl } = TestConfig;

  cy.intercept('GET', `${apiUrl}/api/user/workspace`, {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        user_profile: { uuid: userId },
        visiting_workspace: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          icon: '',
          created_at: Date.now().toString(),
          database_storage_id: '',
          owner_uid: 1,
          owner_name: 'Test User',
          member_count: 1,
        },
        workspaces: [
          {
            workspace_id: workspaceId,
            workspace_name: workspaceName,
            icon: '',
            created_at: Date.now().toString(),
            database_storage_id: '',
            owner_uid: 1,
            owner_name: 'Test User',
            member_count: 1,
          },
        ],
      },
    },
  }).as('getUserWorkspaceInfo');

  return { workspaceId, userId };
};

/**
 * Mocks user verification endpoint with custom response
 * Useful for testing new vs existing user scenarios
 */
export const mockUserVerification = (
  accessToken: string,
  isNewUser = false
) => {
  const { apiUrl } = TestConfig;

  cy.intercept('GET', `${apiUrl}/api/user/verify/${accessToken}`, {
    statusCode: 200,
    body: {
      code: 0,
      data: {
        is_new: isNewUser,
      },
      message: 'User verified successfully',
    },
  }).as('verifyUser');
};

/**
 * Mocks all common endpoints for a complete auth flow
 * Convenience function that sets up auth + workspace mocks
 */
export const mockCompleteAuthFlow = (
  email: string,
  accessToken = `mock-token-${uuidv4()}`,
  refreshToken = `mock-refresh-${uuidv4()}`,
  userId = uuidv4(),
  workspaceId = uuidv4()
) => {
  const authMocks = mockAuthEndpoints(email, accessToken, refreshToken, userId);
  const workspaceMocks = mockWorkspaceEndpoints(workspaceId, userId);

  return {
    ...authMocks,
    ...workspaceMocks,
  };
};
