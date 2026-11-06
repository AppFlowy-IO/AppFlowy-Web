import { CircularProgress } from '@mui/material';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createApi } from 'unsplash-js';

import { Input } from '@/components/ui/input';

const unsplash = createApi({
  accessKey: '1WxD1JpMOUX86lZKKob4Ca0LMZPyO2rUmAgjpWm9Ids',
});
const SEARCH_DEBOUNCE_TIME = 500;
const COLUMNS = 3;

type Photo = { id: string; thumb: string; full: string; alt: string | null; downloadLocation?: string };

export function Unsplash({ onDone, onEscape }: { onDone?: (value: string) => void; onEscape?: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setError(false);
        setLoading(true);
        try {
          const options = { signal: controller.signal };
          const result = searchValue
            ? await unsplash.search.getPhotos({ query: searchValue, perPage: 18, page: 1 }, options)
            : await unsplash.photos.list({ perPage: 18, page: 1 }, options);

          if (controller.signal.aborted) return;
          if (result.errors || !result.response) throw new Error('Unsplash request failed');
          setPhotos(
            result.response.results.map((photo) => ({
              id: photo.id,
              thumb: photo.urls.thumb,
              full: photo.urls.full,
              alt: photo.alt_description,
              downloadLocation: photo.links?.download_location,
            }))
          );
          setActive(null);
        } catch {
          if (!controller.signal.aborted) setError(true);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      searchValue ? SEARCH_DEBOUNCE_TIME : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchValue]);

  const select = (photo: Photo) => {
    // Tracking is best effort and must not delay insertion or depend on the
    // picker remaining mounted after a selection.
    if (photo.downloadLocation?.startsWith('https://api.unsplash.com/')) {
      void unsplash.photos.trackDownload({ downloadLocation: photo.downloadLocation }).catch(() => undefined);
    }

    onDone?.(photo.full);
  };

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onEscape?.();
        }
      }}
      className='flex h-fit max-w-[600px] flex-col gap-2'
    >
      <Input
        variant='default'
        autoFocus
        spellCheck={false}
        onChange={(event) => setSearchValue(event.target.value)}
        onFocus={() => setActive(null)}
        value={searchValue}
        className='w-full'
        placeholder={t('document.imageBlock.searchForAnImage')}
        aria-label={t('document.imageBlock.searchForAnImage')}
      />
      {loading ? (
        <div role='status' className='flex h-[120px] w-full items-center justify-center gap-2 text-xs'>
          <CircularProgress size={24} />
          <span>{t('editor.loading')}</span>
        </div>
      ) : error ? (
        <Typography
          role='alert'
          className='flex h-[120px] w-full items-center justify-center gap-2 text-xs text-function-error'
        >
          {t('web.imageBlock.unsplashFailed')}
        </Typography>
      ) : photos.length ? (
        <div className='flex flex-col gap-4'>
          <div
            ref={grid}
            role='listbox'
            aria-label={t('pageStyle.unsplash')}
            aria-activedescendant={active === null ? undefined : `${id}-${active}`}
            tabIndex={0}
            className='grid w-full grid-cols-3 gap-2 outline-none'
            onFocus={() => setActive((value) => value ?? 0)}
            onKeyDown={(event) => {
              const index = active ?? 0;
              let next = index;

              if (event.key === 'ArrowRight' && index % COLUMNS < COLUMNS - 1 && index + 1 < photos.length) next++;
              else if (event.key === 'ArrowLeft' && index % COLUMNS > 0) next--;
              else if (event.key === 'ArrowDown' && index + COLUMNS < photos.length) next += COLUMNS;
              else if (event.key === 'ArrowUp' && index >= COLUMNS) next -= COLUMNS;
              else if (event.key === 'Enter' || event.key === ' ') select(photos[index]);
              else if (!event.key.startsWith('Arrow')) return;
              event.preventDefault();
              event.stopPropagation();
              setActive(next);
              grid.current?.children[next]?.scrollIntoView({ block: 'nearest' });
            }}
          >
            {photos.map((photo, index) => (
              <div
                key={photo.id + photo.full}
                id={`${id}-${index}`}
                role='option'
                aria-label={photo.alt || t('document.plugins.image.addAnImageDesktop')}
                aria-selected={active === index}
                onPointerMove={() => setActive(index)}
                onClick={() => select(photo)}
                className={`relative cursor-pointer rounded pt-[56.25%] ${
                  active === index ? 'ring-2 ring-border-theme-thick' : ''
                }`}
              >
                <img
                  src={photo.thumb}
                  alt={photo.alt ?? ''}
                  className='absolute left-0 top-0 h-full w-full rounded object-cover transition-opacity hover:opacity-80'
                />
              </div>
            ))}
          </div>
          <Typography className='w-full text-center text-xs text-text-secondary'>
            {t('findAndReplace.searchMore')}
          </Typography>
        </div>
      ) : (
        <Typography
          role='status'
          className='flex h-[120px] w-full items-center justify-center gap-2 text-xs text-text-secondary'
        >
          {t('findAndReplace.noResult')}
        </Typography>
      )}
    </div>
  );
}
