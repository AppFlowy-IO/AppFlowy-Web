import { useEffect, useRef, useState } from 'react';

import { useDatabase, useDatabaseContext, useDatabaseFields, useDatabaseView } from '@/application/database-yjs/context';
import {
  publishExternalDatabaseFields,
  registerExternalDatabaseFields,
} from '@/application/database-yjs/external-fields';
import { useDatabaseVerification } from '@/application/page-verification/database';
import { getInlineViewRowOrders } from '@/application/database-yjs/row-order-visibility';
import { verificationFieldSnapshot, verificationSnapshotText } from '@/application/page-verification/snapshot';
import { verificationStore } from '@/application/page-verification/store';
import { YjsDatabaseKey } from '@/application/types';

/** Exposes server-owned values to the existing formula and calculation readers without CRDT writes. */
export function VerificationDatabaseValues() {
  const { field, property, store: propertyStore } = useDatabaseVerification();
  const fields = useDatabaseFields();
  const database = useDatabase();
  const view = useDatabaseView();
  const inlineRows = getInlineViewRowOrders(database);
  const { rowMap } = useDatabaseContext();
  const store = propertyStore ? verificationStore(propertyStore.workspaceId, propertyStore.userId) : undefined;
  const [rowIds, setRowIds] = useState<string[]>([]);

  useEffect(() => {
    if (!field || !view) return;
    const refresh = () =>
      setRowIds(
        [...new Set([
          ...(view.get(YjsDatabaseKey.row_orders)?.toArray() ?? []),
          ...(inlineRows?.toArray() ?? []),
        ].map((row) => row.id))]
      );

    refresh();
    view.observeDeep(refresh);
    inlineRows?.observeDeep(refresh);
    return () => {
      view.unobserveDeep(refresh);
      inlineRows?.unobserveDeep(refresh);
    };
  }, [field, view, inlineRows]);

  useEffect(() => {
    if (!fields || !field || !store || !property) return;
    const fieldId = field.get(YjsDatabaseKey.id);
    const readSnapshot = (rowId: string) => {
      if (fields.get(fieldId) !== field) return undefined;
      return verificationFieldSnapshot(field, property.database_id, property.id, store.snapshot(rowId).data);
    };

    return registerExternalDatabaseFields(fields, [
      {
        field,
        readValue: (rowId) => verificationSnapshotText(readSnapshot(rowId)),
        readVerificationSnapshot: readSnapshot,
      },
    ]);
  }, [fields, field, store, property]);

  const idsKey = JSON.stringify([...new Set([...rowIds, ...Object.keys(rowMap ?? {})])].sort());
  const subscriptions = useRef(new Map<string, () => void>());

  useEffect(() => {
    const active = subscriptions.current;

    return () => {
      active.forEach((stop) => stop());
      active.clear();
    };
  }, [fields, field, store]);

  useEffect(() => {
    if (!fields || !field || !store) return;
    const ids = new Set<string>(JSON.parse(idsKey));

    // Membership changes must not revoke authorization for rows still present.
    // Only scope changes and unmounting tear down all subscriptions above.
    subscriptions.current.forEach((stop, id) => {
      if (ids.has(id)) return;
      stop();
      subscriptions.current.delete(id);
    });
    ids.forEach((id) => {
      if (!subscriptions.current.has(id)) {
        subscriptions.current.set(id, store.subscribe(id, () => publishExternalDatabaseFields(fields)));
      }
    });
  }, [fields, field, store, idsKey]);

  return null;
}
