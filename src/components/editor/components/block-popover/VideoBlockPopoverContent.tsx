import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { VideoBlockData, VideoType } from '@/application/types';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';

import EmbedLink from 'src/components/_shared/image-upload/EmbedLink';
import { isValidVideoUrl } from '@/utils/video-url';

function VideoBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();

  const [tabValue, setTabValue] = React.useState('embed');
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch (e) {
      return null;
    }
  }, [blockId, editor]);
  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const handleInsertEmbedLink = useCallback(
    (url: string) => {
      CustomEditor.setBlockData(editor, blockId, {
        url,
        video_type: VideoType.External,
      } as VideoBlockData);
      onClose();
    },
    [blockId, editor, onClose]
  );
  const tabOptions = useMemo(() => {
    return [
      {
        key: 'embed',
        label: t('embedLink'),
        panel: (
          <div className={'my-2 flex flex-col'}>
            <EmbedLink
              onDone={handleInsertEmbedLink}
              defaultLink={(entry?.[0].data as VideoBlockData).url}
              placeholder={t('embedVideoLinkPlaceholder')}
              validator={isValidVideoUrl}
            />
            <div className={'w-full text-center text-sm text-text-secondary'}>{t('videoSupported')}</div>
          </div>
        ),
      },
    ];
  }, [entry, handleInsertEmbedLink, t]);
  const selectedIndex = tabOptions.findIndex((tab) => tab.key === tabValue);

  return (
    <div className={'flex flex-col gap-2 p-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] w-[560px] max-w-[964px] border-b border-border-primary px-2'}
      >
        {tabOptions.map((tab) => {
          const { key, label } = tab;

          return <ViewTab key={key} iconPosition='start' color='inherit' label={label} value={key} />;
        })}
      </ViewTabs>
      {tabOptions.map((tab, index) => {
        const { key, panel } = tab;

        return (
          <TabPanel className={'flex h-full w-full flex-col'} key={key} index={index} value={selectedIndex}>
            {panel}
          </TabPanel>
        );
      })}
    </div>
  );
}

export default VideoBlockPopoverContent;
