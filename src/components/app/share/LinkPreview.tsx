import { Button, OutlinedInput, Tooltip } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/link.svg';
import { notify } from '@/components/_shared/notify';
import { copyTextToClipboard } from '@/utils/copy';

function LinkPreview({ url }: { url: string }) {
  const [clickCopy, setClickCopy] = React.useState(false);

  const { t } = useTranslation();

  return (
    <div className={'flex'}>
      <OutlinedInput
        readOnly
        size={'small'}
        style={{
          borderBottomRightRadius: 0,
          borderTopRightRadius: 0,
        }}
        value={url}
        className={'flex-1'}
      />

      <Tooltip title={clickCopy ? t('message.copy.success') : t('grid.url.copy')} placement={'top'}>
        <Button
          size={'small'}
          style={{
            borderBottomRightRadius: 8,
            borderTopRightRadius: 8,
            borderLeft: 'none',
          }}
          className={'min-w-0 rounded-none'}
          variant={'outlined'}
          color={'inherit'}
          onMouseLeave={() => {
            setClickCopy(false);
          }}
          onClick={async () => {
            setClickCopy(true);
            try {
              await copyTextToClipboard(url);
              notify.success(t('grid.url.copy'));
            } catch (_) {
              //do nothing
            }
          }}
        >
          {clickCopy ? <CheckIcon className={'h-5 w-5 text-function-success'} /> : <CopyIcon className={'h-5 w-5'} />}
        </Button>
      </Tooltip>
    </div>
  );
}

export default LinkPreview;
