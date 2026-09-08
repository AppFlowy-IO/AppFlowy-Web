import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

import { useDatabaseContext } from '@/application/database-yjs';
import { CommentAttachment } from '@/application/row-comment.type';
import { MentionablePerson } from '@/application/types';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as AtIcon } from '@/assets/icons/at.svg';
import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { cn } from '@/lib/utils';

import { DraftMention, serializeCommentMentions, updateDraftMentions } from './comment-mentions';

interface CommentComposerProps {
  onSubmit: (content: string, attachments: CommentAttachment[]) => string | undefined;
  placeholder: string;
  members?: MentionablePerson[];
  testIds: { collapsed: string; input: string; submit: string; attachment: string };
  onCancel?: () => void;
}

/** Shared by Feed cards and row detail so drafts, attachments and IME behave alike. */
export function CommentComposer({ onSubmit, placeholder, members = [], testIds, onCancel }: CommentComposerProps) {
  const { t } = useTranslation();
  const { uploadFile } = useDatabaseContext();
  const [content, setContent] = useState('');
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [mentions, setMentions] = useState<DraftMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; end: number; text: string } | null>(null);
  const [selectedMember, setSelectedMember] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const caretAfterRender = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftGeneration = useRef(0);
  const uploadingRef = useRef(false);
  const collapsed = !focused && !content && attachments.length === 0 && !uploading;
  const canSend = !uploading && (content.trim().length > 0 || attachments.length > 0);
  const suggestions = mentionQuery
    ? members
        .filter(
          (member) =>
            member.person_id &&
            `${member.name} ${member.email}`.toLocaleLowerCase().includes(mentionQuery.text.toLocaleLowerCase())
        )
        .slice(0, 8)
    : [];

  useEffect(
    () => () => {
      draftGeneration.current++;
    },
    []
  );
  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);
  useLayoutEffect(() => {
    if (caretAfterRender.current === null) return;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
    caretAfterRender.current = null;
  }, [content]);

  const reset = () => {
    draftGeneration.current++;
    setContent('');
    setAttachments([]);
    setMentions([]);
    setMentionQuery(null);
    setUploadError(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const submit = () => {
    if (!canSend || uploadingRef.current) return;
    const id = onSubmit(serializeCommentMentions(content, mentions).trim(), attachments);

    if (id) reset();
  };

  const changeContent = (next: string, caret: number) => {
    setMentions((current) => updateDraftMentions(content, next, current));
    setContent(next);
    const match = /(?:^|\s)@([^@\n]*)$/.exec(next.slice(0, caret));

    setMentionQuery(match ? { start: caret - match[1].length - 1, end: caret, text: match[1] } : null);
    setSelectedMember(0);
  };

  const selectMention = (member: MentionablePerson) => {
    if (!mentionQuery) return;
    const { start, end } = mentionQuery;
    const name = (member.name || member.email).replace(/[\]\n]/g, ' ');
    const label = `@${name}`;
    const next = `${content.slice(0, start)}${label} ${content.slice(end)}`;

    // Restore the caret with the committed value before the next keystroke.
    caretAfterRender.current = start + label.length + 1;
    setMentions([
      ...updateDraftMentions(content, next, mentions),
      { start, end: start + label.length, name, personId: member.person_id },
    ]);
    setContent(next);
    setMentionQuery(null);
  };

  const attachFiles = async (files: File[]) => {
    if (!uploadFile || files.length === 0 || uploadingRef.current) return;
    const generation = draftGeneration.current;

    uploadingRef.current = true;
    setUploading(true);
    setUploadError(false);
    const results = await Promise.allSettled(
      files.map(async (file): Promise<CommentAttachment> => {
        const url = await uploadFile(file);

        if (!url) throw new Error('Upload returned no URL');
        return {
          id: uuidv4(),
          name: file.name,
          url,
          file_type: file.type || 'application/octet-stream',
          size: file.size,
          uploaded_at: Date.now(),
        };
      })
    );

    uploadingRef.current = false;
    if (generation !== draftGeneration.current) return;
    setAttachments((current) => [
      ...current,
      ...results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    ]);
    setUploadError(results.some((result) => result.status === 'rejected'));
    setUploading(false);
  };

  return (
    <div
      className='min-w-0 flex-1'
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !content &&
          !attachments.length &&
          !uploadingRef.current
        )
          setFocused(false);
      }}
    >
      {collapsed ? (
        <button
          type='button'
          className='h-8 w-full cursor-text rounded-lg border border-border-primary px-3 text-left text-sm text-text-tertiary'
          data-testid={testIds.collapsed}
          onClick={() => setFocused(true)}
        >
          {placeholder}
        </button>
      ) : (
        <div className='relative flex flex-col gap-1 rounded-lg border border-border-primary px-3 py-1.5 focus-within:border-border-theme-thick'>
          <TextareaAutosize
            ref={inputRef}
            autoFocus
            variant='ghost'
            minRows={1}
            maxRows={6}
            className='w-full bg-transparent'
            placeholder={placeholder}
            data-testid={testIds.input}
            value={content}
            onFocus={() => setFocused(true)}
            onChange={(event) => changeContent(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setSelectedMember(
                  (current) => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length
                );
                return;
              }

              if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                event.preventDefault();
                if (suggestions.length) selectMention(suggestions[selectedMember] ?? suggestions[0]);
                else submit();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                event.nativeEvent.stopImmediatePropagation();
                if (mentionQuery) setMentionQuery(null);
                else if (!uploadingRef.current) {
                  reset();
                  onCancel?.();
                }
              }
            }}
          />
          {suggestions.length > 0 && (
            <div
              role='listbox'
              aria-label={t('rowComment.mention')}
              className='max-h-48 overflow-y-auto rounded border border-border-primary bg-background-primary p-1'
            >
              {suggestions.map((member, index) => (
                <button
                  key={member.person_id}
                  type='button'
                  role='option'
                  aria-selected={index === selectedMember}
                  className={cn(
                    'block w-full truncate rounded px-2 py-1 text-left text-sm',
                    index === selectedMember && 'bg-fill-content-hover'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(member)}
                >
                  {member.name || member.email}
                </button>
              ))}
            </div>
          )}
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className='flex items-center gap-1 text-sm'
              data-testid='comment-pending-attachment'
            >
              <AttachmentIcon className='h-4 w-4 shrink-0' />
              <span className='truncate'>{attachment.name}</span>
              <button
                type='button'
                aria-label={`${t('button.remove')} ${attachment.name}`}
                className='ml-auto p-1'
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                <CloseIcon className='h-3 w-3' />
              </button>
            </div>
          ))}
          {uploadError && (
            <span role='alert' className='text-sm text-text-error'>
              {t('grid.media.uploadError')}
            </span>
          )}
          <div className='flex items-center gap-1'>
            <input
              ref={fileRef}
              type='file'
              multiple
              hidden
              data-testid={testIds.attachment}
              onChange={(event) => {
                void attachFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <button
              type='button'
              aria-label={t('rowComment.attachFile')}
              title={t('rowComment.attachFile')}
              disabled={!uploadFile || uploading}
              onClick={() => fileRef.current?.click()}
              className='rounded p-1 text-text-tertiary disabled:opacity-40'
            >
              <AttachmentIcon className='h-5 w-5' />
            </button>
            <button
              type='button'
              aria-label={t('rowComment.mention')}
              title={t('rowComment.mention')}
              className='rounded p-1 text-text-tertiary'
              onClick={() => {
                const caret = inputRef.current?.selectionStart ?? content.length;

                caretAfterRender.current = caret + 1;
                changeContent(`${content.slice(0, caret)}@${content.slice(caret)}`, caret + 1);
              }}
            >
              <AtIcon className='h-5 w-5' />
            </button>
            {uploading && (
              <span role='status' className='text-xs text-text-tertiary'>
                {t('fileDropzone.uploading')}
              </span>
            )}
            {onCancel && (
              <button
                type='button'
                disabled={uploading}
                onClick={() => {
                  reset();
                  onCancel();
                }}
                className='ml-auto text-sm'
              >
                {t('button.cancel')}
              </button>
            )}
            <button
              type='button'
              aria-label={t('rowComment.reply')}
              disabled={!canSend}
              data-testid={testIds.submit}
              onClick={submit}
              className={cn(
                'ml-auto flex h-7 w-7 items-center justify-center rounded-full',
                canSend ? 'bg-fill-theme-thick text-text-on-fill' : 'bg-fill-content-hover text-text-tertiary'
              )}
            >
              <ArrowUpIcon aria-hidden='true' className='h-4 w-4' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
