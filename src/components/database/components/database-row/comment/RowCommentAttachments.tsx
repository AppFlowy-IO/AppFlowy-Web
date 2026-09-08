import { CommentAttachment } from '@/application/row-comment.type';
import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ImageRender } from '@/components/_shared/image-render/ImageRender';
import { downloadFile } from '@/utils/download';

function Attachment({ attachment }: { attachment: CommentAttachment }) {
  // Desktop may contain device-local paths; browsers can open uploaded HTTP files.
  const remoteUrl = /^https?:\/\//i.test(attachment.url) ? attachment.url : undefined;

  return (
    <a
      href={remoteUrl}
      target='_blank'
      rel='noopener noreferrer'
      download={attachment.name}
      onClick={(event) => {
        event.preventDefault();
        if (remoteUrl) void downloadFile(remoteUrl, attachment.name);
      }}
      data-testid='row-comment-attachment'
      className='flex max-w-[200px] flex-col overflow-hidden rounded border border-border-primary text-sm'
    >
      {remoteUrl && attachment.file_type?.startsWith('image/') && (
        <div className='h-[120px] w-[200px] max-w-full'>
          <ImageRender src={remoteUrl} alt={attachment.name} className='object-cover' />
        </div>
      )}
      <span className='flex items-center gap-1 px-2 py-1'>
        <AttachmentIcon className='h-4 w-4 shrink-0' />
        <span className='truncate'>{attachment.name}</span>
      </span>
    </a>
  );
}

export function RowCommentAttachments({ attachments }: { attachments: CommentAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className='flex flex-wrap gap-1'>
      {attachments.map((attachment) => (
        <Attachment key={attachment.id || attachment.url} attachment={attachment} />
      ))}
    </div>
  );
}
