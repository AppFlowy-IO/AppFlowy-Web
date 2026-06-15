import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import { RequestAccessContent } from '@/components/app/share/RequestAccessContent';

interface RequestAccessProps {
  error?: RequestAccessError;
}

function RequestAccess({ error }: RequestAccessProps) {
  return (
    <div className='flex h-screen w-screen flex-col bg-background-primary'>
      <div className='absolute left-0 top-0 flex h-[60px] w-full items-center justify-between gap-[10px] p-4'>
        <span
          onClick={() => {
            window.open('/app', '_self');
          }}
          className='h-full w-[141px] cursor-pointer'
        >
          <AppFlowyLogo className='h-full w-full' />
        </span>
      </div>
      <div className='flex w-full flex-1 items-center justify-center'>
        <RequestAccessContent error={error} />
      </div>
    </div>
  );
}

export default RequestAccess;
