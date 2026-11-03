import { useCallback, useEffect, useRef, useState } from 'react';

import { pdfProxyUrl } from './pdf-data';

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

type PDFState =
  | { status: 'loading' }
  | { status: 'password'; incorrect: boolean }
  | { status: 'error' }
  | { status: 'ready'; document: PDFDocumentProxy };

function isTransient(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  if ('status' in error && typeof error.status === 'number') return error.status >= 500 || error.status === 429;
  return 'name' in error && (error.name === 'TypeError' || error.name === 'UnknownErrorException');
}

/** Each source owns its worker and password callback. Nothing sensitive is persisted. */
export function usePDFDocument(url: string, active = true) {
  const [state, setState] = useState<PDFState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const acceptedPassword = useRef<{ url: string; password: string }>();
  const passwordCallback = useRef<((password: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finishDelay: (() => void) | undefined;

    setState({ status: 'loading' });
    passwordCallback.current = null;
    if (!active) return;
    void (async () => {
      const { openPDF } = await import('./pdf-engine');
      let source = url;

      // Match Flutter's bounded four-attempt load, without retrying invalid/password PDFs.
      for (let retry = 0; retry < 4 && !cancelled; retry++) {
        let candidate = acceptedPassword.current?.url === url ? acceptedPassword.current.password : undefined;

        task = openPDF(source, candidate);
        task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          if (cancelled) return;
          passwordCallback.current = (password) => {
            candidate = password;
            updatePassword(password);
          };

          setState({ status: 'password', incorrect: reason === 2 });
        };

        try {
          const document = await task.promise;

          if (!cancelled) {
            if (candidate !== undefined) acceptedPassword.current = { url, password: candidate };
            setState({ status: 'ready', document });
          }

          return;
        } catch (error) {
          if (cancelled) return;
          const proxy = source === url && pdfProxyUrl(url);

          // CORS/network failures cannot be fixed by repeatedly fetching the same
          // external URL in the browser. Try the public-file server once instead.
          if (proxy && retry < 3 && error && typeof error === 'object' && 'name' in error &&
            (error.name === 'TypeError' || error.name === 'UnknownErrorException')) {
            await task.destroy().catch(() => undefined);
            task = undefined;
            source = proxy;
            continue;
          }

          if (!isTransient(error) || retry === 3) throw error;
          await task.destroy().catch(() => undefined);
          task = undefined;
          if (cancelled) return;
          await new Promise<void>((resolve) => {
            finishDelay = resolve;
            timer = setTimeout(resolve, (retry + 1) * 3000);
          });
        }
      }
    })().catch(() => {
      if (!cancelled) setState({ status: 'error' });
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      finishDelay?.();
      passwordCallback.current = null;
      void task?.destroy().catch(() => undefined);
    };
  }, [url, active, attempt]);

  const unlock = useCallback((password: string) => {
    const callback = passwordCallback.current;

    if (!callback) return;
    passwordCallback.current = null;
    setState({ status: 'loading' });
    callback(password);
  }, []);

  return { state, unlock, retry: () => setAttempt((value) => value + 1) };
}
