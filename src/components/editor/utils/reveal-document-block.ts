const highlights = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Jump in the mounted document even when the route already has the same blockId. */
export function revealDocumentBlock(viewId: string, blockId: string): boolean {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-document-id]')).find(
    (element) =>
      element.dataset.documentId === viewId && element.dataset.blockId === blockId && element.getClientRects().length > 0
  );

  if (!element) return false;
  // Presentation dialogs restore focus on closing. Scroll after that restoration.
  requestAnimationFrame(() => {
    if (!element.isConnected) return;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.classList.add('highlight-block');
    clearTimeout(highlights.get(element));
    highlights.set(
      element,
      setTimeout(() => {
        element.classList.remove('highlight-block');
        highlights.delete(element);
      }, 5000)
    );
  });
  return true;
}
