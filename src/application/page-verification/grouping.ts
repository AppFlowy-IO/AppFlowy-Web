import { useCallback, useMemo } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import { readVerificationFieldSnapshot } from '@/application/database-yjs/external-fields';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import type { DatabaseGrouping, Row } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';

import { useDatabaseVerification } from './database';
import { VerificationGroupSettings, VerificationStatus } from './types';

export const verificationGroupStatuses: VerificationStatus[] = ['verified', 'expired', 'unverified'];
export const verificationGroupLabels: Record<string, string> = {
  verified: 'Verified', expired: 'Expired', unverified: 'Unverified',
};

export function verificationGroupOrder(settings: VerificationGroupSettings) {
  return [...new Set([...(settings.order ?? []), ...verificationGroupStatuses])];
}

export function useVerificationGroupActions() {
  const { settings, updateSettings, fieldId } = useDatabaseVerification();
  const active = Boolean(fieldId && settings.grouping);
  const update = useCallback((patch: Partial<VerificationGroupSettings>) => {
    if (!active) return;
    void updateSettings({ grouping: { ...settings.grouping, ...patch } }).catch((error) => notify.error(error.message));
  }, [active, settings.grouping, updateSettings]);
  const setVisible = useCallback((ids: string[], visible: boolean) => {
    const hidden = new Set(settings.grouping?.hidden ?? []);

    ids.forEach((id) => {
      if (!verificationGroupStatuses.includes(id as VerificationStatus)) return;
      if (visible) hidden.delete(id as VerificationStatus);
      else hidden.add(id as VerificationStatus);
    });
    update({ hidden: [...hidden] });
  }, [settings.grouping, update]);

  return useMemo(() => ({ active, settings: settings.grouping, update, setVisible }), [active, settings.grouping, update, setVisible]);
}

/** Group authorized row snapshots; missing/error responses never mean Unverified. */
export function useVerificationGrouping(rows?: Row[]): DatabaseGrouping | undefined {
  const { settings, field, fieldId } = useDatabaseVerification();
  const config = field ? settings.grouping : undefined;
  const revision = useDatabaseFieldsVersion(Boolean(config));

  return useMemo(() => {
    void revision;
    if (!config || !field || !fieldId) return undefined;
    const order = verificationGroupOrder(config);
    const buckets = new Map(order.map((id) => [id, [] as Row[]]));
    let ready = rows !== undefined;

    rows?.forEach((row) => {
      const snapshot = readVerificationFieldSnapshot(field, row.id);

      if (!snapshot) ready = false;
      if (snapshot) buckets.get(snapshot.status)?.push(row);
    });
    const groups = order.map((id) => {
      const groupRows = buckets.get(id) ?? [];
      const hidden = config.hidden?.includes(id) ?? false;
      const automaticallyHidden = ready && Boolean(config.hide_empty) && !groupRows.length;

      return { id, label: verificationGroupLabels[id], rows: groupRows, isDefault: false,
        hidden, automaticallyHidden, visible: !hidden && !automaticallyHidden,
        collapsed: config.collapsed?.includes(id) ?? false };
    });

    return { isGrouped: true, rowOrders: rows, fieldId, groupId: fieldId,
      fieldType: FieldType.Verification, fieldName: field.get(YjsDatabaseKey.name), field,
      activeGroupIds: order, groups, visibleGroups: groups.filter((group) => group.visible),
      hideEmptyGroups: Boolean(config.hide_empty), ready };
  }, [config, fieldId, rows, revision, field]);
}
