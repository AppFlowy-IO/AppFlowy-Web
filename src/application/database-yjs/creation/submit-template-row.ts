import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { postRowCreation } from '@/application/services/js-services/http/atomic-row-creation-api';

import type { CreatedRowReceipt } from './row-creation-types';
import type { ClaimCompoundCreationRequest, PreparedTemplateRowGraph } from './row-template-graph-types';

interface Progress {
  request_id: string;
  state: 'uploading' | 'published' | 'expired';
  uploaded_object_ids: string[];
}
interface CompoundReceipt {
  request_id: string;
  outcome: 'applied' | 'already_applied';
  result: {
    root_id: string;
    database_id: string;
    collabs: Array<{ object_id: string; kind: string }>;
    view_ids: string[];
    database_branches: Array<{
      database_id: string;
      database_restore_id: string;
      source_view_id: string;
      version: string | null;
    }>;
    update_batch_id: string;
  };
}

function validateProgress(progress: Progress, manifest: ClaimCompoundCreationRequest) {
  const objects = new Set(manifest.objects.map((item) => item.object_id));

  if (
    !progress ||
    progress.request_id !== manifest.request_id ||
    !['uploading', 'published'].includes(progress.state) ||
    !Array.isArray(progress.uploaded_object_ids) ||
    progress.uploaded_object_ids.some((id) => !objects.has(id))
  )
    throw new Error('Template upload response differs from its command');
}

/** Claims and chunks remain private. Only finalize permits the caller to activate a Row. */
export async function submitTemplateRow(
  owner: AtomicCreationOwner,
  databaseId: string,
  graph: PreparedTemplateRowGraph,
  version: string | undefined,
  signal: AbortSignal,
  deadline: number
): Promise<CreatedRowReceipt> {
  if (graph.kind === 'seeded')
    return postRowCreation(owner, `database/${databaseId}/row`, graph.request, signal, deadline);
  const { manifest, seeds } = graph;
  const post = <T>(operation: string, body: unknown) =>
    postRowCreation<T>(owner, `page-view/compound/${operation}`, body, signal, deadline);
  const progress = await post<Progress>('claim', manifest);

  validateProgress(progress, manifest);
  const uploaded = new Set(progress.uploaded_object_ids);
  let chunk: Array<{ object_id: string; seed: string }> = [];
  let chunkBytes = 0;
  const upload = async () => {
    if (!chunk.length) return;
    const result = await post<Progress>('chunk', { request_id: manifest.request_id, objects: chunk });

    validateProgress(result, manifest);
    if (chunk.some((item) => !result.uploaded_object_ids.includes(item.object_id))) {
      throw new Error('Template upload did not acknowledge every object');
    }

    chunk = [];
    chunkBytes = 0;
  };

  if (progress.state !== 'published') {
    for (const object of manifest.objects) {
      if (uploaded.has(object.object_id)) continue;
      const seed = seeds.get(object.object_id);

      if (!seed || object.byte_length > 16 * 1024 * 1024)
        throw new Error('Template object cannot fit in an upload chunk');
      if (chunk.length >= 256 || chunkBytes + object.byte_length > 16 * 1024 * 1024) await upload();
      chunk.push({ object_id: object.object_id, seed });
      chunkBytes += object.byte_length;
    }

    await upload();
  }

  const receipt = await post<CompoundReceipt>('finalize', { request_id: manifest.request_id });
  const result = receipt?.result;
  const branch = result?.database_branches?.find((item) => item.database_id === databaseId);
  const expectedCollabs = new Set(manifest.objects.map((item) => `${item.object_id}:${item.kind}`));
  const actualCollabs = result?.collabs?.map((item) => `${item.object_id}:${item.kind}`) ?? [];
  const actualViews = new Set(result?.view_ids);
  // Every linked database is part of the publication barrier, including a self-link to
  // the parent. Reject missing, duplicated, or substituted branches before activation.
  const expectedBranches = new Map<string, { database_restore_id: string; source_view_id: string }>(
    manifest.database_extensions.map((extension) => [extension.database_id, extension])
  );

  expectedBranches.set(databaseId, manifest.target);
  const actualBranches = result?.database_branches ?? [];
  const branchesMatch =
    actualBranches.length === expectedBranches.size &&
    new Set(actualBranches.map((item) => item.database_id)).size === expectedBranches.size &&
    actualBranches.every((item) => {
      const expected = expectedBranches.get(item.database_id);

      return (
        expected &&
        item.database_restore_id === expected.database_restore_id &&
        item.source_view_id === expected.source_view_id
      );
    });

  if (
    receipt?.request_id !== manifest.request_id ||
    !['applied', 'already_applied'].includes(receipt.outcome) ||
    result?.root_id !== manifest.target.row_id ||
    result.database_id !== databaseId ||
    !result.update_batch_id ||
    actualCollabs.length !== expectedCollabs.size ||
    new Set(actualCollabs).size !== expectedCollabs.size ||
    actualCollabs.some((id) => !expectedCollabs.has(id)) ||
    result.view_ids.length !== manifest.views.length ||
    actualViews.size !== manifest.views.length ||
    !branchesMatch ||
    manifest.views.some((view) => !actualViews.has(view.view_id)) ||
    !branch ||
    branch.database_restore_id !== manifest.target.database_restore_id ||
    branch.source_view_id !== manifest.target.source_view_id ||
    (branch.version ?? undefined) !== version
  ) {
    throw new Error('Published template graph differs from its command');
  }

  // Compound receipts intentionally contain no replayable content; normal activation reads authority.
  return {
    request_id: receipt.request_id,
    outcome: receipt.outcome,
    result: {
      row_id: result.root_id,
      database_id: databaseId,
      database_restore_id: branch.database_restore_id,
      database_version: branch.version,
      database_update_v1: '',
      update_batch_id: result.update_batch_id,
    },
  };
}
