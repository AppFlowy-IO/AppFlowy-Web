import { RefObject, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { GoogleDriveBlockData } from '@/application/types';

import { driveSize } from './drive-data';

const labels = {
  left: 'document.plugins.googleDrive.resizeLeft',
  right: 'document.plugins.googleDrive.resizeRight',
  top: 'document.plugins.googleDrive.resizeTop',
  bottom: 'document.plugins.googleDrive.resizeBottom',
} as const;

type Size = ReturnType<typeof driveSize>;
export function DriveResizeHandles({
  container,
  data,
  onDraft,
  onCommit,
}: {
  container: RefObject<HTMLDivElement>;
  data: GoogleDriveBlockData;
  onDraft: (value?: Size) => void;
  onCommit: (value: Size) => void;
}) {
  const { t } = useTranslation();
  const cleanup = useRef<() => void>();

  // A remote replacement/resize must cancel the gesture captured for the old
  // source or dimensions, just as unmounting releases its pointer listeners.
  useEffect(
    () => () => cleanup.current?.(),
    [data.url, data.file_id, data.email, data.align, data.width_factor, data.height_factor]
  );
  return (
    <>
      {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
        <button
          key={side}
          type='button'
          className={`drive-resize drive-resize-${side}`}
          aria-label={t(labels[side])}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cleanup.current?.();
            const width = container.current?.clientWidth;

            if (!width) return;
            const initial = driveSize(data);
            const { clientX, clientY, pointerId } = event;
            const handle = event.currentTarget;
            let next = initial;
            const horizontal = side === 'left' || side === 'right';

            // Cross-origin iframes can swallow moves despite pointer capture.
            // Mark the gesture before the first move so the preview yields input.
            onDraft(initial);
            handle.setPointerCapture(pointerId);
            const move = (move: PointerEvent) => {
              const delta = horizontal
                ? ((move.clientX - clientX) / width) * (data.align === 'center' ? 2 : 1)
                : (move.clientY - clientY) / 400;
              const factor = side === 'left' || side === 'top' ? -1 : 1;

              next = horizontal
                ? {
                    ...initial,
                    width_factor: Math.min(1, Math.max(Math.min(120 / width, 1), initial.width_factor + delta * factor)),
                  }
                : { ...initial, height_factor: Math.min(3, Math.max(0.3, initial.height_factor + delta * factor)) };
              onDraft(next);
            };

            const dispose = () => {
              handle.removeEventListener('pointermove', move);
              handle.removeEventListener('pointerup', commit);
              handle.removeEventListener('pointercancel', cancel);
              handle.removeEventListener('lostpointercapture', cancel);
              if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
              cleanup.current = undefined;
            };

            const commit = () => {
              dispose();
              onDraft(undefined);
              onCommit(next);
            };

            const cancel = () => {
              dispose();
              onDraft(undefined);
            };

            cleanup.current = cancel;
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', commit);
            handle.addEventListener('pointercancel', cancel);
            handle.addEventListener('lostpointercapture', cancel);
          }}
          onKeyDown={(event) => {
            const horizontal = side === 'left' || side === 'right';

            if (!(horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']).includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const size = driveSize(data);
            const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            const factor = side === 'left' || side === 'top' ? -1 : 1;
            const minimum = Math.min(120 / (container.current?.clientWidth || 120), 1);

            onCommit(
              horizontal
                ? { ...size, width_factor: Math.min(1, Math.max(minimum, size.width_factor + direction * factor * 0.05)) }
                : { ...size, height_factor: Math.min(3, Math.max(0.3, size.height_factor + direction * factor * 0.05)) }
            );
          }}
        />
      ))}
    </>
  );
}
