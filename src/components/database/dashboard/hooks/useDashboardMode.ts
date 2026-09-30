import { useDashboardContext } from '../DashboardContext';

/**
 * The dashboard's Edit mode (R-MODE) without the layout writers: whether it is
 * editing, whether Edit mode can be offered (write access outside a mobile
 * context), and the actions that change the preference.
 */
export function useDashboardMode() {
  const { isEditing, canEnterEdit, mobileContext, editPreference, setEditing, pinEditing } = useDashboardContext();

  return { isEditing, canEnterEdit, mobileContext, editPreference, setEditing, pinEditing };
}
