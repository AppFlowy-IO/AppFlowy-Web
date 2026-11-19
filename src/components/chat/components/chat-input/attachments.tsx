import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { uploadFile } from '@/application/services/js-services/http/http_api';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as FileIcon } from '@/assets/icons/file.svg';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import {
  AttachmentKind,
  MAX_FILE_ATTACHMENTS,
  MAX_IMAGE_ATTACHMENTS,
  attachmentKindForFile,
} from '@/components/chat/lib/attachments';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PendingAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  status: 'uploading' | 'ready' | 'failed';
  url?: string;
  /** Local preview for images while they upload. */
  previewUrl?: string;
}

export const ACCEPTED_ATTACHMENT_TYPES = 'image/*,.pdf,.txt,.md,.markdown,.csv,.json';

/**
 * Uploads chat attachments to the chat's file storage as soon as they are
 * picked, so sending only has to prepend the markers. Drafts belong to one chat:
 * switching chats drops them together with their preview URLs.
 */
export function useChatAttachments({ workspaceId, chatId }: { workspaceId: string; chatId: string }) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  // The latest list, for callbacks that must read it outside a render.
  const attachmentsRef = useRef<PendingAttachment[]>([]);

  const commit = useCallback((update: (current: PendingAttachment[]) => PendingAttachment[]) => {
    attachmentsRef.current = update(attachmentsRef.current);
    setAttachments(attachmentsRef.current);
  }, []);

  const release = useCallback((items: PendingAttachment[]) => {
    items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  useEffect(
    () => () => {
      release(attachmentsRef.current);
      commit(() => []);
    },
    [chatId, commit, release]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const current = attachmentsRef.current;
      let images = current.filter((item) => item.kind === 'image').length;
      let others = current.length - images;
      const accepted: { attachment: PendingAttachment; file: File }[] = [];

      for (const file of files) {
        const kind = attachmentKindForFile(file);

        if (kind === 'image' ? images >= MAX_IMAGE_ATTACHMENTS : others >= MAX_FILE_ATTACHMENTS) {
          toast.error(t('chat.attachments.tooMany', { images: MAX_IMAGE_ATTACHMENTS, files: MAX_FILE_ATTACHMENTS }));
          break;
        }

        if (kind === 'image') images += 1;
        else others += 1;

        accepted.push({
          file,
          attachment: {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            kind,
            status: 'uploading',
            previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
          },
        });
      }

      if (accepted.length === 0) return;

      commit((items) => [...items, ...accepted.map(({ attachment }) => attachment)]);

      accepted.forEach(({ attachment, file }) => {
        void uploadFile(workspaceId, chatId, file)
          .then((url) => {
            commit((items) => items.map((item) => (item.id === attachment.id ? { ...item, status: 'ready', url } : item)));
          })
          .catch((error) => {
            console.error('Failed to upload chat attachment', error);
            toast.error(t('chat.attachments.uploadFailed', { name: file.name }));
            commit((items) => items.map((item) => (item.id === attachment.id ? { ...item, status: 'failed' } : item)));
          });
      });
    },
    [chatId, commit, t, workspaceId]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      release(attachmentsRef.current.filter((item) => item.id === id));
      commit((items) => items.filter((item) => item.id !== id));
    },
    [commit, release]
  );

  const clearAttachments = useCallback(() => {
    release(attachmentsRef.current);
    commit(() => []);
  }, [commit, release]);

  const readyAttachments = useMemo(
    () =>
      attachments
        .filter((item): item is PendingAttachment & { url: string } => item.status === 'ready' && !!item.url)
        .map((item) => ({ kind: item.kind, url: item.url })),
    [attachments]
  );
  const uploading = attachments.some((item) => item.status === 'uploading');

  return { attachments, addFiles, removeAttachment, clearAttachments, readyAttachments, uploading };
}

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (attachments.length === 0) return null;

  return (
    <div className={'flex flex-wrap gap-2 px-1 pt-1'} data-testid='chat-attachment-chips'>
      {attachments.map((item) => (
        <div
          key={item.id}
          className={cn(
            'relative flex items-center gap-1 rounded-[8px] border border-border-primary bg-fill-content px-1.5 py-1 text-xs text-text-secondary',
            item.status === 'failed' && 'border-border-error-thick text-text-error'
          )}
          data-testid='chat-attachment-chip'
          data-status={item.status}
        >
          {item.kind === 'image' && item.previewUrl ? (
            <img src={item.previewUrl} alt={item.name} className={'h-8 w-8 rounded object-cover'} />
          ) : (
            <FileIcon className={'h-4 w-4 shrink-0'} />
          )}
          <span className={'max-w-[160px] truncate'}>{item.name}</span>
          {item.status === 'uploading' ? <LoadingDots size={10} /> : null}
          {item.status === 'failed' ? <span>{t('chat.attachments.failed')}</span> : null}
          <Button
            variant={'ghost'}
            size={'icon-sm'}
            aria-label={t('chat.attachments.remove')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemove(item.id)}
          >
            <CloseIcon className={'h-3.5 w-3.5'} />
          </Button>
        </div>
      ))}
    </div>
  );
}
