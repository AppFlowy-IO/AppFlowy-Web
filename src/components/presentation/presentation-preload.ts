import type { Mode } from './types';

// The lazy() components use these loaders, so a preload and the later render share one module request.
export const loadPresentationDialog = () => import('./PresentationDialog');
export const loadPresentationStudio = () => import('./PresentationStudio');
export const loadDocumentPresenter = () => import('./DocumentPresenter');

/** Starts the dialog chunk and, once the mode is known, that mode's chunk alongside it rather than after it. */
export function preloadPresentation(mode?: Mode) {
  const loads: Promise<unknown>[] = [loadPresentationDialog()];

  if (mode) loads.push(mode === 'document' ? loadDocumentPresenter() : loadPresentationStudio());
  // The lazy() render that needs a chunk reports its failure.
  loads.forEach((load) => load.catch(() => undefined));
}
