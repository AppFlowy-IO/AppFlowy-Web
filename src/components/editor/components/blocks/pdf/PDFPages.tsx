import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import './pdf-text-layer.css';

type Link = { href: string; left: number; top: number; width: number; height: number };

function PDFPage({ document, number, width }: { document: PDFDocumentProxy; number: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(width * 1.414);
  const [links, setLinks] = useState<Link[]>([]);
  const [failed, setFailed] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    // Each render owns its canvas, so a cancelled render cannot race a new one.
    const canvas = window.document.createElement('canvas');
    const host = canvasRef.current;
    const textHost = textRef.current;

    setFailed(false);
    setLinks([]);
    void document
      .getPage(number)
      .then(async (page) => {
        if (cancelled || !host || !textHost) return;
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const scale = Math.min(window.devicePixelRatio || 1, 2);

        setHeight(viewport.height);
        canvas.width = Math.floor(viewport.width * scale);
        canvas.height = Math.floor(viewport.height * scale);
        render = page.render({ canvas, viewport, transform: [scale, 0, 0, scale, 0, 0] });
        const [annotations, { TextLayer }] = await Promise.all([
          page.getAnnotations(),
          import('./pdf-engine'),
          render.promise,
        ]);

        if (cancelled) return;
        host.width = canvas.width;
        host.height = canvas.height;
        host.getContext('2d')?.drawImage(canvas, 0, 0);
        setLinks(
          annotations.flatMap((annotation) => {
            if (typeof annotation.url !== 'string' || !/^(https?:|mailto:)/i.test(annotation.url)) return [];
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);

            return [
              {
                href: annotation.url,
                left: Math.min(x1, x2),
                top: Math.min(y1, y2),
                width: Math.abs(x2 - x1),
                height: Math.abs(y2 - y1),
              },
            ];
          })
        );
        textHost.replaceChildren();
        textHost.style.setProperty('--scale-factor', String(viewport.scale));
        textHost.style.setProperty('--total-scale-factor', String(viewport.scale));
        textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textHost, viewport });
        await textLayer.render();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
      canvas.width = canvas.height = 0;
    };
  }, [document, number, width]);

  return (
    <div className='pdf-page relative bg-white' style={{ width, height }} data-page-number={number}>
      <canvas ref={canvasRef} style={{ width, height }} aria-label={t('document.plugins.pdf.pageNumber', { number })} />
      <div ref={textRef} className='textLayer' />
      {links.map((link, index) => (
        <a
          key={index}
          href={link.href}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={link.href}
          className='absolute z-[3] hover:bg-blue-200/20'
          style={{ left: link.left, top: link.top, width: link.width, height: link.height }}
        />
      ))}
      {failed && (
        <div role='alert' className='absolute inset-0 flex items-center justify-center text-text-secondary'>
          {t('document.plugins.pdf.loadError')}
        </div>
      )}
    </div>
  );
}

export function PDFPages({ document, zoom = 1 }: { document: PDFDocumentProxy; zoom?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const width = Math.max(120, containerWidth * zoom);
  const virtualizer = useVirtualizer({
    count: document.numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => width * 1.414,
    overscan: 1,
  });

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));

    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    virtualizer.measure();
  }, [width, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className='pdf-pages h-full w-full overflow-auto overscroll-contain'
      data-testid='pdf-pages'
      tabIndex={0}
    >
      <div className='relative mx-auto' style={{ height: virtualizer.getTotalSize(), width }}>
        {containerWidth > 0 &&
          virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className='absolute left-0 top-0'
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <PDFPage document={document} number={item.index + 1} width={width} />
            </div>
          ))}
      </div>
    </div>
  );
}
