import ErrorOutline from '@mui/icons-material/ErrorOutline';
import HighlightOff from '@mui/icons-material/HighlightOff';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import IconButton from '@mui/material/IconButton';
import { CustomContentProps, SnackbarContent, useSnackbar } from 'notistack';
import React from 'react';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';

const CustomSnackbar = React.forwardRef<HTMLDivElement, CustomContentProps>((props, ref) => {
  const { id, message, variant } = props;
  const { closeSnackbar } = useSnackbar();

  const icons = {
    success: <TaskAltRounded className='h-5 w-5 text-green-500' />,
    error: <HighlightOff className='h-5 w-5 text-red-500' />,
    warning: <ErrorOutline className='h-5 w-5 text-yellow-500' />,
    info: <PowerSettingsNew className='h-5 w-5 text-blue-500' />,
    loading: null,
    default: null,
  };

  const colors = {
    success: 'border-green-300 border bg-background-primary',
    error: 'bg-background-primary border-red-300 border',
    warning: 'bg-background-primary border-yellow-300 border',
    info: 'bg-background-primary border-blue-300 border',
    default: 'bg-background-primary border border-content-blue-400',
  };

  const [hovered, setHovered] = React.useState<boolean>(false);

  return (
    <SnackbarContent
      ref={ref}
      className={`${colors[variant]} rounded-lg shadow`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className='flex w-full items-center justify-between p-3'>
        <div className='flex-shrink-0'>{icons[variant]}</div>
        <div className='ml-3 flex-1'>
          <p className='text-sm font-medium'>{message}</p>
        </div>
        {hovered && (
          <IconButton
            className={'mx-2 rounded-full bg-fill-content-hover opacity-60 hover:opacity-100'}
            onClick={() => closeSnackbar(id)}
          >
            <CloseIcon className='h-3 w-3 text-text-primary' />
          </IconButton>
        )}
      </div>
    </SnackbarContent>
  );
});

export default CustomSnackbar;
