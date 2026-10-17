import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { useDatabaseOptional, useDatabaseContextOptional } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { usePublishContext } from '@/application/publish';
import * as api from '@/application/services/js-services/http/page-verification-api';
import { YjsDatabaseKey } from '@/application/types';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';

import { assertFieldMutation, bindVerificationField, createNativeVerificationField, deleteNativeVerificationField, ensureVerificationFieldAvailable, findVerificationField, getVerificationPropertyId } from './native';

export { isVerificationField } from './native';
import { verificationStore } from './store';
import { VerificationPropertyState, VerificationViewSettings } from './types';

const emptySettings: VerificationViewSettings = Object.freeze({});

/** Property metadata and claims are Cloud owned; native fields store only the generation binding. */
class PropertyStore {
  value?: VerificationPropertyState;
  listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private loading?: Promise<void>;
  private revision = 0;
  constructor(readonly workspaceId: string, readonly databaseId: string, readonly userId: string) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.timer) {
      void this.refreshAfterWrite().catch(() => undefined);
      this.timer = setInterval(() => void this.refresh().catch(() => undefined), 30_000);
    }

    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.value = undefined;
        this.revision++;
      }
    };
  };
  snapshot = () => this.value;
  refresh = () => {
    if (!this.listeners.size) return Promise.resolve();
    if (!this.loading) {
      const revision = this.revision;

      this.loading = api
        .getVerificationProperty(this.workspaceId, this.databaseId)
        .then((value) => {
          if (revision !== this.revision) return;
          if (this.value?.property?.id !== value.property?.id) {
            verificationStore(this.workspaceId, this.userId).invalidateDatabase(this.databaseId, !value.property);
          }

          this.value = value;
          this.listeners.forEach((listener) => listener());
        })
        .catch((error) => {
          if (revision !== this.revision) return;
          verificationStore(this.workspaceId, this.userId).invalidateDatabase(this.databaseId);
          this.value = undefined;
          this.listeners.forEach((listener) => listener());
          throw error;
        })
        .finally(() => {
          this.loading = undefined;
        });
    }

    return this.loading;
  };
  async refreshAfterWrite() {
    await this.loading?.catch(() => undefined);
    await this.refresh();
  }
  async create() {
    this.revision++;
    const property = await api.createVerificationProperty(this.workspaceId, this.databaseId);

    await this.refreshAfterWrite().catch(() => undefined);
    return property;
  }
  async remove(id: string) {
    this.revision++;
    await api.deleteVerificationProperty(this.workspaceId, this.databaseId, id);
    verificationStore(this.workspaceId, this.userId).invalidateDatabase(this.databaseId, true);
    await this.refreshAfterWrite().catch(() => undefined);
  }
  async clear(id: string) {
    await api.clearVerificationProperty(this.workspaceId, this.databaseId, id);
    verificationStore(this.workspaceId, this.userId).invalidateDatabase(this.databaseId);
  }
  async settings(viewId: string, settings: VerificationViewSettings, id: string) {
    this.revision++;
    await api.setVerificationViewSettings(this.workspaceId, this.databaseId, id, viewId, settings);
    await this.refreshAfterWrite();
  }
}
const stores = new Map<string, PropertyStore>();
const noopSubscribe = () => () => undefined;
const noSnapshot = () => undefined;

