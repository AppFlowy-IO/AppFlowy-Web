import { Suspense } from 'react';

import { usePublishContext } from '@/application/publish';
import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import { GlobalCommentProvider } from '@/components/global-comment';
import { shouldDisableFixedGlobalCommentInput } from '@/components/publish/comment';
import { PublishSnapshotView } from '@/components/publish-render/PublishSnapshotView';

function PublishMain ({ snapshot, isTemplate }: {
  snapshot?: PublishedPageSnapshot;
  isTemplate: boolean;
}) {
  const commentEnabled = usePublishContext()?.commentEnabled;
  const content = snapshot ? <PublishSnapshotView snapshot={snapshot} /> : <ComponentLoading />;

  return (
    <>
      {content}
      {snapshot && !isTemplate && commentEnabled && (
        <Suspense fallback={<ComponentLoading />}>
          <GlobalCommentProvider disableFixedAddComment={shouldDisableFixedGlobalCommentInput(snapshot)} />
        </Suspense>
      )}
    </>
  );
}

export default PublishMain;
