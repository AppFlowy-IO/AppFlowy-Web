import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function ImageResizeHandle({
  side,
  savedWidth,
  width,
  ratio,
  maxWidth,
  onWidthChange,
  onCommit,
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  savedWidth?: number;
  width: number;
  ratio: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const { t } = useTranslation();
  const cleanup = useRef<() => void>();

  // Cancel a drag when persisted dimensions change, without remounting the
  // handle and dropping keyboard focus after each of our own resize commits.
  useEffect(() => () => cleanup.current?.(), [savedWidth]);
  return (
    <div
      role='separator'
      aria-label={t(`web.imageBlock.resize.${side}`)}
      aria-valuemin={Math.min(120, maxWidth)}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-orientation={side === 'left' || side === 'right' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      className={`image-resize image-resize-${side}`}
      onKeyDown={(event) => {
        const horizontal = side === 'left' || side === 'right';

        if (!(horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']).includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const next = Math.max(
          Math.min(120, maxWidth),
          Math.min(
            maxWidth,
            width +
              (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -10 : 10) * (side === 'left' || side === 'top' ? -1 : 1)
          )
        );

        onWidthChange(next);
        onCommit(next);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        cleanup.current?.();
        const start = side === 'left' || side === 'right' ? event.clientX : event.clientY;
        let latest = width;
        const move = (move: PointerEvent) => {
          const position = side === 'left' || side === 'right' ? move.clientX : move.clientY;
          const direction = side === 'left' || side === 'top' ? -1 : 1;
          const delta = (position - start) * direction * (side === 'top' || side === 'bottom' ? ratio : 1);

          latest = Math.max(Math.min(120, maxWidth), Math.min(maxWidth, width + delta));
          onWidthChange(latest);
        };

        const end = () => {
          cleanup.current?.();
          onCommit(latest);
        };

        const cancel = () => {
          cleanup.current?.();
          onWidthChange(width);
        };

        cleanup.current = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('blur', cancel);
          cleanup.current = undefined;
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
      }}
    >
      <span />
    </div>
  );
}
