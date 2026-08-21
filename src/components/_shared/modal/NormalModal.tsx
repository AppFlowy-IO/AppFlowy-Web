import { CircularProgress, Dialog, DialogProps, IconButton } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ModalButtonProps = React.ComponentProps<typeof Button>;

// `AFButtonSize.m`, which every desktop dialog footer uses: spacing.xl of
// horizontal padding and a `body.enhanced` (w500) label. The shared `Button`
// defaults to the tighter px-3/w400 pairing.
const FOOTER_BUTTON_CLASS = 'px-4 font-medium';

const ENTER_HANDLED_BY_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'textarea',
  'select',
  '[role="button"]',
  '[contenteditable="true"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(',');

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export interface NormalModalProps extends DialogProps {
  okText?: React.ReactNode;
  cancelText?: React.ReactNode;
  onOk?: () => void;
  onCancel?: () => void;
  danger?: boolean;
  onClose?: () => void;
  title: string | React.ReactNode;
  okButtonProps?: ModalButtonProps & { 'data-testid'?: string };
  cancelButtonProps?: ModalButtonProps;
  okLoading?: boolean;
  closable?: boolean;
  overflowHidden?: boolean;
}

export function NormalModal({
  okText,
  title,
  cancelText,
  onOk,
  onCancel,
  danger,
  onClose,
  children,
  okButtonProps,
  cancelButtonProps,
  okLoading,
  closable = true,
  overflowHidden = false,
  ...dialogProps
}: NormalModalProps) {
  const { t } = useTranslation();
  const generatedTitleId = React.useId();
  const modalOkText = okText || t('button.ok');
  const modalCancelText = cancelText || t('button.cancel');
  const labelledBy = dialogProps['aria-labelledby'] || generatedTitleId;
  const internalTitleId = dialogProps['aria-labelledby'] ? undefined : generatedTitleId;

  return (
    <Dialog
      aria-labelledby={labelledBy}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && closable) {
          onClose?.();
        }

        const targetHandlesEnter =
          e.target instanceof Element && e.target.closest(ENTER_HANDLED_BY_CONTROL_SELECTOR) !== null;

        if (e.key === 'Enter' && onOk && !targetHandlesEnter) {
          onOk();
        }
      }}
      {...dialogProps}
    >
      <div
        style={{
          overflow: overflowHidden ? 'hidden' : 'auto',
        }}
        className={'relative flex flex-col gap-4 p-5'}
      >
        <div className={'flex w-full items-center justify-between text-base font-medium'}>
          <div id={internalTitleId} className={'flex-1 truncate text-center font-medium'}>
            {title}
          </div>
          {closable && (
            <div className={'relative -right-1.5'}>
              <IconButton
                aria-label={t('button.close')}
                size={'small'}
                color={'inherit'}
                className={'h-6 w-6'}
                onClick={onClose || onCancel}
              >
                <CloseIcon />
              </IconButton>
            </div>
          )}
        </div>

        <div
          style={{
            overflow: overflowHidden ? 'hidden' : 'auto',
          }}
          className={'w-full flex-1'}
        >
          {children}
        </div>
        {/* Desktop footers are right-aligned with a spacing.l gap, cancel first. */}
        <div className={'flex w-full justify-end gap-3'}>
          <Button
            // MUI's Button defaulted to type="button"; the design-system one
            // does not, and a bare button inside a <form> would submit it.
            type={'button'}
            variant={'outline'}
            onClick={() => {
              if (onCancel) {
                onCancel();
              } else {
                onClose?.();
              }
            }}
            {...cancelButtonProps}
            className={cn(FOOTER_BUTTON_CLASS, cancelButtonProps?.className)}
          >
            {modalCancelText}
          </Button>
          <Button
            type={'button'}
            data-testid={danger ? 'confirm-delete-button' : 'modal-ok-button'}
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              if (okLoading) return;
              onOk?.();
            }}
            disabled={okLoading}
            {...okButtonProps}
            className={cn(FOOTER_BUTTON_CLASS, okButtonProps?.className)}
          >
            {okLoading ? <CircularProgress color={'inherit'} size={16} /> : modalOkText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default NormalModal;
