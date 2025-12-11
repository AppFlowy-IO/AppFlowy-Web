import { forwardRef, memo } from 'react';

import { AIMeetingTranscriptionNode, EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

import { PlaceholderProvider, PlaceholderOverride } from '../text/PlaceholderContext';

// Static value - no placeholder for transcription as speaker blocks have their own rendering
const TRANSCRIPTION_PLACEHOLDER: PlaceholderOverride = {
  unselected: '',
  selected: '',
};

export const AIMeetingTranscription = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingTranscriptionNode>>(
    ({ node: _, children, ...attributes }, ref) => {
      return (
        <div
          ref={ref}
          {...attributes}
          className={cn(attributes.className, 'ai-meeting-transcription min-h-[120px]')}
        >
          <PlaceholderProvider value={TRANSCRIPTION_PLACEHOLDER}>
            {children}
          </PlaceholderProvider>
        </div>
      );
    }
  )
);

AIMeetingTranscription.displayName = 'AIMeetingTranscription';

export default AIMeetingTranscription;
