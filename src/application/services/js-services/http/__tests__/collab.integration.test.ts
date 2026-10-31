/**
 * @jest-environment node
 *
 * Integration tests for Collaboration operations
 */

import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import { getEnvConfig, ensureWorkspace, AuthHelper, APIService, initAPIService } from './setup';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { Types, ViewLayout } from '@/application/types';

describe('HTTP API - Collaboration Operations', () => {
    let testWorkspaceId: string;
    let testAccessToken: string;
    let authHelper: AuthHelper;
    let mockToken: any;

    beforeAll(async () => {
        const envConfig = getEnvConfig();
        authHelper = new AuthHelper(envConfig.gotrueURL);

        // setup.ts mocks runtime-config without the local-development probe
        // that initAPIService reads: this suite talks to the server as given.
        const runtimeConfig = jest.requireMock<Record<string, unknown>>('@/utils/runtime-config');

        runtimeConfig.isLocalDevelopment ??= () => false;

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

    describe('Database document', () => {
        /** What a response carried, by request. */
        type SeenResponse = { url: string; contentType: string; contentEncoding: string; body: Uint8Array | null };

        /** The bytes of a binary response body (an ArrayBuffer, or a Buffer under Node); null for any other body. */
        const bytesOf = (data: unknown): Uint8Array | null => {
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            return null;
        };

        it('reads a database document as binary through its full-sync endpoint, not as JSON', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            const created = await APIService.addAppPage(testWorkspaceId, outline[0].view_id, {
                layout: ViewLayout.Grid,
                name: `Binary read ${uuidv4().slice(0, 8)}`,
            });
            const databaseId = created.database_id;

            expect(databaseId).toBeTruthy();
            const axiosInstance = APIService.getAxiosInstance();

            if (!axiosInstance) { throw new Error('The API service has no axios instance'); }
            const seen: SeenResponse[] = [];
            const interceptor = axiosInstance.interceptors.response.use((response) => {
                seen.push({
                    url: String(response.config.url ?? ''),
                    contentType: String(response.headers['content-type'] ?? ''),
                    contentEncoding: String(response.headers['content-encoding'] ?? ''),
                    body: bytesOf(response.data),
                });
                return response;
            });

            try {
                const result = await APIService.getCollab(testWorkspaceId, databaseId as string, Types.Database);
                const binary = seen.filter((entry) => entry.url.endsWith(`/collab/${databaseId}/full-sync`));

                // One binary read, and no JSON read of the document.
                expect(binary).toHaveLength(1);
                expect(seen.filter((entry) => entry.url.endsWith(`/collab/${databaseId}`))).toEqual([]);
                const [response] = binary;

                expect(response.contentType).not.toMatch(/json/);
                // Binary, and gzipped as asked (or compressed by the transport).
                expect(response.body).not.toBeNull();
                const gzipped = response.body !== null && response.body[0] === 0x1f && response.body[1] === 0x8b;

                expect(gzipped || response.contentEncoding !== '').toBe(true);

                // The bytes are the database document.
                const doc = new Y.Doc();

                Y.applyUpdate(doc, result.data);
                const database = doc.getMap('data').get('database') as Y.Map<unknown> | undefined;

                expect(database?.get('id')).toBe(databaseId);

                // And they cost a fraction of what the JSON route sends for the same document.
                const json = await axiosInstance.get(`/api/workspace/v1/${testWorkspaceId}/collab/${databaseId}`, {
                    params: { collab_type: Types.Database },
                    responseType: 'arraybuffer',
                });

                expect(response.body?.byteLength ?? Infinity).toBeLessThan(bytesOf(json.data)?.byteLength ?? 0);
            } finally {
                axiosInstance.interceptors.response.eject(interceptor);
            }
        }, 60000);

        /** Runs `action` as a browser that cannot inflate gzip streams would: the read asks for no compression. */
        const withoutStreamingGzip = async <T>(action: () => Promise<T>): Promise<T> => {
            const decompression = globalThis.DecompressionStream;

            Object.assign(globalThis, { DecompressionStream: undefined });
            try {
                return await action();
            } finally {
                Object.assign(globalThis, { DecompressionStream: decompression });
            }
        };

        it('reads it as raw binary where the browser cannot inflate gzip', async () => {
            if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
            const { outline } = await APIService.getAppOutline(testWorkspaceId);
            const created = await APIService.addAppPage(testWorkspaceId, outline[0].view_id, {
                layout: ViewLayout.Grid,
                name: `Raw binary read ${uuidv4().slice(0, 8)}`,
            });
            const databaseId = created.database_id as string;
            const axiosInstance = APIService.getAxiosInstance();

            if (!axiosInstance) { throw new Error('The API service has no axios instance'); }
            const seen: SeenResponse[] = [];
            const interceptor = axiosInstance.interceptors.response.use((response) => {
                seen.push({
                    url: String(response.config.url ?? ''),
                    contentType: String(response.headers['content-type'] ?? ''),
                    contentEncoding: String(response.headers['content-encoding'] ?? ''),
                    body: bytesOf(response.data),
                });
                return response;
            });

            try {
                const result = await withoutStreamingGzip(() =>
                    APIService.getCollab(testWorkspaceId, databaseId, Types.Database)
                );
                const binary = seen.filter((entry) => entry.url.endsWith(`/collab/${databaseId}/full-sync`));

                expect(binary).toHaveLength(1);
                expect(seen.filter((entry) => entry.url.endsWith(`/collab/${databaseId}`))).toEqual([]);
                expect(binary[0].contentType).not.toMatch(/json/);
                // Not gzipped: the bytes are the update itself.
                expect(Array.from(binary[0].body?.subarray(0, 2) ?? [])).not.toEqual([0x1f, 0x8b]);
                const doc = new Y.Doc();

                Y.applyUpdate(doc, result.data);
                expect((doc.getMap('data').get('database') as Y.Map<unknown> | undefined)?.get('id')).toBe(databaseId);
            } finally {
                axiosInstance.interceptors.response.eject(interceptor);
            }
        }, 60000);

        it.each([
            ['with', false],
            ['without', true],
        ])(
            'falls back to the JSON route when the binary read is refused, and fails as that route does (%s streaming gzip)',
            async (_label, noStreamingGzip) => {
                if (!testWorkspaceId) { throw new Error('testWorkspaceId is not available'); }
                const axiosInstance = APIService.getAxiosInstance();

                if (!axiosInstance) { throw new Error('The API service has no axios instance'); }
                const unknownDatabaseId = uuidv4();
                const requested: string[] = [];
                const interceptor = axiosInstance.interceptors.request.use((config) => {
                    requested.push(String(config.url ?? ''));
                    return config;
                });
                const read = () => APIService.getCollab(testWorkspaceId, unknownDatabaseId, Types.Database);

                try {
                    const failure = await (noStreamingGzip ? withoutStreamingGzip(read) : read()).then(
                        () => null,
                        (error: unknown) => error as { message?: string }
                    );

                    // The JSON route reports the missing document; the binary read's answer is never used as one.
                    expect(failure).not.toBeNull();
                    expect(failure?.message ?? '').not.toMatch(/database document/);
                    // The binary read came first, then the JSON read of the same document.
                    const binaryAt = requested.findIndex((url) => url.endsWith(`/collab/${unknownDatabaseId}/full-sync`));
                    const jsonAt = requested.findIndex((url) => url.endsWith(`/collab/${unknownDatabaseId}`));

                    expect(requested.filter((url) => url.endsWith(`/collab/${unknownDatabaseId}/full-sync`))).toHaveLength(1);
                    expect(binaryAt).toBeGreaterThanOrEqual(0);
                    expect(jsonAt).toBeGreaterThan(binaryAt);
                } finally {
                    axiosInstance.interceptors.request.eject(interceptor);
                }
            },
            60000
        );
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
