import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { VideoBlockData, VideoType } from '@/application/types';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';
import EmbedLink from 'src/components/_shared/image-upload/EmbedLink';

function VideoBlockPopoverContent({
  blockId,
  onClose,
}: {
  blockId: string;
  onClose: () => void;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();

  const [tabValue, setTabValue] = React.useState('embed');
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch(e) {
      return null;
    }
  }, [blockId, editor]);
  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const handleInsertEmbedLink = useCallback((url: string) => {
    CustomEditor.setBlockData(editor, blockId, {
      url,
      video_type: VideoType.External,
    } as VideoBlockData);
    onClose();
  }, [blockId, editor, onClose]);
  const tabOptions = useMemo(() => {
    return [
      {
        key: 'embed',
        label: t('embedLink'),
        panel: <div className={'flex flex-col my-2'}><EmbedLink
          onDone={handleInsertEmbedLink}
          defaultLink={(entry?.[0].data as VideoBlockData).url}
          placeholder={t('embedVideoLinkPlaceholder')}
        />
          <div className={'text-text-caption text-sm w-full text-center'}>{t('videoSupported')}</div>
        </div>,
      },
    ];
  }, [entry, handleInsertEmbedLink, t]);
  const selectedIndex = tabOptions.findIndex((tab) => tab.key === tabValue);

  return (
    <div className={'flex flex-col p-2 gap-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] px-2 border-b border-line-divider w-[560px] max-w-[964px]'}
      >
        {tabOptions.map((tab) => {
          const { key, label } = tab;

          return <ViewTab
            key={key}
            iconPosition="start"
            color="inherit"
            label={label}
            value={key}
          />;
        })}
      </ViewTabs>
      {tabOptions.map((tab, index) => {
        const { key, panel } = tab;

        return (
          <TabPanel
            className={'flex h-full w-full flex-col'}
            key={key}
            index={index}
            value={selectedIndex}
          >
            {panel}
          </TabPanel>
        );
      })}
    </div>
  );
}

export default VideoBlockPopoverContent;