export function useDatabaseVerification() {
  const published = usePublishContext();
  const context = useDatabaseContextOptional();
  const database = useDatabaseOptional();
  const userId = useAuthenticatedUserIdOptional();
  const databaseId = database?.get(YjsDatabaseKey.id);
  const workspaceId = context?.workspaceId;
  const enabled = !published && context && !context.dataSource && workspaceId && databaseId && userId;
  let store: PropertyStore | undefined;

  if (enabled) {
    const key = `${userId}:${workspaceId}:${databaseId}`;

    store = stores.get(key);
    if (!store) {
      store = new PropertyStore(workspaceId, databaseId, userId);
      stores.set(key, store);
    }
  }

  const state = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.snapshot ?? noSnapshot, noSnapshot);
  const canEdit = !!store && !!state?.can_edit && !context?.readOnly;
  const owner = useRef({ store, database, canEdit, epoch: 0, active: true });

  if (owner.current.store !== store || owner.current.database !== database || owner.current.canEdit !== canEdit) {
    owner.current = { store, database, canEdit, epoch: owner.current.epoch + 1, active: owner.current.active };
  }

  useEffect(() => {
    owner.current.active = true;
    return () => { owner.current.active = false; };
  }, []);
  const epoch = owner.current.epoch;
  const assertEditable = useCallback(() => {
    if (!owner.current.active || owner.current.epoch !== epoch || !owner.current.canEdit || !owner.current.store?.value?.can_edit) {
      throw new Error('Verification permissions or workspace changed; reopen the property editor');
    }
  }, [epoch]);

  const fields = database?.get(YjsDatabaseKey.fields);
  const subscribeFields = useCallback((notify: () => void) => {
    fields?.observeDeep(notify);
    return () => fields?.unobserveDeep(notify);
  }, [fields]);
  // A primitive snapshot also detects in-place generation rebinding.
  const schemaSnapshot = useCallback(() => Array.from(fields?.entries() ?? []).map(([id, field]) =>
    `${id}:${field.get(YjsDatabaseKey.type)}:${getVerificationPropertyId(field)}`
  ).join('|'), [fields]);

  useSyncExternalStore(subscribeFields, schemaSnapshot, schemaSnapshot);
  const nativeField = findVerificationField(database);
  const nativeFieldId = nativeField?.get(YjsDatabaseKey.id);
  const propertyId = getVerificationPropertyId(nativeField);
  const property = propertyId && state?.property?.id === propertyId ? state.property : undefined;
  const field = property ? nativeField : undefined;
  const fieldId = field?.get(YjsDatabaseKey.id);
  const viewId = context?.activeViewId ?? '';
  const settings = property ? state?.views?.[viewId] ?? emptySettings : emptySettings;
  const create = useCallback(async () => {
    assertEditable();
    if (!database || !store || !state) throw new Error('Verification is not editable');
    ensureVerificationFieldAvailable(database, nativeFieldId);
    const guard = { expectedFieldType: FieldType.Verification, expectedVerificationPropertyId: propertyId };

    if (nativeFieldId) assertFieldMutation(database.get(YjsDatabaseKey.fields)?.get(nativeFieldId), guard);
    const created = state.property ?? await store.create();

    assertEditable();

    // Explicit retry repairs only the captured field and preserves its source metadata.
    if (nativeFieldId) {
      database.doc!.transact(() => {
        const current = database.get(YjsDatabaseKey.fields)?.get(nativeFieldId);

        assertFieldMutation(current, guard);
        bindVerificationField(database, current, created.id);
      }, 'verification.bind');
    } else {
      createNativeVerificationField(database, created.id);
    }
  }, [assertEditable, store, state, database, nativeFieldId, propertyId]);
  const remove = useCallback(async () => {
    assertEditable();
    if (!database || !store || !nativeFieldId) throw new Error('Verification is not editable');
    assertFieldMutation(database.get(YjsDatabaseKey.fields)?.get(nativeFieldId), {
      expectedFieldType: FieldType.Verification,
      expectedVerificationPropertyId: propertyId,
    });
    if (propertyId) await store.remove(propertyId);
    assertEditable();
    deleteNativeVerificationField(database, nativeFieldId, propertyId);
  }, [assertEditable, store, nativeFieldId, propertyId, database]);
  const clear = useCallback(async () => {
    assertEditable();
    if (!database || !store || !nativeFieldId || !property) throw new Error('Verification is not editable');
    assertFieldMutation(database.get(YjsDatabaseKey.fields)?.get(nativeFieldId), {
      expectedFieldType: FieldType.Verification,
      expectedVerificationPropertyId: propertyId,
    });
    await store.clear(propertyId);
  }, [assertEditable, store, nativeFieldId, property, propertyId, database]);
  const updateSettings = useCallback(
    async (patch: Partial<VerificationViewSettings>) => {
      assertEditable();
      if (!property || !store) return;
      await store.settings(viewId, { ...settings, ...patch }, property.id);
    },
    [assertEditable, store, viewId, settings, property]
  );

  return { state, property, field, nativeField, fieldId, nativeFieldId, databaseId, settings, store, viewId, updateSettings, create, remove, clear, assertEditable, readOnly: context?.readOnly };
}

export function invalidateActiveVerificationProperties() {
  stores.forEach((store) => {
    if (store.listeners.size) void store.refreshAfterWrite().catch(() => undefined);
  });
}
