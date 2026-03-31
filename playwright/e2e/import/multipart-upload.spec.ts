/**
 * Integration tests for multipart import upload.
 *
 * These tests run against the local AppFlowy Cloud server and exercise the
 * presigned-URL upload flow end-to-end, including the new multipart path for
 * files that exceed the configurable threshold (default 80 MB).
 *
 * A dummy ZIP is generated in-memory so no large fixture files need to be
 * committed to the repository.
 */

import { test, expect } from '@playwright/test';
import { AuthTestUtils } from '../../support/auth-utils';
import { TestConfig, generateRandomEmail } from '../../support/test-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ZIP file (empty archive – 22 bytes). */
const EMPTY_ZIP_EOCD = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, // End of central directory signature
  0x00, 0x00, // Number of this disk
  0x00, 0x00, // Disk where central directory starts
  0x00, 0x00, // Number of central directory records on this disk
  0x00, 0x00, // Total number of central directory records
  0x00, 0x00, 0x00, 0x00, // Size of central directory
  0x00, 0x00, 0x00, 0x00, // Offset of start of central directory
  0x00, 0x00, // Comment length
]);

/**
 * Build a Buffer that looks like a ZIP file of the requested size.
 *
 * We prepend zero-padding before a valid End-of-Central-Directory record so
 * that the file is recognised as `application/zip` by most tooling while being
 * fast to generate (no compression, no real entries).
 */
function makeDummyZip(sizeBytes: number): Buffer {
  if (sizeBytes < EMPTY_ZIP_EOCD.length) {
    return EMPTY_ZIP_EOCD;
  }

  const padding = Buffer.alloc(sizeBytes - EMPTY_ZIP_EOCD.length, 0);
  return Buffer.concat([padding, EMPTY_ZIP_EOCD]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Import multipart upload', () => {
  let accessToken: string;
  const apiUrl = TestConfig.apiUrl; // e.g. http://localhost:8000

  test.beforeAll(async ({ request }) => {
    const auth = new AuthTestUtils();
    const email = generateRandomEmail();

    // 1. Obtain an admin token and generate a magic link for a fresh user.
    const signInUrl = await auth.generateSignInUrl(request, email);

    // 2. Extract the access token from the sign-in callback URL.
    const hashIndex = signInUrl.indexOf('#');
    expect(hashIndex).toBeGreaterThan(-1);

    const params = new URLSearchParams(signInUrl.substring(hashIndex + 1));
    accessToken = params.get('access_token') ?? '';
    expect(accessToken).not.toBe('');

    // 3. Call the verify endpoint so the server creates the af_user record.
    const verifyResp = await request.get(
      `${apiUrl}/api/user/verify/${accessToken}`,
      { failOnStatusCode: false, timeout: 30_000 },
    );
    expect(verifyResp.ok()).toBeTruthy();
  });

  // -----------------------------------------------------------------------

  test('small file (<80 MB) returns a single presigned URL', async ({
    request,
  }) => {
    const file = makeDummyZip(1024); // 1 KB

    const resp = await request.post(`${apiUrl}/api/import/create`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        workspace_name: 'test-small-upload',
        content_length: file.length,
      },
    });

    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);

    const data = body.data;
    expect(data.task_id).toBeTruthy();
    expect(data.presigned_url).toBeTruthy();
    expect(data.presigned_url).not.toBe('');
    // multipart should be absent or null for small files.
    expect(data.multipart).toBeFalsy();

    // Upload to the presigned URL.
    const uploadResp = await request.put(data.presigned_url, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(file.length),
      },
      data: file,
    });
    expect(uploadResp.ok()).toBeTruthy();
  });

  // -----------------------------------------------------------------------

  test('large file (>80 MB) returns multipart presigned URLs and completes upload', async ({
    request,
  }) => {
    // 85 MB – just over the default 80 MB threshold.
    const SIZE = 85 * 1024 * 1024;
    const file = makeDummyZip(SIZE);

    // 1. Create the import task — should return multipart info.
    const createResp = await request.post(`${apiUrl}/api/import/create`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        workspace_name: 'test-multipart-upload',
        content_length: file.length,
      },
    });

    expect(createResp.ok()).toBeTruthy();
    const createBody = await createResp.json();
    expect(createBody.code).toBe(0);

    const data = createBody.data;
    expect(data.task_id).toBeTruthy();
    expect(data.multipart).toBeTruthy();
    // presigned_url should be empty for multipart.
    expect(data.presigned_url).toBe('');

    const multipart = data.multipart;
    expect(multipart.upload_id).toBeTruthy();
    expect(multipart.s3_key).toBeTruthy();
    expect(multipart.part_presigned_urls.length).toBeGreaterThan(0);

    // 2. Upload each part.
    const partCount = multipart.part_presigned_urls.length;
    const partSize = Math.ceil(file.length / partCount);
    const completedParts: { e_tag: string; part_number: number }[] = [];

    for (const partInfo of multipart.part_presigned_urls) {
      const start = (partInfo.part_number - 1) * partSize;
      const end = Math.min(start + partSize, file.length);
      const chunk = file.subarray(start, end);

      const putResp = await request.put(partInfo.presigned_url, {
        headers: { 'Content-Length': String(chunk.length) },
        data: chunk,
      });
      expect(putResp.ok()).toBeTruthy();

      const eTag = putResp.headers()['etag']?.replace(/"/g, '');
      expect(eTag).toBeTruthy();
      completedParts.push({ e_tag: eTag!, part_number: partInfo.part_number });
    }

    expect(completedParts.length).toBe(partCount);

    // 3. Complete the multipart upload.
    const completeResp = await request.post(
      `${apiUrl}/api/import/complete-multipart`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          s3_key: multipart.s3_key,
          upload_id: multipart.upload_id,
          parts: completedParts,
        },
      },
    );
    expect(completeResp.ok()).toBeTruthy();
    const completeBody = await completeResp.json();
    expect(completeBody.code).toBe(0);
  });
});
