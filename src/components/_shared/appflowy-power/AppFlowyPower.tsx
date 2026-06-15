import { Divider } from '@mui/material';

import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';

function AppFlowyPower({ divider, width }: { divider?: boolean; width?: number }) {
  return (
    <div
      style={{
        width,
      }}
      className={
        'sticky bottom-[-0.5px] flex w-full transform-gpu flex-col items-center justify-center rounded-[16px] bg-background-primary'
      }
    >
      {divider && <Divider className={'my-0 w-full'} />}

      <div
        onClick={() => {
          window.open('https://appflowy.com', '_blank');
        }}
        style={{
          width,
        }}
        className={
          'flex  w-full cursor-pointer items-center justify-center gap-2 py-4 text-sm text-text-primary opacity-50'
        }
      >
        Powered by
        <AppFlowyLogo className={'w-[88px]'} />
      </div>
    </div>
  );
}

export default AppFlowyPower;
