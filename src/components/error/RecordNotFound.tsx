import emptyImageSrc from '@/assets/images/empty.png';
import React from 'react';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';

function RecordNotFound({ noContent, isViewNotFound }: { noContent?: boolean; isViewNotFound?: boolean }) {
  return (
    <div className={'flex h-full w-full flex-col items-center justify-center px-4'}>
      {!noContent && (
        <>
          <div className={'flex items-center gap-4 text-2xl font-bold text-text-title opacity-70'}>
            <WarningIcon className={'h-12 w-12'} />
            {isViewNotFound ? 'Page Not Found' : 'Record Not Found'}
          </div>
          <div className={'mt-4 whitespace-pre-wrap break-words text-center text-lg text-text-title opacity-50'}>
            {`We're sorry for inconvenience\n`}
            Submit an issue on our{' '}
            <a
              className={'text-fill-default  underline'}
              href={'https://github.com/AppFlowy-IO/AppFlowy/issues/new?template=bug_report.yaml'}
            >
              Github
            </a>{' '}
            page that describes your error
          </div>
        </>
      )}

      <img src={emptyImageSrc} alt={'AppFlowy'} />
    </div>
  );
}

export default RecordNotFound;
