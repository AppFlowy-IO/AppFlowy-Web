import { useTheme } from 'next-themes';
import { Toaster as Sonner, ToasterProps } from 'sonner';
import { ReactComponent as ToastSuccess } from '@/assets/toast_success.svg';
import { ReactComponent as ToastWarning } from '@/assets/toast_warning.svg';
import { ReactComponent as ToastError } from '@/assets/toast_error.svg';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group'
      {...props}
      position='bottom-center'
      visibleToasts={1}
      toastOptions={{
        className:
          'shadow-toast px-4 py-2 gap-2 bg-fill-primary border-none text-text-quaternary w-fit max-w-[360px] rounded-400',
      }}
      icons={{
        success: <ToastSuccess className='h-5 w-5 text-fill-success-thick' />,
        warning: <ToastWarning className='h-5 w-5 text-fill-warning-thick' />,
        error: <ToastError className='h-5 w-5 text-fill-error-thick' />,
      }}
    />
  );
};

export { Toaster };
