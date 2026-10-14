/**
 * Whether a button shows where keyboard focus is. The shared Button removes the browser outline, so
 * the ring comes from the button's own `focus-visible:ring-*` class or from a
 * `[&_button:focus-visible]:ring-*` rule on an element around it in the page. A dialog portaled to
 * the page body is outside the rules of the dialog that opened it.
 */
export function showsKeyboardFocus(button: Element): boolean {
  if (/(^|\s)focus-visible:ring-[1-9]/.test(button.getAttribute('class') ?? '')) return true;
  for (let node = button.parentElement; node; node = node.parentElement) {
    if (/\[&_button:focus-visible\]:ring-[1-9]/.test(node.getAttribute('class') ?? '')) return true;
  }

  return false;
}
