import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { useDatabaseContextOptional, useDatabaseView, useDatabaseViewId } from '@/application/database-yjs/context';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import type { View } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { Input } from '@/components/ui/input';

type UpdateFormTitle = (viewId: string, payload: { name: string }) => Promise<void>;

interface PendingFormTitleRename {
  value: string;
  update: UpdateFormTitle;
  inFlight: Promise<void> | null;
}

// A rename can outlive the Form editor that authored it. Keep the latest
// intent process-local so a failed navigation-time write is retried when the
// same Form remounts instead of disappearing with the component instance.
const pendingFormTitleRenames = new Map<string, PendingFormTitleRename>();
let pendingFormTitlePrincipalId: string | undefined;

function enqueueFormTitleRename(
  scopeKey: string,
  viewId: string,
  value: string,
  update: UpdateFormTitle
): Promise<void> {
  let pending = pendingFormTitleRenames.get(scopeKey);

  if (!pending) {
    pending = { value, update, inFlight: null };
    pendingFormTitleRenames.set(scopeKey, pending);
  } else {
    pending.value = value;
    pending.update = update;
  }

  if (pending.inFlight) return pending.inFlight;
  const scope = pending;

  scope.inFlight = (async () => {
    try {
      let next: string;

      do {
        next = scope.value;
        try {
          await scope.update(viewId, { name: next });
        } catch (error) {
          // A newer authored value supersedes the failed request and should
          // still be attempted. Retain a failure only when it belongs to the
          // final intent.
          if (scope.value !== next) continue;
          throw error;
        }
      } while (scope.value !== next);

      if (pendingFormTitleRenames.get(scopeKey) === scope) {
        pendingFormTitleRenames.delete(scopeKey);
      }
    } finally {
      scope.inFlight = null;
    }
  })();

  return scope.inFlight;
}

export function resetPendingFormTitleRenamesForTesting(): void {
  pendingFormTitleRenames.clear();
  pendingFormTitlePrincipalId = undefined;
}

/**
 * Inline editable form title — mirror of the desktop's `_FormTitle`.
 * Folder metadata is the persisted title authority: Desktop renames a Form
 * through the Folder API, and Web follows the same path. The database Yjs view
 * name remains an immediate/fallback value for embedded and compatibility
 * contexts that do not expose Folder metadata. Web renames still update both
 * stores through `useUpdateDatabaseView`.
 *
 * Save-on-blur/unmount, not save-on-keystroke — the rename round-trip is
 * heavier than the form-description debounce; flushing on every char would
 * spam the server. The unmount path mirrors Desktop's disposal handoff.
 *
 * This is the database-view name used by authoring/navigation chrome. Cloud
 * does not yet project it into the public respondent schema.
 */
