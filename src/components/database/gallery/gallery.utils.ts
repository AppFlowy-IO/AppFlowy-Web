const GALLERY_INTERACTIVE_TARGET_SELECTOR =
  '.custom-icon, a, button, input, label, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [data-gallery-interactive="true"]';

export function isGalleryInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(GALLERY_INTERACTIVE_TARGET_SELECTOR));
}
