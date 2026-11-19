import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ThemeModeContext } from '@/components/main/useAppThemeMode';

import { cachedMermaid, renderMermaid } from './mermaid-renderer';

type RenderResult = { key: string; svg?: string; error?: string };

/** Code block labels with English fallbacks, until every language carries them. */
export function useCodeBlockLabel() {
  const { t } = useTranslation();

  return (key: string, fallback: string) => t(`document.plugins.codeBlock.${key}`, { defaultValue: fallback });
}

/**
 * Renders a Mermaid source for the current theme. Rendering waits for typing to
 * pause, and a diagram rendered before (a revisit, or another copy of the same
 * diagram) appears immediately from the cache.
 */
export function useMermaidDiagram(source: string): { svg?: string; error?: string } {
  const isDark = !!useContext(ThemeModeContext)?.isDark;
  const key = `${isDark}\n${source}`;
  const [result, setResult] = useState<RenderResult | undefined>(() => {
    const svg = source.trim() ? cachedMermaid(source, isDark) : undefined;

    return svg === undefined ? undefined : { key, svg };
  });
  const settled = result?.key === key;

  useEffect(() => {
    if (!source.trim() || settled) return;
    const cached = cachedMermaid(source, isDark);

    if (cached !== undefined) {
      setResult({ key, svg: cached });
      return;
    }

    let current = true;
    const timer = window.setTimeout(() => {
      void renderMermaid(source, isDark, () => current)
        .then((svg) => {
          if (current) setResult({ key, svg });
        })
        .catch((failure: unknown) => {
          if (current) setResult({ key, error: failure instanceof Error ? failure.message : String(failure) });
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [source, isDark, key, settled]);

  if (!result || result.key !== key) return {};

  return { svg: result.svg, error: result.error };
}

/** What the diagram area shows before, or instead of, a rendered diagram. */
export function MermaidStatus({ source, svg, error }: { source: string; svg?: string; error?: string }) {
  const label = useCodeBlockLabel();

  if (!source.trim()) {
    return (
      <div role='status' className='text-text-tertiary'>
        {label('mermaidPlaceholder', 'Type Mermaid code to create a diagram')}
      </div>
    );
  }

  if (error) {
    return (
      <div role='alert' className='mermaid-error'>
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div role='status' className='text-text-secondary'>
        {label('rendering', 'Rendering diagram…')}
      </div>
    );
  }

  return null;
}

/** The rendered diagram on its own, for read-only surfaces such as chat answers. */
export default function MermaidDiagram({ source }: { source: string }) {
  const { svg, error } = useMermaidDiagram(source);

  return (
    <>
      <MermaidStatus source={source} svg={svg} error={error} />
      {svg && <div className='mermaid-diagram' data-testid='mermaid-diagram' dangerouslySetInnerHTML={{ __html: svg }} />}
    </>
  );
}
