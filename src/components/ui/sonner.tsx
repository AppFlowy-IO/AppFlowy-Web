import { useTheme } from 'next-themes';
import { Toaster as Sonner, ToasterProps } from 'sonner';

import { ReactComponent as ToastError } from '@/assets/icons/error.svg';
import { ReactComponent as ToastSuccess } from '@/assets/icons/success.svg';
import { ReactComponent as ToastWarning } from '@/assets/icons/warning.svg';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group flex items-center justify-center"
      {...props}
      position="bottom-center"
      visibleToasts={1}
      toastOptions={{
        className:
          '!shadow-toast px-4 py-2 max-w-[360px] w-fit gap-2 bg-surface-inverse border-none text-text-on-fill rounded-400',
        classNames: {
          actionButton: '!text-text-action font-semibold !px-2 hover:!text-text-action-hover bg-transparent hover:bg-transparent',
        },
      }}
      icons={{
        success: <ToastSuccess className="h-5 w-5 text-icon-success-thick" />,
        warning: <ToastWarning className="h-5 w-5 text-icon-warning-thick" />,
        error: <ToastError className="h-5 w-5 text-icon-error-thick" />,
      }}
    />
  );
};

export { Toaster };
