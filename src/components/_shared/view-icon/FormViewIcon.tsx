import type { SVGProps } from 'react';

import { ReactComponent as DesktopFormIcon } from '@/assets/icons/form/form-builder.svg';
import { cn } from '@/lib/utils';

/** Desktop's form_builder.svg, with its original geometry and themed stroke. */
export default function FormViewIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <DesktopFormIcon {...props} className={cn('[&_path]:stroke-current', className)} />;
}
