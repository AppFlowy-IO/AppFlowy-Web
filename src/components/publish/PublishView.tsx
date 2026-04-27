import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PublishProvider } from '@/application/publish';
import { createPublishSnapshotDataSource } from '@/application/publish-snapshot/data-source';
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
  const [snapshot, setSnapshot] = useState<PublishedPageSnapshot | undefined>();
  const [notFound, setNotFound] = useState<boolean>(false);
  const [dataSource] = useState<PublishSnapshotDataSource>(() => createPublishSnapshotDataSource());

  useEffect(() => {
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
