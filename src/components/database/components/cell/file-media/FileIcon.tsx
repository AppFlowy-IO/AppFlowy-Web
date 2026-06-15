import { useMemo } from 'react';

import { FileMediaType } from '@/application/database-yjs/cell.type';
import { ReactComponent as AudioSvg } from '@/assets/icons/audio.svg';
import { ReactComponent as ArchiveSvg } from '@/assets/icons/file.svg';
import { ReactComponent as LinkSvg } from '@/assets/icons/link.svg';
import { ReactComponent as DocumentSvg } from '@/assets/icons/page.svg';
import { ReactComponent as VideoSvg } from '@/assets/icons/video.svg';

function FileIcon ({ fileType }: {
  fileType: FileMediaType
}) {
  return useMemo(() => {
    switch (fileType) {
      case FileMediaType.Video:
        return <VideoSvg className={'h-5 w-5'} />;
      case FileMediaType.Link:
        return <LinkSvg className={'h-5 w-5'} />;
      case FileMediaType.Archive:
        return <ArchiveSvg className={'h-5 w-5'} />;
      case FileMediaType.Audio:
        return <AudioSvg className={'h-5 w-5'} />;
      case FileMediaType.Other:
      case FileMediaType.Document:
      default:
        return <DocumentSvg className={'h-5 w-5'} />;
    }
  }, [fileType]);
}

export default FileIcon;