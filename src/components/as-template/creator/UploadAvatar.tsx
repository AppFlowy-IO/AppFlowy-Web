import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { TemplateService } from '@/application/services/domains';

/**
 * Preview URL for the selected avatar file.
 *
 * `URL.createObjectURL` allocates a blob URL per call; creating one inline
 * during render leaks a URL on every render and never releases it. This hook
 * creates at most one live URL per file and revokes it when the file changes
 * or the component unmounts.
 */
export function usePreviewObjectUrl(file: File | null): string | null {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return previewUrl;
}

function UploadAvatar({ onChange }: { onChange: (url: string) => void }) {
  const { t } = useTranslation();

  const [file, setFile] = React.useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [hovered, setHovered] = React.useState(false);
  const previewUrl = usePreviewObjectUrl(file);

  const uploadStatusText = useMemo(() => {
    switch (uploadStatus) {
      case 'success':
        return t('fileDropzone.uploadSuccess');
      case 'error':
        return t('fileDropzone.uploadFailed');
      default:
        return t('fileDropzone.uploading');
    }
  }, [uploadStatus, t]);
  const handleUpload = useCallback(
    async (file: File) => {
      setUploadStatus('loading');

      try {
        const url = await TemplateService.uploadAvatar(file);

        if (!url) throw new Error('Failed to upload file');
        onChange(url);
        setUploadStatus('success');
      } catch (error) {
        onChange('');
        setUploadStatus('error');
      }
    },
    [onChange]
  );

  return (
    <>
      <FileDropzone
        accept={'image/*'}
        onChange={(files) => {
          setFile(files[0]);
          void handleUpload(files[0]);
        }}
        loading={uploadStatus === 'loading'}
      />
      {file && previewUrl && (
        <div className={'flex items-center gap-2'}>
          <div className={'aspect-square w-[80px] rounded-xl border border-border-primary'}>
            <img src={previewUrl} alt={file.name} className={'h-full w-full'} />
          </div>

          <div
            className={'flex w-full items-center gap-2 overflow-hidden rounded-lg p-1 hover:bg-fill-content-hover'}
            onMouseLeave={() => setHovered(false)}
            onMouseEnter={() => setHovered(true)}
            style={{
              color: uploadStatus === 'error' ? 'var(--function-error)' : undefined,
            }}
          >
            {uploadStatus === 'loading' ? <CircularProgress size={20} /> : <LinkIcon />}

            <Tooltip title={uploadStatusText} placement={'bottom-start'}>
              <div className={'flex-1 cursor-pointer truncate'}>{file.name}</div>
            </Tooltip>
            {uploadStatus === 'success' && !hovered && <CheckIcon className={'h-5 w-5 text-function-success'} />}
            {hovered && (
              <Tooltip title={t('button.remove')} arrow>
                <IconButton
                  onClick={() => {
                    setFile(null);
                    onChange('');
                  }}
                  size={'small'}
                  color={'error'}
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default UploadAvatar;