export function FormTitle({ readOnly }: { readOnly: boolean }) {
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const principalId = useAuthenticatedUserIdOptional() ?? 'anonymous';
  const renameScopeKey = `${principalId}\u0000${viewId ?? ''}`;
  const context = useDatabaseContextOptional();
  const loadViewMeta = context?.loadViewMeta;
  const eventEmitter = context?.eventEmitter;
  const updateView = useUpdateDatabaseView();
  const databaseName = view?.get(YjsDatabaseKey.name) ?? '';
  const [folderTitle, setFolderTitle] = useState<{ viewId: string; name: string } | null>(null);
  const folderTitleRevision = useRef(0);
  const name = folderTitle?.viewId === viewId ? folderTitle.name : databaseName;
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const authoritativeName = useRef(name);
  const pendingExternalName = useRef<string | null>(null);
  const focused = useRef(false);
  const dirty = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const draftRef = useRef(draft);
  const viewIdRef = useRef(viewId);
  const renameScopeKeyRef = useRef(renameScopeKey);
  const updateViewRef = useRef<UpdateFormTitle>(updateView);
  const readOnlyRef = useRef(readOnly);

  useLayoutEffect(() => {
    viewIdRef.current = viewId;
    renameScopeKeyRef.current = renameScopeKey;
    updateViewRef.current = updateView;
    readOnlyRef.current = readOnly;
  }, [readOnly, renameScopeKey, updateView, viewId]);

  useLayoutEffect(() => {
    if (pendingFormTitlePrincipalId === principalId) return;

    // AppAuthLayer remounts on account changes, but process-local queues live
    // outside that tree. Drop detached intent before the new principal can
    // inspect or retry a prior user's rename.
    pendingFormTitleRenames.clear();
    pendingFormTitlePrincipalId = principalId;
  }, [principalId]);

  // A permission downgrade is an authoring boundary, not a temporary way to
  // hide the input. Discard any unsaved draft immediately so it cannot
  // reappear (and later be submitted) if edit access is restored while this
  // FormTitle instance remains mounted.
  useLayoutEffect(() => {
    if (!readOnly) return;

    pendingFormTitleRenames.delete(renameScopeKey);
    focused.current = false;
    dirty.current = false;
    pendingExternalName.current = null;
    authoritativeName.current = name;
    draftRef.current = name;
    setDraft(name);
  }, [name, readOnly, renameScopeKey]);

  const acceptFolderTitle = useCallback(
    (value: string) => {
      if (!viewId) return;
      folderTitleRevision.current += 1;
      setFolderTitle({ viewId, name: value });
    },
    [viewId]
  );

  useEffect(() => {
    if (!viewId) return;
    let cancelled = false;

    const acceptView = (meta: View | null | undefined) => {
      if (cancelled || meta?.view_id !== viewId) return;
      acceptFolderTitle(meta.name);
    };

    const handleViewMetaChanged = (meta: View) => acceptView(meta);
    const handleOutlineLoaded = (outline: View[]) => acceptView(findView(outline, viewId));

    eventEmitter?.on(APP_EVENTS.VIEW_META_CHANGED, handleViewMetaChanged);
    eventEmitter?.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);

    if (loadViewMeta) {
      // Fetch the Folder projection once on mount so a Desktop rename that
      // happened while Web was closed is visible even when no live event is
      // delivered in this session. A newer local/event update fences a late
      // response from replacing it with an older snapshot.
      const requestRevision = folderTitleRevision.current;

      void loadViewMeta(viewId, undefined, { metadataOnly: true, authoritative: true })
        .then((meta) => {
          if (folderTitleRevision.current !== requestRevision) return;
          acceptView(meta);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      eventEmitter?.off(APP_EVENTS.VIEW_META_CHANGED, handleViewMetaChanged);
      eventEmitter?.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    };
  }, [acceptFolderTitle, eventEmitter, loadViewMeta, viewId]);

  // Resume a navigation-time rename that failed after the prior editor was
  // gone. The retained draft remains visible and dirty if the retry fails, so
  // the normal blur path can try it again.
  useEffect(() => {
    if (readOnly || !viewId) return;
    const pending = pendingFormTitleRenames.get(renameScopeKey);

    if (!pending) return;
    const pendingValue = pending.value;
    const inheritedInFlight = pending.inFlight !== null;

    const acceptPersistedValue = (value: string) => {
      if (!mountedRef.current || draftRef.current.trim() !== value) return;
      acceptFolderTitle(value);
      authoritativeName.current = value;
      pendingExternalName.current = null;
      dirty.current = false;
      draftRef.current = value;
      setDraft(value);
    };

    const reportFailure = (error: unknown) => {
      if (!mountedRef.current) return;
      toast.error(error instanceof Error && error.message ? error.message : 'Failed to rename form');
    };

    pending.update = updateView;
    dirty.current = true;
    draftRef.current = pendingValue;
    setDraft(pendingValue);
    void (async () => {
      try {
        await enqueueFormTitleRename(renameScopeKey, viewId, pendingValue, updateView);
        acceptPersistedValue(pendingValue);
      } catch (error) {
        // If this mount inherited an older component's active request, its
        // failure happened after our one-time pending check. Give the retained
        // final intent one bounded retry with this mount's fresh updater,
        // matching Desktop's title queue.
        if (!inheritedInFlight || !mountedRef.current || readOnlyRef.current) {
          reportFailure(error);
          return;
        }

        const retained = pendingFormTitleRenames.get(renameScopeKey);

        if (!retained) return;
        const retryValue = retained.value;

        try {
          await enqueueFormTitleRename(renameScopeKey, viewId, retryValue, updateView);
          acceptPersistedValue(retryValue);
        } catch (retryError) {
          reportFailure(retryError);
        }
      }
    })();
  }, [acceptFolderTitle, readOnly, renameScopeKey, updateView, viewId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const latestViewId = viewIdRef.current;
      const latestScopeKey = renameScopeKeyRef.current;
      const next = draftRef.current.trim();

      if (
        readOnlyRef.current ||
        !latestViewId ||
        !dirty.current ||
        savingRef.current ||
        next === authoritativeName.current
      ) {
        return;
      }

      void enqueueFormTitleRename(latestScopeKey, latestViewId, next, updateViewRef.current).catch(() => undefined);
    };
  }, []);

  // Sync from external rename (another tab / desktop) when the input is
  // NOT focused. If the user is currently editing, leave their caret
  // alone — clobbering would be surprising.
  useEffect(() => {
    if (name === authoritativeName.current) return;

    authoritativeName.current = name;
    if (focused.current || savingRef.current) {
      pendingExternalName.current = name;
      return;
    }

    pendingExternalName.current = null;
    dirty.current = false;
    draftRef.current = name;
    setDraft(name);
  }, [name]);

  if (readOnly) {
    return <h1 className='text-3xl font-bold'>{name || 'Form'}</h1>;
  }

  const flush = async () => {
    if (!viewId || savingRef.current) return;
    const next = draft.trim();

    if (next === authoritativeName.current) {
      const retained = pendingFormTitleRenames.get(renameScopeKey);

      if (retained?.inFlight) {
        // A prior editor may still be saving an older value. Supersede that
        // retained intent so its drain restores the user's explicit revert.
        retained.value = next;
        retained.update = updateView;
      } else if (retained) {
        pendingFormTitleRenames.delete(renameScopeKey);
      }

      pendingExternalName.current = null;
      dirty.current = false;
      if (next !== draft) {
        draftRef.current = next;
        setDraft(next);
      }

      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await enqueueFormTitleRename(renameScopeKey, viewId, next, updateView);
      // Only acknowledge the draft after both the page rename and Yjs update
      // complete. A rejected request leaves the draft dirty, so the next blur
      // retries the same value instead of silently treating it as saved.
      acceptFolderTitle(next);
      authoritativeName.current = next;
      pendingExternalName.current = null;
      dirty.current = false;
      draftRef.current = next;
      if (mountedRef.current) setDraft(next);
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error instanceof Error && error.message ? error.message : 'Failed to rename form');
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <Input
      variant='ghost'
      value={draft}
      onChange={(e) => {
        dirty.current = true;
        draftRef.current = e.target.value;
        setDraft(e.target.value);
      }}
      disabled={saving}
      aria-busy={saving}
      onFocus={() => {
        focused.current = true;
        dirty.current = draft.trim() !== authoritativeName.current;
      }}
      onBlur={() => {
        focused.current = false;

        // If the user only focused the field, accept a remote rename that
        // arrived while the caret was active. A genuinely edited draft still
        // wins on blur and is saved against the latest authoritative name.
        if (!dirty.current && pendingExternalName.current !== null) {
          const externalName = pendingExternalName.current;

          pendingExternalName.current = null;
          draftRef.current = externalName;
          setDraft(externalName);
          return;
        }

        void flush();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder='Form'
      className='!h-auto !px-0 !text-3xl !font-bold'
    />
  );
}
