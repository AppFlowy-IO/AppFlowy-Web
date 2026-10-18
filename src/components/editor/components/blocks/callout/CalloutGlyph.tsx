import DOMPurify from 'dompurify';
import { useEffect, useMemo, useState } from 'react';

import { renderColor } from '@/utils/color';
import { getCachedIcon, getIcon } from '@/utils/emoji';

/** Shared renderer for the same icon catalog used by Flutter's callout presets. */
export function CalloutGlyph({ id, color }: { id: string; color: string }) {
  // A loaded catalog renders on the first pass; only a cold catalog goes through the effect.
  const cachedContent = getCachedIcon(id)?.content;
  const [loaded, setLoaded] = useState<{ id: string; content: string }>();

  useEffect(() => {
    if (cachedContent !== undefined) return;

    let active = true;

    void getIcon(id)
      .then((icon) => {
        if (active) setLoaded({ id, content: icon?.content || '' });
      })
      .catch(() => {
        if (active) setLoaded({ id, content: '' });
      });
    return () => {
      active = false;
    };
  }, [id, cachedContent]);

  const svg = cachedContent ?? (loaded?.id === id ? loaded.content : '');
  const cleanSvg = useMemo(
    () =>
      DOMPurify.sanitize(svg.replaceAll('black', 'currentColor'), {
        USE_PROFILES: { svg: true, svgFilters: true },
      }),
    [svg]
  );

  return (
    <span
      aria-hidden='true'
      className='flex h-5 w-5 shrink-0 items-center justify-center'
      style={{ color: renderColor(color) }}
      dangerouslySetInnerHTML={{ __html: cleanSvg }}
    />
  );
}
