/**
 * Whether a button shows where keyboard focus is. The shared Button removes the browser outline, so
 * the ring comes from the button's own `focus-visible:ring-*` class or from a
 * `[&_button:focus-visible]:ring-*` rule on an element around it in the page. A dialog portaled to
 * the page body is outside the rules of the dialog that opened it.
 */
export function showsKeyboardFocus(button: Element): boolean {
  return hasFocusClass(button, 'ring-[1-9]');
}

/**
 * Whether that ring is set off from the button by a gap. The ring uses the theme color, so on a
 * filled theme button without a gap it only looks like the button grew.
 */
export function focusRingStandsApart(button: Element): boolean {
  return hasFocusClass(button, 'ring-offset-[1-9]');
}

function hasFocusClass(button: Element, utility: string): boolean {
  if (new RegExp(`(^|\\s)focus-visible:${utility}`).test(button.getAttribute('class') ?? '')) return true;
  for (let node = button.parentElement; node; node = node.parentElement) {
    if (new RegExp(`\\[&_button:focus-visible\\]:${utility}`).test(node.getAttribute('class') ?? '')) return true;
  }

  return false;
}
