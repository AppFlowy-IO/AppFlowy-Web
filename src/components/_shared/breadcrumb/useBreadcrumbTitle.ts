import { useContext, useEffect, useRef, useState } from 'react';

import { UIVariant, View } from '@/application/types';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { useSyncInternalOptional } from '@/components/app/contexts/SyncInternalContext';

import { BreadcrumbSource } from './BreadcrumbSource';

export function useBreadcrumbTitle(view: View, variant?: UIVariant): string {
  const candidate = BreadcrumbSource.fromView(view, variant);
  const sourceRef = useRef(candidate);

  // Equivalent metadata refreshes keep the active source and its subscription.
  if (sourceRef.current.identity !== candidate.identity) {
    sourceRef.current = candidate;
  }

  const source = sourceRef.current;
  const loadView = useContext(AppOperationsContext)?.loadView;
  const sync = useSyncInternalOptional();
  const registerSyncContext = sync?.registerSyncContext;
  const scheduleDeferredCleanup = sync?.scheduleDeferredCleanup;
  const [resolved, setResolved] = useState<{ source: BreadcrumbSource; title: string }>();

  useEffect(() => {
    if (!loadView || !registerSyncContext || !scheduleDeferredCleanup) return;

    return source.watchTitle({ loadView, registerSyncContext, scheduleDeferredCleanup }, (title) => {
      setResolved((previous) => previous?.source === source && previous.title === title ? previous : { source, title });
    });
  }, [source, loadView, registerSyncContext, scheduleDeferredCleanup]);

  return resolved?.source === source ? resolved.title : source.initialTitle;
}
