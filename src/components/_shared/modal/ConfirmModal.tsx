import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from './NormalModal';

const CONFIRM_MODAL_PAPER_PROPS = {
  sx: {
    width: 500,
    maxWidth: 'calc(100% - 32px)',
  },
} as const;

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  loading?: boolean;
  dialogTestId?: string;
  confirmTestId?: string;
}

/** A consistent MUI-backed confirmation modal for destructive actions. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  loading,
  dialogTestId,
  confirmTestId,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const descriptionId = useId();

  return (
    <NormalModal
      aria-describedby={descriptionId}
      data-testid={dialogTestId}
      open={open}
      keepMounted={false}
      disableRestoreFocus
      danger
      title={<div className='flex w-full items-center text-left font-semibold'>{title}</div>}
      okText={confirmText ?? t('button.delete')}
      cancelText={cancelText ?? t('button.cancel')}
      okLoading={loading}
      onOk={onConfirm}
      onCancel={onClose}
      onClose={onClose}
      PaperProps={CONFIRM_MODAL_PAPER_PROPS}
      okButtonProps={{ 'data-testid': confirmTestId }}
    >
      <div id={descriptionId} className='font-normal text-text-secondary'>
        {description}
      </div>
    </NormalModal>
  );
}
