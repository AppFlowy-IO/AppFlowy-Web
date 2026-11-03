import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export function usePresentationFullscreen(target: RefObject<HTMLElement>) {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const changing = useRef(false);
  const ownedElement = useRef<HTMLElement | null>(null);
  const isActive = useCallback(() => !!target.current && document.fullscreenElement === target.current, [target]);

  const toggle = useCallback(async () => {
    const element = target.current;

    if (!element || changing.current) return;
    setError('');
    if (!element.requestFullscreen || !document.fullscreenEnabled) {
      setError('Fullscreen is unavailable here. Open AppFlowy in a browser tab with fullscreen allowed.');
      return;
    }

    changing.current = true;
    setPending(true);
    const exiting = isActive();

    try {
      if (exiting) {
        await document.exitFullscreen();
      } else {
        ownedElement.current = element;
        // Keep this call in the click handler so the browser retains user activation.
        await element.requestFullscreen({ navigationUI: 'hide' });
      }

      setActive(isActive());
    } catch {
      setError(
        `Couldn’t ${exiting ? 'exit' : 'enter'} fullscreen. Check your browser’s fullscreen permission and try again.`
      );
    } finally {
      changing.current = false;
      setPending(false);
    }
  }, [target, isActive]);

  useEffect(() => {
    const sync = () => setActive(isActive());
    const key = (event: KeyboardEvent) => {
      // Fullscreen can move focus outside the dialog. Handle Escape at the document
      // so it leaves fullscreen even when the dialog's own key handler cannot run.
      if (
        event.key === 'Escape' &&
        isActive() &&
        !(event.target instanceof Element && event.target.closest('[data-presentation-escape-layer]'))
      ) {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }
    };

    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('keydown', key, true);
      if (ownedElement.current && document.fullscreenElement === ownedElement.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [isActive, toggle]);

  return { active, pending, error, toggle, isActive };
}
