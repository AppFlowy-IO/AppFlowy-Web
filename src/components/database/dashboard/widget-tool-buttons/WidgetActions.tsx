import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';

import { MobileWidgetTools } from '../mobile/MobileWidgetTools';
import { useWidgetContext } from '../WidgetContext';

import { WidgetTools } from './WidgetTools';

/**
 * The tools a widget's header (`WidgetHeader`) renders in place of the
 * database toolbar: `WidgetTools`, or on a phone the widget's Search and
 * Filter (`MobileWidgetTools`, WP14 §1.4.4). The dashboard decides the
 * mobile context of its widgets (tests inject it).
 */
export function WidgetActions() {
  const { mobileContext } = useWidgetContext();
  const viewportMobile = useMobileContext();

  return mobileContext ?? viewportMobile ? <MobileWidgetTools /> : <WidgetTools />;
}

export default WidgetActions;
