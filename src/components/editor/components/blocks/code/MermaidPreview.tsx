import { Dialog, Tooltip } from '@mui/material';
import { Copy, Download, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

import { notify } from '@/components/_shared/notify';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';

import { copyDiagramImage, downloadDiagram } from './download-diagram';
import { renderMermaid } from './mermaid-renderer';

export default function MermaidPreview({
  source,
  expanded,
  showPreview,
  onClose,
}: {
  source: string;
  expanded: boolean;
  showPreview: boolean;
  onClose: () => void;
}) {
  const isDark = !!useContext(ThemeModeContext)?.isDark;
  const { t } = useTranslation();
  const key = `${isDark}\n${source}`;
  const [result, setResult] = useState<{ key: string; svg?: string; error?: string }>();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const svg = result?.key === key ? result.svg : undefined;
  const error = result?.key === key ? result.error : undefined;
  const label = (key: string, fallback: string) => t(`document.plugins.codeBlock.${key}`, { defaultValue: fallback });

  useEffect(() => {
    if (!source.trim()) return;
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
  }, [source, isDark, key]);

  const close = () => {
    setLocalExpanded(false);
    onClose();
  };

  const copyImage = () => {
    if (!svg || copying) return;
    setCopying(true);
    void copyDiagramImage(svg)
      .then(() => notify.success(t('document.plugins.image.copiedToPasteBoard')))
      .catch(() => notify.error(label('copyImageFailed', 'Could not copy image. Try downloading it instead.')))
      .finally(() => setCopying(false));
  };

  const copyImageButton = (
    <Tooltip title={label('copyImage', 'Copy image')} disableInteractive>
      <button
        type='button'
        aria-label={label('copyImage', 'Copy image')}
        aria-disabled={copying}
        aria-busy={copying}
        onClick={copyImage}
      >
        <Copy size={20} />
      </button>
    </Tooltip>
  );

  const status = !source.trim() ? (
    <div role='status' className='text-text-tertiary'>
      {label('mermaidPlaceholder', 'Type Mermaid code to create a diagram')}
    </div>
  ) : error ? (
    <div role='alert' className='mermaid-error'>
      {error}
    </div>
  ) : !svg ? (
    <div role='status' className='text-text-secondary'>
      {label('rendering', 'Rendering diagram…')}
    </div>
  ) : null;

  return (
    <div contentEditable={false} className='mermaid-preview' data-testid='mermaid-preview'>
      {showPreview && (
        <>
          {status}
          {svg && (
            <div className='mermaid-diagram' data-testid='mermaid-diagram' dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          {svg && (
            <div className='mermaid-preview-actions'>
              {copyImageButton}
              <Tooltip title={label('expandDiagram', 'Expand diagram')} disableInteractive>
                <button
                  type='button'
                  aria-label={label('expandDiagram', 'Expand diagram')}
                  onClick={() => setLocalExpanded(true)}
                >
                  <Maximize2 size={20} />
                </button>
              </Tooltip>
            </div>
          )}
        </>
      )}
      <Dialog
        open={expanded || localExpanded}
        onClose={close}
        fullScreen
        BackdropProps={{ sx: { backgroundColor: 'var(--surface-overlay, rgba(0,0,0,0.6))' } }}
        PaperProps={{ className: 'mermaid-fullscreen' }}
      >
        <div className='mermaid-fullscreen-header'>
          <span>{label('diagram', 'Mermaid diagram')}</span>
          <button type='button' aria-label={t('button.close')} onClick={close}>
            <X size={20} />
          </button>
        </div>
        {status}
        {svg && (
          <TransformWrapper centerOnInit minScale={0.1} maxScale={8}>
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent wrapperClass='mermaid-zoom-wrapper' contentClass='mermaid-zoom-content'>
                  <div className='mermaid-diagram' dangerouslySetInnerHTML={{ __html: svg }} />
                </TransformComponent>
                <div className='mermaid-zoom-toolbar'>
                  <button type='button' aria-label={label('zoomOut', 'Zoom out')} onClick={() => zoomOut()}>
                    <Minus size={20} />
                  </button>
                  <button type='button' aria-label={label('resetZoom', 'Reset zoom')} onClick={() => resetTransform()}>
                    <RotateCcw size={20} />
                  </button>
                  <button type='button' aria-label={label('zoomIn', 'Zoom in')} onClick={() => zoomIn()}>
                    <Plus size={20} />
                  </button>
                  {copyImageButton}
                  {(['svg', 'png'] as const).map((format) => (
                    <button
                      key={format}
                      type='button'
                      aria-label={`${label('download', 'Download')} ${format.toUpperCase()}`}
                      onClick={() => {
                        void downloadDiagram(svg, format).catch((error: Error) => notify.error(error.message));
                      }}
                    >
                      <Download size={20} />
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </>
            )}
          </TransformWrapper>
        )}
      </Dialog>
    </div>
  );
}
