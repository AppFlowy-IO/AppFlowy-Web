import { useTranslation } from 'react-i18next';

import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { notify } from '@/components/_shared/notify';
import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/utils/copy';

export function CopyLink({ url }: { url?: string }) {
  const { t } = useTranslation();
  const handleCopy = () => {
    void copyTextToClipboard(url ?? window.location.href);
    notify.success(t('shareAction.copyLinkSuccess'));
  };

  return <div className="pt-4 w-full">
    <div className="px-2">
      <div className="flex px-3 py-2 border border-border-primary justify-between items-center bg-surface-container-layer-01 rounded-300">
        <div className='flex flex-1 gap-2 items-center text-xs text-text-primary'>
          <LinkIcon className='h-5 w-5' />
          <div className='flex-1'>{t('shareAction.copyLinkTitle')}</div>
        </div>
        <Button onClick={handleCopy} variant={'outline'} className='bg-surface-primary'>
          {t('shareAction.copyLink')}
        </Button>
      </div>
    </div>
  </div>;
}
