import { usePublishContext } from '@/application/publish';
import { YDoc } from '@/application/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import { GlobalCommentProvider } from '@/components/global-comment';
import CollabView from '@/components/publish/CollabView';
import React, { Suspense } from 'react';

function PublishMain ({ doc, isTemplate }: {
  doc?: YDoc;
  isTemplate: boolean;
}) {
  const commentEnabled = usePublishContext()?.commentEnabled;

  return (
    <>
      <CollabView doc={doc} />
      {doc && !isTemplate && commentEnabled && (
        <Suspense fallback={<ComponentLoading />}>
          <GlobalCommentProvider />
        </Suspense>
      )}
    </>
  );
}

export default PublishMain;