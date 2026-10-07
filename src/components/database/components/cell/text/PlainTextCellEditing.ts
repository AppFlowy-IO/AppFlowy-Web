import { createContext, useContext } from 'react';

/**
 * Makes Text cells below edit as plain text (they still display formatting).
 *
 * For hosts that cannot carry the rich editor's overlays: a modal Radix
 * popover (the calendar event popover) blocks pointer events and focus
 * outside itself, so the mention panel and link editor, which render in
 * their own portals, could not be used there.
 */
export const PlainTextCellEditing = createContext(false);

export function usePlainTextCellEditing() {
  return useContext(PlainTextCellEditing);
}
