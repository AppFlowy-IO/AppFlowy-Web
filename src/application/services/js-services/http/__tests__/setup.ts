/**
 * Shared test setup and utilities for HTTP API integration tests
 */

// Mock window object for Node environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).window = {
    location: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000',
    },
    localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
    },
};

// Also mock localStorage globally for direct access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).localStorage = (global as any).window.localStorage;

// Polyfill File class for Node.js environment
if (typeof File === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).File = class File {
        name: string;
        type: string;
        size: number;
        lastModified: number;
        content: string[];

        constructor(bits: string[], filename: string, options?: { type?: string }) {
            this.content = bits;
            this.name = filename;
            this.type = options?.type || '';
            this.size = bits.join('').length;
            this.lastModified = Date.now();
        }
    };
}

// Load environment variables from .env file (or dev.env if .env doesn't exist)
import * as dotenv from 'dotenv';

import * as fs from 'fs';
import * as path from 'path';

// Try to load .env first, fallback to dev.env if .env doesn't exist
const envPath = path.resolve(process.cwd(), '.env');
const devEnvPath = path.resolve(process.cwd(), 'dev.env');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else if (fs.existsSync(devEnvPath)) {
    dotenv.config({ path: devEnvPath });
} else {
    // If neither exists, dotenv will silently fail and use process.env
    dotenv.config();
}

import { jest } from '@jest/globals';

import * as APIService from '../http_api';
import { initAPIService } from '../http_api';

// Mock problematic dependencies that aren't needed for API testing
// Fix dayjs import issue in Node.js environment
jest.mock('dayjs', () => {
    const dayjs = jest.requireActual('dayjs');

    // Return both default and named exports to handle different import styles
    return {
        __esModule: true,
        default: dayjs,
    };
});

jest.mock('@/utils/runtime-config', () => ({
    getConfigValue: jest.fn((key: string, defaultValue: string) => {
        const value = process.env[key];

        if (!value && !defaultValue) {
            throw new Error(`Environment variable ${key} must be set`);
        }

        return value || defaultValue;
    }),
}));

jest.mock('@/utils/file-storage-url', () => ({
    getAppFlowyFileUrl: jest.fn((workspaceId: string, viewId: string, fileId: string) => `mock://${workspaceId}/${viewId}/${fileId}`),
    getAppFlowyFileUploadUrl: jest.fn((workspaceId: string, viewId: string) => `mock://${workspaceId}/${viewId}/upload`),
    resolveFileUrl: jest.fn((urlOrId: string) => urlOrId),
    isFileURL: jest.fn(() => true),
    isAppFlowyFileStorageUrl: jest.fn(() => true),
}));

// Mock the session/token module (not @/application/session!)
jest.mock('@/application/session/token', () => ({
    getTokenParsed: jest.fn(() => null), // Default to null, tests will override with mockReturnValue
    invalidToken: jest.fn(),
}));

// Mock UI notification components
jest.mock('@/components/_shared/notify', () => ({
    notify: {
        success: jest.fn(),
        error: jest.fn(),
        warning: jest.fn(),
        info: jest.fn(),
        clear: jest.fn(),
    },
}));

export type EnvConfig = {
    baseURL: string;
    gotrueURL: string;
    wsURL: string;
};

export function getEnvConfig(): EnvConfig {
    const baseURL = process.env.APPFLOWY_BASE_URL;
    const gotrueURL = process.env.APPFLOWY_GOTRUE_BASE_URL;
    const wsURL = process.env.APPFLOWY_WS_BASE_URL;

    if (!baseURL || !gotrueURL || !wsURL) {
        throw new Error('Required environment variables (APPFLOWY_BASE_URL, APPFLOWY_GOTRUE_BASE_URL, APPFLOWY_WS_BASE_URL) must be set');
    }

    return { baseURL, gotrueURL, wsURL };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureWorkspace(mockToken?: any): Promise<string> {
    // Set up mock if provided
    if (mockToken) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getTokenParsed } = require('@/application/session/token');

        getTokenParsed.mockReturnValue(mockToken);

        // Also set the Authorization header directly on the axios instance
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getAxiosInstance } = require('../http_api');
        const axiosInstance = getAxiosInstance();

        if (axiosInstance && mockToken.access_token) {
            axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${mockToken.access_token}`;
        }
    }

    // Server always returns a workspace (creates "My Workspace" for new users)
    const workspaceInfo = await APIService.getUserWorkspaceInfo();

    return workspaceInfo.selected_workspace.id;
}

// Auth helper for creating test users
export class AuthHelper {
    private gotrueURL: string;

    constructor(gotrueURL: string) {
        this.gotrueURL = gotrueURL;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signInUser(email: string): Promise<{ accessToken: string; refreshToken: string; user: any }> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const axios = require('axios');
        const baseURL = getEnvConfig().baseURL;

        try {
            // Try to sign up the user
            const signupResponse = await axios.post(`${this.gotrueURL}/signup`, {
                email: email,
                password: 'testpassword123',
            });

            const accessToken = signupResponse.data.access_token;
            const refreshToken = signupResponse.data.refresh_token;
            const user = signupResponse.data.user;

            // Verify the token to create user profile in backend
            await axios.get(`${baseURL}/api/user/verify/${accessToken}`, {
                validateStatus: () => true,
            });

            return {
                accessToken,
                refreshToken,
                user,
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            // If signup fails (user exists), try to sign in
            if (error.response?.status === 422 || error.response?.status === 400) {
                const signinResponse = await axios.post(`${this.gotrueURL}/token?grant_type=password`, {
                    email: email,
                    password: 'testpassword123',
                });

                const accessToken = signinResponse.data.access_token;
                const refreshToken = signinResponse.data.refresh_token;
                const user = signinResponse.data.user;

                // Verify the token to ensure user profile exists
                await axios.get(`${baseURL}/api/user/verify/${accessToken}`, {
                    validateStatus: () => true,
                });

                return {
                    accessToken,
                    refreshToken,
                    user,
                };
            }

            throw error;
        }
    }
}

// Export commonly used test data
export { APIService, initAPIService };
