import { useCallback, useEffect, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { ViewMetadataError } from '@/application/errors/view-metadata-error';
import { View } from '@/application/types';
import { determineErrorType, ErrorType, isPermissionDeniedError } from '@/application/utils/error-utils';
import { findView } from '@/components/_shared/outline/utils';
import type { EditorContextState } from '@/components/editor/EditorContext';

export type ReferenceError = 'not_found' | 'in_trash' | 'deleted' | 'denied' | 'unauthorized' | 'load_failed';
type Metadata = { pageId: string; view: View | null; error: ReferenceError | null; loading: boolean };
type Options = Pick<EditorContextState, 'loadViewMeta' | 'eventEmitter' | 'onPageMentionNameResolved'> & { pageId: string };

function referenceError(error: unknown): ReferenceError {
  if (error instanceof ViewMetadataError) return error.reason;
  if (isPermissionDeniedError(error)) return 'denied';

  switch (determineErrorType(error).type) {
    case ErrorType.PageNotFound:
      return 'not_found';
    case ErrorType.Gone:
      return 'deleted';
    case ErrorType.Unauthorized:
      return 'unauthorized';
    default:
      return 'load_failed';
  }
}

/** Keep reference failures recoverable without allowing stale lookups to replace live metadata. */
export function usePageReferenceMetadata({ pageId, loadViewMeta, eventEmitter, onPageMentionNameResolved }: Options) {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);
  const requestVersion = useRef(0);
  const accessFencedPageId = useRef<string | null>(null);
  const acceptView = useCallback((view: View | null) => {
    setMetadata({ pageId, view, error: view ? null : 'not_found', loading: false });
    onPageMentionNameResolved?.(pageId, view?.name);
  }, [onPageMentionNameResolved, pageId]);
  const load = useCallback(async (authoritative = false) => {
    const version = ++requestVersion.current;
    const requireAuthoritative = authoritative || accessFencedPageId.current === pageId;

    setMetadata((previous) => ({
      pageId,
      view: previous?.pageId === pageId ? previous.view : null,
      error: previous?.pageId === pageId ? previous.error : null,
      loading: true,
    }));
    try {
      if (!loadViewMeta) throw new Error('Page metadata lookup is unavailable');
      const view = requireAuthoritative
        ? await loadViewMeta(pageId, undefined, { authoritative: true })
        : await loadViewMeta(pageId);

      if (requestVersion.current === version) {
        if (requireAuthoritative && view) accessFencedPageId.current = null;
        acceptView(view);
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setMetadata({ pageId, view: null, error: referenceError(error), loading: false });
        onPageMentionNameResolved?.(pageId, undefined);
      }
    }
  }, [acceptView, loadViewMeta, onPageMentionNameResolved, pageId]);

  useEffect(() => {
    let scheduledRecheck: object | undefined;
    const recheckAccess = () => {
      if (scheduledRecheck) return;
      const scheduled = {};

      scheduledRecheck = scheduled;
      // Retire an older result immediately, before the queued check starts.
      requestVersion.current += 1;
      // One permission refresh can emit several outline and metadata events.
      // Combine a synchronous burst, but let later signals supersede a read
      // that may have started before access was restored.
      queueMicrotask(() => {
        if (scheduledRecheck !== scheduled) return;
        scheduledRecheck = undefined;
        void load(true);
      });
    };

    const handleView = (view: View) => {
      if (view.view_id !== pageId) return;
      if (accessFencedPageId.current === pageId) {
        recheckAccess();
        return;
      }

      requestVersion.current += 1;
      acceptView(view);
    };

    const handleOutlineLoaded = (outline: View[]) => {
      if (accessFencedPageId.current === pageId) {
        // Group/parent permission recovery need not emit a targeted restored
        // event, and a shallow outline may still omit this reference. Treat
        // the refresh as a signal to check access, never as proof of access.
        recheckAccess();
        return;
      }

      const view = findView(outline, pageId);

      if (view) handleView(view);
    };

    const handleAccessRevoked = (payload?: { viewId?: string | null }) => {
      if (payload?.viewId !== pageId) return;
      scheduledRecheck = undefined;
      accessFencedPageId.current = pageId;
      requestVersion.current += 1;
      // React can batch revocation and recovery into one available render, but
      // any document loaded before the revocation must still be discarded.
      setAccessRevision((revision) => revision + 1);
      setMetadata({ pageId, view: null, error: 'denied', loading: false });
      onPageMentionNameResolved?.(pageId, undefined);
    };

    const handleAccessRestored = (payload?: { viewId?: string | null }) => {
      if (payload?.viewId !== pageId) return;
      // A cached outline or view notification cannot establish restored access.
      // Keep it fenced until this authoritative lookup actually succeeds.
      accessFencedPageId.current = pageId;
      recheckAccess();
    };

    eventEmitter?.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    eventEmitter?.on(APP_EVENTS.VIEW_META_CHANGED, handleView);
    eventEmitter?.on(APP_EVENTS.VIEW_ACCESS_REVOKED, handleAccessRevoked);
    eventEmitter?.on(APP_EVENTS.VIEW_ACCESS_RESTORED, handleAccessRestored);
    void load();
    return () => {
      scheduledRecheck = undefined;
      requestVersion.current += 1;
      eventEmitter?.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
      eventEmitter?.off(APP_EVENTS.VIEW_META_CHANGED, handleView);
      eventEmitter?.off(APP_EVENTS.VIEW_ACCESS_REVOKED, handleAccessRevoked);
      eventEmitter?.off(APP_EVENTS.VIEW_ACCESS_RESTORED, handleAccessRestored);
    };
  }, [acceptView, eventEmitter, load, onPageMentionNameResolved, pageId]);

  const retry = useCallback(() => { void load(true); }, [load]);
  const current = metadata?.pageId === pageId ? metadata : null;

  return { view: current?.view ?? null, error: current?.error ?? null, loading: current?.loading ?? true, accessRevision, retry };
}
