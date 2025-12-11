import { forwardRef, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AIMeetingNotesNode, EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

import { PlaceholderProvider, PlaceholderOverride } from '../text/PlaceholderContext';

export const AIMeetingNotes = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNotesNode>>(
    ({ node: _, children, ...attributes }, ref) => {
      const { t } = useTranslation();

      const placeholderValue = useMemo<PlaceholderOverride>(() => {
        const placeholder = t('aiMeeting.notesPlaceholder', 'Add your notes...');

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
          className={cn(attributes.className, 'ai-meeting-notes min-h-[120px]')}
        >
          <PlaceholderProvider value={placeholderValue}>
            {children}
          </PlaceholderProvider>
        </div>
      );
    }
  )
);

AIMeetingNotes.displayName = 'AIMeetingNotes';

export default AIMeetingNotes;
