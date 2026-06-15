import React, { lazy } from 'react';
import { toast } from 'sonner';

import type { InfoProps } from '@/components/_shared/notify/InfoSnackbar';

export const InfoSnackbar = lazy(() => import('./InfoSnackbar'));

export const notify = {
  success: (message: string | React.ReactNode) => {
    toast.success(message);
  },
  error: (message: string | React.ReactNode) => {
    toast.error(message);
  },
  default: (message: string | React.ReactNode) => {
    toast(message);
  },
  warning: (message: string | React.ReactNode) => {
    toast.warning(message);
  },
  info: (props: InfoProps) => {
    window.toast.info({
      ...props,
      variant: 'info',
      anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'center',
      },
    });
  },
  clear: () => {
    toast.dismiss();
  },
};

export type { InfoProps, InfoSnackbarProps } from './InfoSnackbar';
