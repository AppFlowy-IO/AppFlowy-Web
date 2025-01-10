import { View } from '@/application/types';

import PublishedPageItem from '@/components/app/publish-manage/PublishedPageItem';
import { CircularProgress, Divider } from '@mui/material';

import React from 'react';

function PublishedPages ({
  publishViews,
  onUnPublish,
  onPublish,
  loading,
  onClose,
  namespace,
}: {
  publishViews: View[];
  loading: boolean;
  onUnPublish: (viewId: string) => Promise<void>;
  onPublish: (view: View, publishName: string) => Promise<void>;
  onClose?: () => void;
  namespace: string;
}) {

  return (
    <div className={'flex flex-col gap-2'}>

      {loading ? <div className={'flex justify-center w-full items-center'}>
          <CircularProgress size={20} /></div>
        : publishViews.map((view, index) => {
          return <React.StrictMode key={view.view_id}>
            <PublishedPageItem
              namespace={namespace}
              onClose={onClose}
              view={view}
              onUnPublish={onUnPublish}
              onPublish={onPublish}
            />
            {index !== publishViews.length - 1 && <Divider />}

          </React.StrictMode>;
        })}

    </div>
  );
}

export default PublishedPages;