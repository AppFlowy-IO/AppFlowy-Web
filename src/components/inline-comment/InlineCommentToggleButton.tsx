import { MessageSquare } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useInlineCommentContextOptional } from './InlineCommentContext';

export function InlineCommentToggleButton() {
  const { t } = useTranslation();
  const inlineComments = useInlineCommentContextOptional();
  const openCount = useMemo(() => {
    if (!inlineComments) return 0;

    return inlineComments.comments.filter(
      (comment) =>
        !comment.replyCommentId &&
        !comment.isDeleted &&
        !comment.isResolved &&
        inlineComments.anchors.has(comment.commentId)
    ).length;
  }, [inlineComments]);

  if (!inlineComments?.active) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={t('inlineComment.comments')}
          data-testid={'inline-comment-toggle'}
          className={cn(
            'relative rounded-md p-1.5 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary',
            inlineComments.isPanelOpen && 'bg-fill-list-active text-icon-primary'
          )}
          onClick={() => inlineComments.setPanelOpen(!inlineComments.isPanelOpen)}
        >
          <MessageSquare size={18} />
          {openCount > 0 && (
            <span
              className={
                'absolute -right-1 -top-1 min-w-4 rounded-full bg-fill-theme-thick px-1 text-[10px] leading-4 text-text-on-fill'
              }
            >
              {openCount > 99 ? '99+' : openCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('inlineComment.comments')}</TooltipContent>
    </Tooltip>
  );
}
