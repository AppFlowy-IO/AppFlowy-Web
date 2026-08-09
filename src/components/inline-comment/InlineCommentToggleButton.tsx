import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useInlineCommentPanelOptional } from './InlineCommentContext';

export function InlineCommentToggleButton() {
  const { t } = useTranslation();
  const inlineComments = useInlineCommentPanelOptional();

  if (!inlineComments?.active) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={t('inlineComment.comments')}
          aria-pressed={inlineComments.isPanelOpen}
          data-testid={'inline-comment-toggle'}
          className={cn(
            'rounded-md p-1.5 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary',
            inlineComments.isPanelOpen && 'bg-fill-info-light text-icon-primary'
          )}
          onClick={() => inlineComments.setPanelOpen(!inlineComments.isPanelOpen)}
        >
          <MessageSquare size={18} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('inlineComment.comments')}</TooltipContent>
    </Tooltip>
  );
}
