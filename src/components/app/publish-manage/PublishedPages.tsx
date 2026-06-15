import { Divider } from '@mui/material';
import React from 'react';

import { View } from '@/application/types';
import PublishedPageItem from '@/components/app/publish-manage/PublishedPageItem';


function PublishedPages ({
  publishViews,
  onUnPublish,
  onPublish,
  onClose,
  namespace,
}: {
  publishViews: View[];
  onUnPublish: (viewId: string) => Promise<void>;
  onPublish: (view: View, publishName: string) => Promise<void>;
  onClose?: () => void;
  namespace: string;
}) {

  return (
    <div className={'flex flex-col gap-2'}>

      {publishViews.map((view, index) => {
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