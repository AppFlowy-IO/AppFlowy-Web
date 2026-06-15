import { memo, useContext } from 'react';

import { ReactComponent as EarthIcon } from '@/assets/icons/earth.svg';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { LinkPreviewData } from '@/utils/link-preview';

const WWW_PREFIX = /^www\./;

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, '');
  } catch {
    return url;
  }
}

/**
 * The rich hover card shown for an inline external-link mention. Mirrors the
 * desktop MentionLinkPreview layout: og:image banner, title, description (up to
 * three lines) and a favicon + site footer.
 */
export const MentionLinkPreviewCard = memo(function MentionLinkPreviewCard({
  url,
  data,
  onOpen,
}: {
  url: string;
  data: LinkPreviewData;
  onOpen: () => void;
}) {
  const isDark = useContext(ThemeModeContext)?.isDark ?? false;
  const image = data.image?.url;
  const favicon = (isDark ? data.logoDark?.url : undefined) || data.logo?.url;

  return (
    <div onClick={onOpen} contentEditable={false} className={'flex cursor-pointer flex-col'}>
      {image ? <img src={image} alt={''} className={'h-[120px] w-full flex-none object-cover object-center'} /> : null}
      <div className={'flex flex-col gap-1 p-4'}>
        <div className={'truncate text-sm font-semibold text-text-primary'}>{data.title || url}</div>
        {data.description ? (
          <div
            className={'overflow-hidden text-xs text-text-secondary'}
            style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
          >
            {data.description}
          </div>
        ) : null}
        <div className={'mt-2 flex items-center gap-1.5'}>
          {favicon ? (
            <img src={favicon} alt={''} className={'h-4 w-4 flex-none rounded-sm object-contain'} />
          ) : (
            <EarthIcon className={'h-4 w-4 flex-none text-text-secondary'} />
          )}
          <span className={'truncate text-xs font-bold text-text-primary'}>{data.siteName || hostLabel(url)}</span>
        </div>
      </div>
    </div>
  );
});

export default MentionLinkPreviewCard;
