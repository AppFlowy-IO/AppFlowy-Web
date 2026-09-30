import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PublishProvider } from '@/application/publish';
import { createPublishSnapshotDataSource } from '@/application/publish-snapshot/data-source';
import { takeInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';
import type { PublishedPageSnapshot, PublishSnapshotDataSource } from '@/application/publish-snapshot/types';
import NotFound from '@/components/error/NotFound';
import PublishLayout from '@/components/publish/PublishLayout';
import PublishMobileLayout from '@/components/publish/PublishMobileLayout';
import { getPlatform } from '@/utils/platform';

export interface PublishViewProps {
  namespace: string;
  publishName: string;
}

export function PublishView({ namespace, publishName }: PublishViewProps) {
  // When the server rendered this page it also inlined the snapshot; start
  // from it instead of fetching. Absent or unusable → undefined, and the
  // effect below fetches as usual.
  const [inlinedSnapshot] = useState(() => takeInlinedPublishSnapshot(namespace, publishName));
  const [snapshot, setSnapshot] = useState<PublishedPageSnapshot | undefined>(inlinedSnapshot);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [dataSource] = useState<PublishSnapshotDataSource>(() => createPublishSnapshotDataSource());
  const pendingInlinedSnapshot = useRef(inlinedSnapshot);

  useEffect(() => {
    // Skip only the first fetch, and only for the page the snapshot belongs to.
    // Any later navigation fetches normally.
    const inlined = pendingInlinedSnapshot.current;

    pendingInlinedSnapshot.current = undefined;
    if (inlined && inlined.namespace === namespace && inlined.publishName === publishName) return;

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
