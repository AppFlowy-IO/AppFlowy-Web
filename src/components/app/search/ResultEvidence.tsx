import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { ReactComponent as PdfIcon } from '@/assets/icons/pdf.svg';
import { ImageRender } from '@/components/_shared/image-render/ImageRender';
import type { SearchResultEvidence } from '@/components/app/search/search-evidence';

/** Why a result matched through an image or PDF: the file, and the text that matched in it. */
function ResultEvidence({ evidence, matchedText }: { evidence: SearchResultEvidence; matchedText?: ReactNode }) {
  const { t } = useTranslation();
  // Remember which URL failed: the list keeps this item mounted when a new query matches another
  // image in the same page, and that image must still get its thumbnail.
  const [failedUrl, setFailedUrl] = useState<string>();
  const Icon = evidence.kind === 'image' ? ImageIcon : PdfIcon;
  const thumbnailUrl = evidence.imageUrl !== failedUrl ? evidence.imageUrl : undefined;

  return (
    <div
      className={'mt-1.5 flex min-w-0 items-start gap-2'}
      data-testid='search-result-evidence'
      data-kind={evidence.kind}
    >
      <div
        className={
          'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border-primary bg-fill-content'
        }
      >
        {thumbnailUrl ? (
          <ImageRender
            src={thumbnailUrl}
            alt=''
            decodeAtDisplaySize='cover'
            className={'h-full w-full object-cover'}
            onError={() => setFailedUrl(thumbnailUrl)}
          />
        ) : (
          <Icon className={'h-5 w-5 text-icon-secondary'} />
        )}
      </div>
      <div className={'min-w-0 flex-1'}>
        <div className={'text-xs font-medium leading-[18px] text-text-primary'}>
          {t(evidence.kind === 'image' ? 'commandPalette.foundInImage' : 'commandPalette.foundInPdf')}
        </div>
        {matchedText && (
          <div
            className={'overflow-hidden text-sm leading-[20px] text-text-secondary'}
            style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
          >
            {matchedText}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultEvidence;
