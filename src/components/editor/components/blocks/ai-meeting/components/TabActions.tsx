import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary.svg';
import { ReactComponent as TriangleDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as ShareIcon } from '@/assets/icons/share.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import {
  SummaryInstruction,
  SummaryTemplate,
  SummaryTemplateResult,
  SummaryTemplateSection,
} from '../services/types';
import { DetailLevel, RegenerateMenu } from './RegenerateMenu';

interface TabActionsProps {
  onRegenerate: () => void;
  onExport?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  isGenerating?: boolean;
  isLoadingTemplates?: boolean;
  showRegenerate?: boolean;
  readOnly?: boolean;
  // Template selection props
  templates?: SummaryTemplateResult | null;
  selectedTemplate?: string;
  selectedDetail?: DetailLevel;
  selectedLanguage?: string;
  onTemplateSelect?: (template: SummaryTemplate, section: SummaryTemplateSection) => void;
  onDetailSelect?: (detail: DetailLevel, instruction: SummaryInstruction) => void;
  onLanguageSelect?: (languageCode: string) => void;
}

export const TabActions = memo(({
  onRegenerate,
  onExport,
  onCopy,
  onDelete,
  isGenerating = false,
  isLoadingTemplates = false,
  showRegenerate = true,
  readOnly = false,
  templates = null,
  selectedTemplate = 'auto',
  selectedDetail = 'Balanced',
  selectedLanguage = 'en',
  onTemplateSelect,
  onDetailSelect,
  onLanguageSelect,
}: TabActionsProps) => {
  const { t } = useTranslation();
  const [regenerateMenuOpen, setRegenerateMenuOpen] = useState(false);

  const handleRegenerate = useCallback(() => {
    onRegenerate();
  }, [onRegenerate]);

  // Check if we have template selection capability (show menu even while loading)
  const hasTemplateSelection = onTemplateSelect && onDetailSelect && onLanguageSelect;

  if (readOnly && !onCopy && !onExport) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Regenerate Split Button */}
      {showRegenerate && !readOnly && (
        <div className="flex items-center rounded-lg border border-line-divider">
          {/* Main Regenerate Button */}
          <button
            onClick={handleRegenerate}
            disabled={isGenerating}
            className={cn(
              'flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 text-sm font-medium leading-5 text-text-primary transition-colors',
              'hover:bg-fill-list-hover rounded-l-lg',
              isGenerating && 'opacity-50 cursor-not-allowed'
            )}
          >
            <SummaryIcon className={cn('h-5 w-5 text-text-primary', isGenerating && 'animate-spin')} />
            <span>{t('aiMeeting.actions.regenerate', 'Regenerate')}</span>
          </button>

          {/* Dropdown Arrow with Template Menu */}
          {hasTemplateSelection ? (
            <RegenerateMenu
              open={regenerateMenuOpen}
              onOpenChange={setRegenerateMenuOpen}
              templates={templates}
              isLoading={isLoadingTemplates}
              selectedTemplate={selectedTemplate}
              selectedDetail={selectedDetail}
              selectedLanguage={selectedLanguage}
              onTemplateSelect={onTemplateSelect}
              onDetailSelect={onDetailSelect}
              onLanguageSelect={onLanguageSelect}
            >
              <button
                disabled={isGenerating}
                className={cn(
                  'flex items-center pl-1.5 pr-2 py-1.5 border-l border-line-divider text-text-primary',
                  'hover:bg-fill-list-hover rounded-r-lg transition-colors',
                  isGenerating && 'opacity-50 cursor-not-allowed'
                )}
              >
                <TriangleDownIcon className="h-5 w-3" />
              </button>
            </RegenerateMenu>
          ) : (
            <button
              disabled={isGenerating}
              onClick={handleRegenerate}
              className={cn(
                'flex items-center pl-1.5 pr-2 py-1.5 border-l border-line-divider text-text-primary',
                'hover:bg-fill-list-hover rounded-r-lg transition-colors',
                isGenerating && 'opacity-50 cursor-not-allowed'
              )}
            >
              <TriangleDownIcon className="h-5 w-3" />
            </button>
          )}
        </div>
      )}

      {/* More Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex items-center p-1.5 rounded-lg text-icon-secondary',
              'hover:bg-fill-list-hover transition-colors'
            )}
          >
            <MoreIcon className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="data-[state=open]:animate-fade-in">
          {onCopy && (
            <DropdownMenuItem onClick={onCopy}>
              <CopyIcon className="h-4 w-4 mr-2" />
              {t('aiMeeting.actions.copy', 'Copy to clipboard')}
            </DropdownMenuItem>
          )}
          {onExport && (
            <DropdownMenuItem onClick={onExport}>
              <ShareIcon className="h-4 w-4 mr-2" />
              {t('aiMeeting.actions.export', 'Export')}
            </DropdownMenuItem>
          )}
          {onDelete && !readOnly && (
            <DropdownMenuItem onClick={onDelete} className="text-function-error">
              <DeleteIcon className="h-4 w-4 mr-2" />
              {t('aiMeeting.actions.delete', 'Delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

TabActions.displayName = 'TabActions';

export default TabActions;
