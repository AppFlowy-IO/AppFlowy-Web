import React, { useState, useCallback, useEffect } from 'react';
import { checkImage } from '@/utils/image';
import LoadingDots from '@/components/_shared/LoadingDots';
import { useTranslation } from 'react-i18next';
import { ReactComponent as ErrorOutline } from '@/assets/icons/error.svg';

function Img({
  onLoad,
  imgRef,
  url,
  width,
}: {
  url: string;
  imgRef?: React.RefObject<HTMLImageElement>;
  onLoad?: () => void;
  width: number | string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [localUrl, setLocalUrl] = useState('');
  const [imgError, setImgError] = useState<{
    ok: boolean;
    status: number;
    statusText: string;
  } | null>(null);

  const handleCheckImage = useCallback(async (url: string) => {
    setLoading(true);

    // Configuration for polling
    const maxAttempts = 5; // Maximum number of polling attempts
    const pollingInterval = 6000; // Time between attempts in milliseconds (6 seconds)
    const timeoutDuration = 30000; // Maximum time to poll in milliseconds (30 seconds)

    let attempts = 0;
    const startTime = Date.now();

    const attemptCheck: () => Promise<boolean> = async () => {
      try {
        const result = await checkImage(url);

        // Success case
        if (result.ok) {
          setImgError(null);
          setLoading(false);
          setLocalUrl(result.validatedUrl || '');
          setTimeout(() => {
            if (onLoad) {
              onLoad();
            }
          }, 200);

          return true;
        }

        // Error case but continue polling if within limits
        setImgError(result);

        // Check if we've exceeded our timeout or max attempts
        attempts++;
        const elapsedTime = Date.now() - startTime;

        if (attempts >= maxAttempts || elapsedTime >= timeoutDuration) {
          setLoading(false); // Stop loading after max attempts or timeout
          setImgError({ ok: false, status: 404, statusText: 'Image Not Found' });
          return false;
        }

        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        return await attemptCheck();
        // eslint-disable-next-line
      } catch (e) {
        setImgError({ ok: false, status: 404, statusText: 'Image Not Found' });
        // Check if we should stop trying
        attempts++;
        const elapsedTime = Date.now() - startTime;

        if (attempts >= maxAttempts || elapsedTime >= timeoutDuration) {
          setLoading(false);
          return false;
        }

        // Continue polling after interval
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        return await attemptCheck();
      }
    };

    void attemptCheck();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    void handleCheckImage(url);
  }, [handleCheckImage, url]);

  return (
    <>
      <img
        ref={imgRef}
        src={localUrl}
        alt={''}
        onLoad={() => {
          setLoading(false);
          setImgError(null);
        }}
        draggable={false}
        style={{
          visibility: imgError ? 'hidden' : 'visible',
          width,
        }}
        className={'h-full bg-cover bg-center object-cover'}
      />
      {loading ? (
        <div className={'absolute inset-0 flex h-full w-full items-center justify-center bg-bg-body'}>
          <LoadingDots />
        </div>
      ) : imgError ? (
        <div
          className={
            'flex h-[48px] w-full items-center justify-center gap-2 rounded border border-function-error bg-red-50'
          }
        >
          <ErrorOutline className={'text-function-error'} />
          <div className={'text-function-error'}>{t('editor.imageLoadFailed')}</div>
        </div>
      ) : null}
    </>
  );
}

export default Img;
