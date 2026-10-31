import { CalloutFrame } from '@/components/editor/components/blocks/callout/Callout';
import { getCalloutColors, getCalloutIcon } from '@/components/editor/components/blocks/callout/callout.utils';
import { CalloutSymbol } from '@/components/editor/components/blocks/callout/CalloutSymbol';
import '@/components/editor/editor.scss';

import SourceText from './SourceText';

import type { SourceBlock } from './types';
import type { ReactNode } from 'react';

export default function DocumentCallout({ block, children }: { block: SourceBlock; children: ReactNode }) {
  const data = block.callout ?? {};
  const icon = getCalloutIcon(data);
  const colors = getCalloutColors(data);

  return (
    <div className='block-element ps-native-callout' data-block-type='callout'>
      <CalloutFrame data={data} isEmpty={!block.text}>
        <span className='text-element relative flex w-full whitespace-pre-wrap break-words'>
          {icon && (
            <span
              className='ps-callout-symbol mr-2 flex h-7 w-7 shrink-0 items-center justify-center'
              aria-hidden='true'
            >
              <CalloutSymbol icon={icon} color={colors.icon} />
            </span>
          )}
          <span className='text-content leading-[1.5em]'>
            <SourceText block={block} />
          </span>
        </span>
        <div className='ps-callout-children'>{children}</div>
      </CalloutFrame>
    </div>
  );
}
