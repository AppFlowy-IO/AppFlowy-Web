import { Alert } from '@mui/material';

import { ReactComponent as WarningIcon } from '@/assets/icons/close.svg';
import emptyImageSrc from '@/assets/images/empty.png';

function SomethingError({ error }: { error: Error }) {
  return (
    <div className={'flex h-full w-full flex-col items-center justify-center'}>
      <div className={'flex items-center gap-4 text-2xl font-bold text-text-primary opacity-70'}>
        <WarningIcon className={'h-12 w-12'} />
        SomethingError
      </div>
      <Alert className={'max-w-[90%] whitespace-pre-wrap break-words px-6 '} severity={'error'}>
        {error.message}
      </Alert>
      <div className={'mt-4 whitespace-pre text-center text-lg text-text-primary opacity-50'}>
        {`We're sorry for inconvenience\n`}
        Submit an issue on our{' '}
        <a
          className={'text-text-action underline'}
          href={'https://github.com/AppFlowy-IO/AppFlowy/issues/new?template=bug_report.yaml'}
        >
          Github
        </a>{' '}
        page that describes your error
      </div>
      <img src={emptyImageSrc} alt={'AppFlowy'} />
    </div>
  );
}

export default SomethingError;
