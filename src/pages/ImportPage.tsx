import Import from '@/components/_shared/more-actions/importer/Import';
import { Typography } from '@mui/material';
import React from 'react';
import { ReactComponent as AppflowyLogo } from '@/assets/icons/appflowy.svg';
import { useSearchParams } from 'react-router-dom';

function ImportPage() {
  const [search] = useSearchParams();
  const redirectTo = search.get('redirectToImport');
  const onSuccess = React.useCallback(() => {
    if (redirectTo) {
      window.location.href = redirectTo;
    }
  }, [redirectTo]);

  return (
    <div className={'flex h-screen w-screen flex-col bg-[#EEEEFD]'}>
      <div className={'h-[64px] w-full py-4 px-6'}>
        <Typography variant='h3' className={'mb-[27px] flex items-center gap-4 text-text-title'} gutterBottom>
          <>
            <AppflowyLogo className={'w-32'} />
          </>
        </Typography>
      </div>
      <Import onSuccessfulImport={onSuccess} disableClose={true} />
    </div>
  );
}

export default ImportPage;
