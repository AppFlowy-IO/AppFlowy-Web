import { forwardRef, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AIMeetingSummaryNode, EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

import { PlaceholderProvider, PlaceholderOverride } from '../text/PlaceholderContext';

export const AIMeetingSummary = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingSummaryNode>>(
    ({ node: _, children, ...attributes }, ref) => {
      const { t } = useTranslation();

      const placeholderValue = useMemo<PlaceholderOverride>(() => {
        const placeholder = t('aiMeeting.summaryPlaceholder', 'AI-generated summary will appear here...');

        return {
          unselected: placeholder,
          selected: placeholder,
          onlyFirstChild: true,
        };
      }, [t]);

      return (
        <div
          ref={ref}
          {...attributes}
          className={cn(attributes.className, 'ai-meeting-summary min-h-[120px]')}
        >
          <PlaceholderProvider value={placeholderValue}>
            {children}
          </PlaceholderProvider>
        </div>
      );
    }
  )
);

AIMeetingSummary.displayName = 'AIMeetingSummary';

export default AIMeetingSummary;
