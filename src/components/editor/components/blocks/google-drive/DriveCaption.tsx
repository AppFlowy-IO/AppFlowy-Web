import TextareaAutosize from '@mui/material/TextareaAutosize';
import { forwardRef, useEffect, useState } from 'react';

export const DriveCaption = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    readOnly: boolean;
    label: string;
    placeholder: string;
    onChange: (value: string) => void;
  }
>(({ value, readOnly, label, placeholder, onChange }, ref) => {
  // Slate publishes node changes after the input event. Keep the draft in
  // sync immediately so React doesn't restore the previous text and caret.
  const [draft, setDraft] = useState(value);

  // Also reflect undo/redo and changes received from other collaborators.
  useEffect(() => setDraft(value), [value]);

  return (
    <TextareaAutosize
      ref={ref}
      contentEditable={false}
      readOnly={readOnly}
      className='drive-caption'
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;

        setDraft(next);
        onChange(next);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onCompositionStart={(event) => event.stopPropagation()}
      onCompositionEnd={(event) => event.stopPropagation()}
    />
  );
});

DriveCaption.displayName = 'DriveCaption';
