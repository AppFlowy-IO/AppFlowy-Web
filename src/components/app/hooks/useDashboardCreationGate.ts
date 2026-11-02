import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';

export interface DashboardCreationGate {
  /**
   * Whether a Dashboard view can be created here at all: the page is not a
   * mobile context (dashboards are view-only there, so none
   * is created). When `false` the entry point hides its Dashboard option.
   */
  available: boolean;
}

/**
 * Where a Dashboard view can be offered, in one place for every entry point:
 * the tab bar's "+" menu, the layout switcher and the slash menu. The
 * workspace plan is checked like Timeline's, by `useDatabaseViewCreation`
 * (the server applies the Timeline Pro policy to Dashboard views), so an
 * offered option shows the same Pro crown and upgrade action.
 */
export function useDashboardCreationGate(): DashboardCreationGate {
  return { available: !useMobileContext() };
}
