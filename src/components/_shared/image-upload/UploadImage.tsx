import React, { useCallback } from 'react';

import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { notify } from '@/components/_shared/notify';

export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];

export function UploadImage({
  onDone,
  uploadAction,
}: {
  onDone?: (url: string) => void;
  uploadAction?: (file: File, onProgress?: (progress: number) => void) => Promise<string>;
}) {
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<number | undefined>(undefined);

  const handleFileChange = useCallback(
    async (files: File[]) => {
      setLoading(true);
      setProgress(undefined);
      const file = files[0];

      if (!file) return;

      try {
        const url = await uploadAction?.(file, (p) => setProgress(p * 100));

        if (!url) {
          return;
        }

        onDone?.(url);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      } finally {
        setLoading(false);
        setProgress(undefined);
      }
    },
    [onDone, uploadAction]
  );

  return (
    <div className={'h-full'}>
      <FileDropzone
        onChange={handleFileChange}
        accept={ALLOWED_IMAGE_EXTENSIONS.join(',')}
        loading={loading}
        progress={progress}
      />
    </div>
  );
}

export default UploadImage;
