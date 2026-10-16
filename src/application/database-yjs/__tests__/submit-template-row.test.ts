import { v4 as uuid } from 'uuid';

import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { postRowCreation } from '@/application/services/js-services/http/atomic-row-creation-api';

import type { ClaimCompoundCreationRequest } from '../creation/row-template-graph-types';
import { submitTemplateRow } from '../creation/submit-template-row';

jest.mock('@/application/services/js-services/http/atomic-row-creation-api', () => ({ postRowCreation: jest.fn() }));

function fixture() {
  const manifest: ClaimCompoundCreationRequest = {
    request_id: uuid(),
    target: {
      kind: 'row',
      row_id: uuid(),
      database_id: uuid(),
      database_restore_id: uuid(),
      source_view_id: uuid(),
      position: { kind: 'end' },
      position_view_ids: [],
    },
    objects: [],
    views: [],
    database_extensions: [],
  };
  const object = (size: number) => ({
    object_id: uuid(),
    kind: 'database_row' as const,
    byte_length: size,
    sha256: [1],
  });

  manifest.objects = [object(10 * 1024 * 1024), object(8 * 1024 * 1024), object(1024)];
  const progress = { request_id: manifest.request_id, state: 'uploading', uploaded_object_ids: [] as string[] };
  const receipt = {
    request_id: manifest.request_id,
    outcome: 'applied',
    result: {
      root_id: manifest.target.row_id,
      database_id: manifest.target.database_id,
      collabs: manifest.objects.map(({ object_id, kind }) => ({ object_id, kind })),
      view_ids: [],
      database_branches: [
        {
          database_id: manifest.target.database_id,
          database_restore_id: manifest.target.database_restore_id,
          source_view_id: manifest.target.source_view_id,
          version: null,
        },
      ],
      update_batch_id: uuid(),
    },
  };

  jest.mocked(postRowCreation).mockImplementation(async (_owner, path, body) => {
    if (path.endsWith('/finalize')) return receipt;
    if (path.endsWith('/chunk'))
      progress.uploaded_object_ids.push(
        ...(body as { objects: { object_id: string }[] }).objects.map((x) => x.object_id)
      );
    return { ...progress, uploaded_object_ids: [...progress.uploaded_object_ids] };
  });
  const run = () =>
    submitTemplateRow(
      { workspaceId: uuid() } as AtomicCreationOwner,
      manifest.target.database_id,
      { kind: 'compound', manifest, seeds: new Map(manifest.objects.map((item) => [item.object_id, 'seed'])) },
      undefined,
      new AbortController().signal,
      Date.now() + 30_000
    );

  return { manifest, receipt, progress, run };
}

beforeEach(() => jest.clearAllMocks());

it('uploads privately in byte-bounded chunks before one complete finalize', async () => {
  const f = fixture();

  await expect(f.run()).resolves.toMatchObject({ result: { row_id: f.manifest.target.row_id, database_update_v1: '' } });
  const calls = jest.mocked(postRowCreation).mock.calls;

  expect(calls.map((call) => call[1])).toEqual([
    'page-view/compound/claim',
    'page-view/compound/chunk',
    'page-view/compound/chunk',
    'page-view/compound/finalize',
  ]);
  expect((calls[1][2] as { objects: unknown[] }).objects).toHaveLength(1);
  expect((calls[2][2] as { objects: unknown[] }).objects).toHaveLength(2);
});

it('a published claim fetches its immutable receipt without uploading old snapshots', async () => {
  const f = fixture();

  f.progress.state = 'published';
  await f.run();
  expect(jest.mocked(postRowCreation).mock.calls.map((call) => call[1])).toEqual([
    'page-view/compound/claim',
    'page-view/compound/finalize',
  ]);
});

it.each(['identity', 'membership', 'branch', 'progress'])('rejects a mismatched %s before activation', async (kind) => {
  const f = fixture();

  if (kind === 'identity') f.receipt.result.root_id = uuid();
  if (kind === 'membership') f.receipt.result.collabs.pop();
  if (kind === 'branch') f.receipt.result.database_branches[0].database_restore_id = uuid();
  if (kind === 'progress') f.progress.request_id = uuid();
  await expect(f.run()).rejects.toThrow();
  if (kind === 'progress') expect(postRowCreation).toHaveBeenCalledTimes(1);
});

function linkedBranch(f: ReturnType<typeof fixture>, selfLinked = false) {
  const branch = selfLinked
    ? f.receipt.result.database_branches[0]
    : {
        database_id: uuid(),
        database_restore_id: uuid(),
        source_view_id: uuid(),
        version: null,
      };

  f.manifest.database_extensions.push({ ...branch, views: [], dependency_fields: [] });
  if (!selfLinked) f.receipt.result.database_branches.push(branch);
  return branch;
}

it.each([false, true])('validates every linked database branch, including self-linked=%s', async (selfLinked) => {
  const f = fixture();

  linkedBranch(f, selfLinked);
  await expect(f.run()).resolves.toMatchObject({ result: { row_id: f.manifest.target.row_id } });
});

it.each(['missing', 'restore', 'source', 'duplicate', 'foreign'])(
  'rejects a %s linked branch while the parent branch still matches',
  async (kind) => {
    const f = fixture();
    const linked = linkedBranch(f);

    if (kind === 'missing') f.receipt.result.database_branches.pop();
    if (kind === 'restore') linked.database_restore_id = uuid();
    if (kind === 'source') linked.source_view_id = uuid();
    if (kind === 'duplicate') f.receipt.result.database_branches.push({ ...linked });
    if (kind === 'foreign') linked.database_id = uuid();
    await expect(f.run()).rejects.toThrow('Published template graph differs from its command');
  }
);
