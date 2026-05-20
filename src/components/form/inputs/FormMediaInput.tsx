import { Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FormFileAttachment } from '@/application/types/form';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Files & Media respondent input.
 *
 * Selecting files only stores local `File` objects in the form state. The
 * actual upload-url mint + object-storage PUT happens from `FormBody` when
 * the respondent clicks Submit, immediately before the form POST.
 */

interface RejectedFile {
  local_id: string;
  name: string;
  size: number;
  error: string;
}

interface Props {
  value: FormFileAttachment[];
  onChange: (value: FormFileAttachment[]) => void;
  max_files?: number;
  max_bytes_per_file?: number;
}

export function FormMediaInput({ value, onChange, max_files, max_bytes_per_file }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const limitReached = typeof max_files === 'number' && value.length >= max_files;

  // Latest `value` exposed to handlers without putting it in their dep lists.
  // Keeping `handlePick` / `removeAttachment` referentially stable matters once
  // `AttachmentRow` (or other consumers) get wrapped in `React.memo` — a fresh
  // callback identity on every value change would silently defeat the memo.
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const handlePick = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const current = valueRef.current;
      const remaining = typeof max_files === 'number' ? Math.max(0, max_files - current.length) : files.length;
      const picked = Array.from(files).slice(0, remaining);
      const accepted: FormFileAttachment[] = [];
      const nextRejected: RejectedFile[] = [];

      for (const file of picked) {
        if (typeof max_bytes_per_file === 'number' && file.size > max_bytes_per_file) {
          nextRejected.push({
            local_id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            error: `Exceeds the ${formatBytes(max_bytes_per_file)} per-file limit.`,
          });
          continue;
        }

        accepted.push({
          local_id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          content_type: file.type || undefined,
          file,
        });
      }

      if (accepted.length > 0) {
        onChange([...current, ...accepted]);
      }

      if (nextRejected.length > 0) {
        setRejected((prev) => [...prev, ...nextRejected]);
      }
    },
    [max_bytes_per_file, max_files, onChange]
  );

  const removeAttachment = useCallback(
    (entry: FormFileAttachment) => {
      const key = attachmentKey(entry);

      onChange(valueRef.current.filter((item) => attachmentKey(item) !== key));
    },
    [onChange]
  );

  const dismissRejected = useCallback((local_id: string) => {
    setRejected((prev) => prev.filter((entry) => entry.local_id !== local_id));
  }, []);

  return (
    <div className='flex flex-col gap-2' data-testid='public-form-media-input'>
      <input
        ref={inputRef}
        type='file'
        multiple
        className='hidden'
        data-testid='public-form-media-file-input'
        onChange={(e) => {
          handlePick(e.target.files);
          e.target.value = '';
        }}
      />

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='gap-2'
          data-testid='public-form-media-upload-button'
          disabled={limitReached}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} />
          Upload
        </Button>
        <span className='text-xs text-text-caption'>{formatLimitsCaption(max_bytes_per_file, max_files)}</span>
      </div>

      {(value.length > 0 || rejected.length > 0) && (
        <ul className='flex flex-col gap-1' data-testid='public-form-media-attachments'>
          {value.map((entry) => (
            <AttachmentRow
              key={attachmentKey(entry)}
              name={entry.name}
              size={entry.size}
              status={entry.file_id ? 'uploaded' : 'selected'}
              onRemove={() => removeAttachment(entry)}
            />
          ))}
          {rejected.map((entry) => (
            <AttachmentRow
              key={entry.local_id}
              name={entry.name}
              size={entry.size}
              status='error'
              error={entry.error}
              onRemove={() => dismissRejected(entry.local_id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentRow({
  name,
  size,
  status,
  error,
  onRemove,
}: {
  name: string;
  size: number;
  status: 'selected' | 'uploaded' | 'error';
  error?: string;
  onRemove: () => void;
}) {
  return (
    <li
      data-testid='public-form-media-attachment'
      data-name={name}
      data-status={status}
      className={cn(
        'flex items-center justify-between gap-3 rounded border border-border-primary px-2 py-1 text-sm',
        status === 'error' && 'border-border-error-thick'
      )}
    >
      <div className='flex min-w-0 flex-col'>
        <span className='truncate'>{name}</span>
        <span className='text-xs text-text-caption'>
          {formatBytes(size)}
          {status === 'selected' && ' · Ready to upload'}
          {status === 'error' && error && ` · ${error}`}
        </span>
      </div>
      <button
        type='button'
        onClick={onRemove}
        className='text-text-tertiary hover:text-text-primary'
        aria-label='Remove attachment'
      >
        <X size={14} />
      </button>
    </li>
  );
}

function attachmentKey(entry: FormFileAttachment): string {
  return entry.file_id ?? entry.local_id ?? `${entry.name}:${entry.size}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLimitsCaption(max_bytes_per_file?: number, max_files?: number): string {
  const parts: string[] = [];

  if (typeof max_bytes_per_file === 'number') {
    parts.push(`Size limit: ${formatBytes(max_bytes_per_file)}.`);
  }

  if (typeof max_files === 'number') {
    parts.push(`File limit: ${max_files}.`);
  }

  return parts.join(' ');
}
