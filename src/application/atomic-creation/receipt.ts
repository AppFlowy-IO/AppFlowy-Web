import type {
  AtomicCreationKind,
  AtomicCreationReceipt,
  AtomicCreationRequests,
  CreateDefaultDatabasePageRequest,
  CreateDefaultDatabaseViewRequest,
  CreateDefaultDocumentPageRequest,
  PublishRowDocumentRequest,
} from './types';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uuid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function version(value: unknown): boolean {
  return value === null || uuid(value);
}

/** Receipts establish immutable identity only. Hydration must still prove current authority/state. */
export function validateAtomicCreationReceipt<K extends AtomicCreationKind>(
  kind: K,
  request: AtomicCreationRequests[K],
  logicalTarget: string,
  value: unknown
): asserts value is AtomicCreationReceipt<K> {
  const invalid = () => {
    throw new Error('Atomic creation returned an invalid receipt');
  };

  if (
    !object(value) ||
    value.request_id !== request.request_id ||
    (value.outcome !== 'applied' && value.outcome !== 'already_applied') ||
    !object(value.result)
  )
    return invalid();
  const result = value.result;

  switch (kind) {
    case 'document': {
      const command = request as CreateDefaultDocumentPageRequest;

      if (result.view_id !== command.view_id || result.database_id !== null) invalid();
      break;
    }

    case 'database': {
      const command = request as CreateDefaultDatabasePageRequest;

      if (result.view_id !== command.container_id || result.database_id !== command.database.database_id) invalid();
      break;
    }

    case 'database-view': {
      const command = request as CreateDefaultDatabaseViewRequest;
      const expected = [
        command.view.view_id,
        ...(command.view.responses_view_id ? [command.view.responses_view_id] : []),
      ];

      if (
        result.view_id !== command.view.view_id ||
        result.database_id !== command.view.database_id ||
        result.database_restore_id !== command.database_restore_id ||
        !Array.isArray(result.view_ids) ||
        result.view_ids.length !== expected.length ||
        result.view_ids.some((id, index) => id !== expected[index]) ||
        !version(result.database_version) ||
        !uuid(result.update_batch_id) ||
        typeof result.database_update_v1 !== 'string' ||
        !result.database_update_v1.length ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(result.database_update_v1)
      )
        invalid();
      break;
    }

    case 'row-document': {
      const command = request as PublishRowDocumentRequest;

      if (
        result.document_id !== logicalTarget ||
        result.row_id !== command.row_id ||
        result.database_id !== command.database_id ||
        result.database_restore_id !== command.database_restore_id ||
        !version(result.row_version) ||
        !version(result.document_version) ||
        !uuid(result.update_batch_id)
      )
        invalid();
      break;
    }
  }
}
