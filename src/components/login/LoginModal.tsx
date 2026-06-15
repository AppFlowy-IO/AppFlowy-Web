import { Dialog, IconButton } from '@mui/material';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';

import { Login } from './Login';

export function LoginModal({ redirectTo, open, onClose }: { redirectTo: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <div className={'relative px-6'}>
        <Login redirectTo={redirectTo} />
        <div className={'absolute top-2 right-2'}>
          <IconButton size={'small'} color={'inherit'} className={'h-6 w-6'} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
    </Dialog>
  );
}

export default LoginModal;
