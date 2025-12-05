import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Progress } from '@/components/ui/progress';

interface FileDropzoneProps {
  onChange?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string | React.ReactNode;
  loading?: boolean;
}

function FileDropzone({ onChange, accept, multiple, disabled, placeholder, loading }: FileDropzoneProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList) => {
    const fileArray = Array.from(files);

    if (onChange) {
      if (!multiple && fileArray.length > 1) {
        onChange(fileArray.slice(0, 1));
      } else {
        onChange(fileArray);
      }
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);

    const toastError = () => toast.error(t('document.plugins.file.noImages'));

    if (!event.dataTransfer.files || event.dataTransfer.files.length === 0) {
      toastError();
      return;
    }

    const files = Array.from(event.dataTransfer.files);

    if (accept) {
      const isEveryFileValid = files.every((file: File) => {
        const acceptedTypes = accept.split(',');

        return acceptedTypes.some((type) => file.name.endsWith(type) || file.type === type);
      });

      if (!isEveryFileValid) {
        toastError();
        event.dataTransfer.clearData();
        return;
      }
    }

    handleFiles(event.dataTransfer.files);
    event.dataTransfer.clearData();
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(event.target.files);
      event.target.value = '';
    }
  };

  return (
    <div className='relative h-full'>
      <div
        data-testid='file-dropzone'
        className='flex h-full min-h-[294px] w-full cursor-pointer flex-col justify-center rounded-[8px] bg-surface-primary px-4 text-center outline-dashed outline-2 outline-border-primary hover:bg-surface-primary-hover'
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        style={{
          borderColor: dragging ? 'var(--border-theme-thick)' : undefined,
          backgroundColor: dragging ? 'var(--fill-info-light)' : undefined,
          pointerEvents: disabled || loading ? 'none' : undefined,
          cursor: disabled ? 'not-allowed' : loading ? 'wait' : undefined,
        }}
      >
        <div
          className={
            'flex items-center justify-center whitespace-pre-wrap break-words text-center text-sm text-text-primary'
          }
        >
          {placeholder || (
            <>
              <span>{t('document.plugins.file.fileUploadHint')}</span>
              click to <span className='text-text-action'>{t('document.plugins.file.fileUploadHintSuffix')}</span>
            </>
          )}
        </div>
        <input
          type='file'
          disabled={disabled || loading}
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept={accept}
          multiple={multiple}
          onChange={handleFileChange}
        />
      </div>
      {loading && (
        <div className='bg-surface-primary/80 absolute inset-0 flex items-center justify-center rounded-[8px] backdrop-blur-sm'>
          <div className='flex flex-col items-center gap-3'>
            <Progress variant='primary' />
          </div>
        </div>
      )}
    </div>
  );
}

export default FileDropzone;
