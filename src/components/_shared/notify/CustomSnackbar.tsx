import {
  ErrorOutline,
  HighlightOff,
  PowerSettingsNew,
  TaskAltRounded,
} from '@mui/icons-material';
import { IconButton } from '@mui/material';
import React from 'react';
import { useSnackbar, SnackbarContent, CustomContentProps } from 'notistack';
import { ReactComponent as CloseIcon } from '@/assets/close.svg';

const CustomSnackbar = React.forwardRef<HTMLDivElement, CustomContentProps>((props, ref) => {
  const { id, message, variant } = props;
  const { closeSnackbar } = useSnackbar();

  const icons = {
    success: <TaskAltRounded className="w-5 h-5 text-green-500" />,
    error: <HighlightOff className="w-5 h-5 text-red-500" />,
    warning: <ErrorOutline className="w-5 h-5 text-yellow-500" />,
    info: <PowerSettingsNew className="w-5 h-5 text-blue-500" />,
    loading: null,
    default: null,
  };

  const colors = {
    success: 'border-green-300 border bg-bg-body',
    error: 'bg-bg-body border-red-300 border',
    warning: 'bg-bg-body border-yellow-300 border',
    info: 'bg-bg-body border-blue-300 border',
    default: 'bg-bg-body border border-content-blue-400',
  };

  const [hovered, setHovered] = React.useState<boolean>(false);

  return (
    <SnackbarContent
      ref={ref}
      className={`${colors[variant]} rounded-lg shadow`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between w-full p-3">
        <div className="flex-shrink-0">
          {icons[variant]}
        </div>
        <div className="ml-3 flex-1">
          <p className="text-sm font-medium">{message}</p>
        </div>
        {hovered && <IconButton
          className={'mx-2 rounded-full bg-fill-list-hover hover:opacity-100 opacity-60'}
          onClick={() => closeSnackbar(id)}
        >
          <CloseIcon className="h-3 w-3 text-text-title" />
        </IconButton>}

      </div>
    </SnackbarContent>
  );
});

export default CustomSnackbar;