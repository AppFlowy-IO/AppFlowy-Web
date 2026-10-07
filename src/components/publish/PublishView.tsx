import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PublishProvider } from '@/application/publish';
import { createPublishSnapshotDataSource } from '@/application/publish-snapshot/data-source';
import { peekInlinedPublishSnapshot, releaseInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';
import type { PublishedPageSnapshot, PublishSnapshotDataSource } from '@/application/publish-snapshot/types';
import {
  hasServerRenderedMarkup,
  releaseServerRenderedMarkup,
  ServerRenderedFallback,
} from '@/components/_shared/ServerRenderedFallback';
import NotFound from '@/components/error/NotFound';
import PublishLayout from '@/components/publish/PublishLayout';
import PublishMobileLayout from '@/components/publish/PublishMobileLayout';
import { getPlatform } from '@/utils/platform';

export interface PublishViewProps {
  namespace: string;
  publishName: string;
}

export function PublishView({ namespace, publishName }: PublishViewProps) {
  // Start from the inlined snapshot when available. Large snapshots are not
  // inlined, so keep the server-rendered article visible while fetching them.
  const [snapshot, setSnapshot] = useState<PublishedPageSnapshot | undefined>(() =>
    peekInlinedPublishSnapshot(namespace, publishName)
  );
  const [notFound, setNotFound] = useState<boolean>(false);
  const [dataSource] = useState<PublishSnapshotDataSource>(() => createPublishSnapshotDataSource());
  // The page whose snapshot came inlined, until the reader navigates away.
  const inlinedPage = useRef(snapshot ? { namespace, publishName } : undefined);
  const showingServerRenderedMarkup = !snapshot && hasServerRenderedMarkup();

  // Release only on commit, so discarded renders can still find the snapshot.
  useEffect(() => {
    releaseInlinedPublishSnapshot();
  }, []);

  // A slow or failed fetch must not hide an article already delivered by SSR.
  // Release it after the snapshot commits, or when navigating to another URL.
  useEffect(() => {
    if (!showingServerRenderedMarkup) releaseServerRenderedMarkup();
  }, [showingServerRenderedMarkup]);

  useEffect(() => {
    // Already showing this page from the inlined snapshot. Left set on a match
    // (so StrictMode's repeated effect does not refetch) and cleared on any
    // navigation, so every later page, including a return to this one, fetches.
    const inlined = inlinedPage.current;

    if (inlined?.namespace === namespace && inlined.publishName === publishName) return;
    inlinedPage.current = undefined;

    let cancelled = false;

    setNotFound(false);
    setSnapshot(undefined);

    void dataSource.getPage(namespace, publishName)
      .then((data) => {
        if (cancelled) return;

        setSnapshot(data);
      })
      .catch(() => {
        if (cancelled) return;

        setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, namespace, publishName]);

  const [search] = useSearchParams();

  const isTemplate = search.get('template') === 'true';
  const isTemplateThumb = isTemplate && search.get('thumbnail') === 'true';

  useEffect(() => {
    if (!isTemplateThumb) {
      document.documentElement.removeAttribute('thumbnail');
      return;
    }

    document.documentElement.setAttribute('thumbnail', 'true');

    return () => {
      document.documentElement.removeAttribute('thumbnail');
    };
  }, [isTemplateThumb]);

  if (showingServerRenderedMarkup) {
    return <ServerRenderedFallback label='Loading page' />;
  }

  if (notFound && !snapshot) {
    return <NotFound />;
  }

  return (
    <PublishProvider
      isTemplateThumb={isTemplateThumb}
      isTemplate={isTemplate}
      namespace={namespace}
      publishName={publishName}
      snapshot={snapshot}
    >
      {getPlatform().isMobile ? <PublishMobileLayout snapshot={snapshot} /> : <PublishLayout
        isTemplateThumb={isTemplateThumb}
        isTemplate={isTemplate}
        snapshot={snapshot}
      />}

    </PublishProvider>
  );
}

export default PublishView;
