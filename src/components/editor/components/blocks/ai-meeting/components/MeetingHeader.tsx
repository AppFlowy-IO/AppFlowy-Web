import { KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';

interface MeetingHeaderProps {
  title?: string;
  date?: string;
  onTitleChange?: (newTitle: string) => void;
  readOnly?: boolean;
}

export const MeetingHeader = memo(({ title, date, onTitleChange, readOnly }: MeetingHeaderProps) => {
  const displayTitle = title?.trim() || 'AI Meeting';
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedDate = date
    ? new Date(date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  // Update editValue when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(displayTitle);
    }
  }, [displayTitle, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEditing = useCallback(() => {
    if (readOnly || !onTitleChange) return;
    setIsEditing(true);
    setEditValue(displayTitle);
  }, [readOnly, onTitleChange, displayTitle]);

  const handleSave = useCallback(() => {
    const trimmedValue = editValue.trim();

    if (trimmedValue && trimmedValue !== displayTitle) {
      onTitleChange?.(trimmedValue);
    } else {
      // Revert to original if empty
      setEditValue(displayTitle);
    }

    setIsEditing(false);
  }, [editValue, displayTitle, onTitleChange]);

  const handleCancel = useCallback(() => {
    setEditValue(displayTitle);
    setIsEditing(false);
  }, [displayTitle]);

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

  const canEdit = !readOnly && !!onTitleChange;

  return (
    <div className="ai-meeting-header px-4 py-4 border-b border-line-divider" contentEditable={false}>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="w-full text-2xl font-semibold text-text-primary bg-transparent border-b-2 border-fill-theme-thick outline-none"
          placeholder="AI Meeting"
        />
      ) : (
        <h2
          className={`text-2xl font-semibold text-text-primary ${canEdit ? 'cursor-text hover:bg-fill-list-hover rounded px-1 -mx-1 transition-colors' : ''}`}
          onClick={handleStartEditing}
        >
          {displayTitle}
        </h2>
      )}
      {formattedDate && (
        <p className="text-sm text-text-secondary mt-1">{formattedDate}</p>
      )}
    </div>
  );
});

MeetingHeader.displayName = 'MeetingHeader';
