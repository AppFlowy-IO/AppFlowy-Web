import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as FileIcon } from '@/assets/icons/file.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { Textarea } from '@/components/chat/components/ui/textarea';
import {
  fileNameFromAttachmentUrl,
  formatQuestionWithAttachments,
  parseAttachmentMarkers,
} from '@/components/chat/lib/attachments';
import { stringToColor } from '@/components/chat/lib/utils';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { User } from '@/components/chat/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openFileUrl } from '@/utils/download';

import { GeneratedImage } from './generated-image';

function HumanQuestion({
  id,
  content,
  userId,
  fetchMember,
}: {
  id: number;
  content: string;
  userId: string;
  fetchMember: (uuid: string) => Promise<User>;
}) {
  const { t } = useTranslation();
  const { currentUser } = useChatContext();
  const { editQuestion, editingQuestionId, setEditingQuestionId, answerApplying, questionSending } =
    useMessagesHandlerContext();
  const [member, setMember] = useState<User | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(() => parseAttachmentMarkers(content), [content]);
  const isOwn = !!currentUser?.uuid && currentUser.uuid === userId;
  // Only the author edits a question, whatever asked for the editor.
  const editing = isOwn && editingQuestionId === id;

  useEffect(() => {
    void (async () => {
      try {
        const member = await fetchMember(userId);

        setMember(member);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [fetchMember, userId]);

  useEffect(() => {
    if (!editing) return;
    setDraft(parsed.text);
    const timer = window.setTimeout(() => {
      const textarea = textareaRef.current;

      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [editing, parsed.text]);

  const cancelEdit = useCallback(() => {
    setEditingQuestionId(null);
  }, [setEditingQuestionId]);

  const submitEdit = useCallback(async () => {
    const text = draft.trim();

    if (!text && parsed.images.length === 0 && parsed.files.length === 0) return;

    setSaving(true);
    try {
      const attachments = [
        ...parsed.images.map((url) => ({ kind: 'image' as const, url })),
        ...parsed.files.map((url) => ({ kind: 'file' as const, url })),
      ];

      await editQuestion(id, formatQuestionWithAttachments(text, attachments));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [draft, editQuestion, id, parsed.files, parsed.images]);

  const name = member?.name || 'Anonymous';
  const canEdit = isOwn && !answerApplying && !questionSending;

  return (
    <div className={`group/question flex w-full gap-2`} data-testid='chat-human-question'>
      <div className={'flex min-w-0 flex-1 flex-col items-end gap-2'}>
        {parsed.images.length > 0 ? (
          <div className={'flex max-w-[83%] flex-wrap justify-end gap-2'}>
            {parsed.images.map((url) => (
              <GeneratedImage key={url} url={url} alt={fileNameFromAttachmentUrl(url)} variant='attachment' />
            ))}
          </div>
        ) : null}
        {parsed.files.length > 0 ? (
          <div className={'flex max-w-[83%] flex-wrap justify-end gap-2'}>
            {parsed.files.map((url) => (
              <button
                key={url}
                type='button'
                onClick={() => void openFileUrl(url, '_blank', fileNameFromAttachmentUrl(url))}
                className={
                  'flex max-w-[240px] items-center gap-1 rounded-[8px] border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-fill-content-hover'
                }
              >
                <FileIcon className={'h-4 w-4 shrink-0'} />
                <span className={'truncate'}>{fileNameFromAttachmentUrl(url)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {editing ? (
          <div className={'flex w-full max-w-[83%] flex-col gap-2 rounded-[16px] border border-primary bg-muted p-3'}>
            <Textarea
              ref={textareaRef}
              value={draft}
              rows={3}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submitEdit();
                }
              }}
              className={'!border-none !bg-transparent !px-1 !py-0 !shadow-none !ring-0'}
              data-testid='chat-question-edit-input'
            />
            <div className={'flex items-center justify-end gap-2'}>
              <span className={'mr-auto text-xs text-text-tertiary'}>{t('chat.edit.hint')}</span>
              <Button variant={'ghost'} size={'sm'} onClick={cancelEdit} disabled={saving}>
                {t('chat.edit.cancel')}
              </Button>
              <Button
                size={'sm'}
                onClick={() => void submitEdit()}
                disabled={saving || !draft.trim()}
                data-testid='chat-question-edit-save'
              >
                {t('chat.edit.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={'flex max-w-[83%] items-start gap-1'}>
            {canEdit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={'ghost'}
                    size={'icon'}
                    aria-label={t('chat.edit.button')}
                    data-testid='chat-question-edit'
                    className={'mt-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/question:opacity-100'}
                    onClick={() => setEditingQuestionId(id)}
                  >
                    <EditIcon className={'h-4 w-4 text-icon-secondary'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={'bottom'}>{t('chat.edit.button')}</TooltipContent>
              </Tooltip>
            ) : null}
            {parsed.text ? (
              <div className={'w-fit whitespace-pre-wrap break-words rounded-[16px] bg-muted px-4 py-2'}>{parsed.text}</div>
            ) : null}
          </div>
        )}
      </div>
      <Avatar className={'h-9 w-9 border border-border'}>
        <AvatarFallback
          style={{
            background: stringToColor(name),
          }}
        >
          {name[0]}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export default HumanQuestion;
