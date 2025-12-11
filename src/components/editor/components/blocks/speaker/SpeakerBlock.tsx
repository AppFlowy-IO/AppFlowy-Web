import {
  forwardRef,
  memo,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { EditorElementProps, SpeakerNode } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

import {
  findParentAIMeetingNode,
  getSpeakerDisplayName,
  updateSpeakerName,
} from '../ai-meeting/utils';

// Speaker color palette for different speakers
const SPEAKER_COLORS = [
  'bg-purple-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-rose-500',
];

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getSpeakerColor(speakerId?: string): string {
  if (!speakerId) return SPEAKER_COLORS[0];

  // Generate a consistent color based on speaker ID
  const index = speakerId.charCodeAt(0) % SPEAKER_COLORS.length;

  return SPEAKER_COLORS[index];
}

export const SpeakerBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<SpeakerNode>>(({ node, children, ...attributes }, ref) => {
    const editor = useSlateStatic();
    const readOnly = useReadOnly();
    const { data } = node;
    const speakerId = data?.speaker_id || 'A';
    const timestamp = data?.timestamp ?? 0;

    // Find parent AI Meeting node for speaker name resolution
    const parentMeeting = useMemo(
      () => findParentAIMeetingNode(editor, node),
      [editor, node]
    );

    // Get speaker name from parent's speaker_name_map or fallback
    const speakerName = useMemo(
      () => getSpeakerDisplayName(parentMeeting, speakerId),
      [parentMeeting, speakerId]
    );

    const speakerColor = useMemo(() => getSpeakerColor(speakerId), [speakerId]);

    // Edit mode state
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(speakerName);
    const inputRef = useRef<HTMLInputElement>(null);

    // Update editValue when speakerName changes externally
    useEffect(() => {
      if (!isEditing) {
        setEditValue(speakerName);
      }
    }, [speakerName, isEditing]);

    // Focus input when entering edit mode
    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    const handleStartEditing = useCallback(() => {
      if (readOnly || !parentMeeting) return;
      setIsEditing(true);
      setEditValue(speakerName);
    }, [readOnly, parentMeeting, speakerName]);

  const handleSave = useCallback(() => {
    const trimmedValue = editValue.trim();

    if (trimmedValue && trimmedValue !== speakerName && parentMeeting) {
      updateSpeakerName(editor, parentMeeting, speakerId, trimmedValue);
    } else {
      // Revert to original if empty
      setEditValue(speakerName);
    }

    setIsEditing(false);
  }, [editValue, speakerName, parentMeeting, editor, speakerId]);

    const handleCancel = useCallback(() => {
      setEditValue(speakerName);
      setIsEditing(false);
    }, [speakerName]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      },
      [handleSave, handleCancel]
    );

    const canEdit = !readOnly && !!parentMeeting;

    return (
      <div
        ref={ref}
        {...attributes}
        className={cn(attributes.className, 'speaker-block py-2')}
      >
        <div className="flex items-center gap-2 mb-1" contentEditable={false}>
          {/* Speaker badge - editable */}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium text-white outline-none border-2 border-white',
                speakerColor
              )}
              style={{ minWidth: '80px', maxWidth: '200px' }}
            />
          ) : (
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white',
                speakerColor,
                canEdit && 'cursor-pointer hover:opacity-80 transition-opacity'
              )}
              onClick={handleStartEditing}
              title={canEdit ? 'Click to edit speaker name' : undefined}
            >
              {speakerName}
            </span>
          )}

          {/* Timestamp badge */}
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs text-text-secondary bg-fill-list-hover">
            {formatTimestamp(timestamp)}
          </span>
        </div>

        {/* Transcript text content */}
        <div className="pl-0.5">
          {children}
        </div>
      </div>
    );
  })
);

SpeakerBlock.displayName = 'SpeakerBlock';

export default SpeakerBlock;
