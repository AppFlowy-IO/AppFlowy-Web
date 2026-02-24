import { forwardRef, memo } from 'react';

import { BlockType } from '@/application/types';
import {
  AIMeetingNotesNode,
  AIMeetingSummaryNode,
  AIMeetingTranscriptionNode,
  EditorElementProps,
} from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

type AIMeetingSectionNode = AIMeetingSummaryNode | AIMeetingNotesNode | AIMeetingTranscriptionNode;

const getSectionClassName = (type: BlockType) => {
  switch (type) {
    case BlockType.AIMeetingSummaryBlock:
      return 'ai-meeting-section ai-meeting-section-summary';
    case BlockType.AIMeetingNotesBlock:
      return 'ai-meeting-section ai-meeting-section-notes';
    case BlockType.AIMeetingTranscriptionBlock:
      return 'ai-meeting-section ai-meeting-section-transcription';
    default:
      return 'ai-meeting-section';
  }
};

export const AIMeetingSection = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingSectionNode>>(({ node, children, className, ...attributes }, ref) => {
    return (
      <div
        ref={ref}
        {...attributes}
        className={cn(getSectionClassName(node.type as BlockType), className)}
      >
        {children}
      </div>
    );
  })
);

AIMeetingSection.displayName = 'AIMeetingSection';
