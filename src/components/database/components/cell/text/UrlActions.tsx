import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as CopySvg } from '@/assets/icons/copy.svg';
import { ReactComponent as LinkSvg } from '@/assets/icons/link.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/utils/copy';
import { openUrl } from '@/utils/url';


function UrlActions ({ url }: {
  url: string
}) {
  const { t } = useTranslation();

  return (
    <div className={'flex items-start gap-1'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={'outline'}
            size={'icon'}
            className={'bg-surface-primary hover:bg-surface-primary-hover'}
            onClick={(e) => {
              e.stopPropagation();
              void openUrl(url, '_blank');
            }}
          >
            <LinkSvg className={'h-5 w-5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('editor.openLink')}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={'bg-surface-primary hover:bg-surface-primary-hover'}

            onClick={async (e) => {
              e.stopPropagation();
              await copyTextToClipboard(url);
              toast.success(t('grid.url.copy'));
            }}
            variant={'outline'}
            size={'icon'}
          >
            <CopySvg className={'h-5 w-5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('editor.copyLink')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export default UrlActions;