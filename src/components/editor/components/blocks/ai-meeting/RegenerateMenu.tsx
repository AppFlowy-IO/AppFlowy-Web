import { CircularProgress } from '@mui/material';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AIMeetingBlockData } from '@/application/types';
import { ReactComponent as RegenerateIcon } from '@/assets/icons/ai_summary.svg';
import { ReactComponent as TemplateApplyIcon } from '@/assets/icons/ai_template_apply.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { Popover } from '@/components/_shared/popover';
import { cn } from '@/lib/utils';

import type { SummaryDetailOption, SummaryLanguageOption, SummaryTemplateOption, SummaryTemplateSection } from './ai-meeting.summary-regenerate';

interface RegenerateMenuProps {
  isRegenerating: boolean;
  menuAnchor: HTMLElement | null;
  menuOpen: boolean;
  onMenuClose: () => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onRegenerate: () => void;
  onOptionSelect: (updates: Partial<Pick<AIMeetingBlockData, 'summary_template' | 'summary_detail' | 'summary_language'>>) => void;
  selectedTemplate: string;
  selectedDetail: string;
  selectedLanguage: string;
  templateSections: SummaryTemplateSection[];
  detailOptions: SummaryDetailOption[];
  languageOptions: SummaryLanguageOption[];
  getOptionLabel: (option: Pick<SummaryTemplateOption, 'labelKey' | 'defaultLabel'>) => string;
}

export const RegenerateMenu = memo(({
  isRegenerating,
  menuAnchor,
  menuOpen,
  onMenuClose,
  onMenuOpen,
  onRegenerate,
  onOptionSelect,
  selectedTemplate,
  selectedDetail,
  selectedLanguage,
  templateSections,
  detailOptions,
  languageOptions,
  getOptionLabel,
}: RegenerateMenuProps) => {
  const { t } = useTranslation();

  return (
    <>
      <div className={cn('inline-flex items-stretch', isRegenerating ? 'opacity-60' : '')}>
        <button
          type="button"
          disabled={isRegenerating}
          onClick={onRegenerate}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-l-md border border-r-0 border-border-primary py-1.5 pl-4 pr-[10px] text-sm text-text-primary',
            isRegenerating
              ? 'cursor-not-allowed'
              : 'hover:bg-fill-list-hover'
          )}
        >
          {isRegenerating ? (
            <CircularProgress size={16} thickness={4.5} sx={{ color: 'currentColor' }} />
          ) : (
            <RegenerateIcon className="h-5 w-5" />
          )}
          <span>
            {isRegenerating
              ? t('document.aiMeeting.regenerate.generating', { defaultValue: 'Generating' })
              : t('document.aiMeeting.regenerate.regenerate', { defaultValue: 'Regenerate' })}
          </span>
        </button>
        <button
          type="button"
          disabled={isRegenerating}
          onClick={onMenuOpen}
          className={cn(
            'inline-flex h-8 items-center rounded-r-md border border-border-primary px-3 text-text-secondary',
            isRegenerating
              ? 'cursor-not-allowed'
              : 'hover:bg-fill-list-hover'
          )}
        >
          <ArrowDownIcon className="h-4 w-4" />
        </button>
      </div>
      <Popover
        open={menuOpen}
        anchorEl={menuAnchor}
        onClose={onMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <div className="flex w-[240px] flex-col p-2 text-sm">
          {templateSections.map((section, sectionIndex) => (
            <div key={section.id}>
              <div className="px-2 py-1 text-xs text-text-tertiary">{section.title}</div>
              {section.options.map((option) => {
                const selected = selectedTemplate === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                    )}
                    onClick={() => onOptionSelect({ summary_template: option.id })}
                  >
                    <span className="flex items-center gap-2">
                      {option.icon ? <span>{option.icon}</span> : null}
                      <span>{getOptionLabel(option)}</span>
                    </span>
                    {selected ? (
                      <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                    ) : (
                      <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
              {sectionIndex < templateSections.length - 1 && (
                <div className="my-1 border-t border-border-primary" />
              )}
            </div>
          ))}
          <div className="my-1 border-t border-border-primary" />
          <div className="px-2 py-1 text-xs text-text-tertiary">
            {t('document.aiMeeting.regenerate.summaryDetail', {
              defaultValue: 'Summary detail',
            })}
          </div>
          {detailOptions.map((option) => {
            const selected = selectedDetail === option.id;

            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  'group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                )}
                onClick={() => onOptionSelect({ summary_detail: option.id })}
              >
                <span>{getOptionLabel(option)}</span>
                {selected ? (
                  <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                ) : (
                  <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            );
          })}
          <div className="my-1 border-t border-border-primary" />
          <div className="px-2 py-1 text-xs text-text-tertiary">
            {t('document.aiMeeting.regenerate.summaryLanguage', {
              defaultValue: 'Summary language',
            })}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {languageOptions.map((option) => {
              const selected =
                selectedLanguage.toLowerCase() === option.code.toLowerCase();

              return (
                <button
                  key={option.code}
                  type="button"
                  className={cn(
                    'group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                  )}
                  onClick={() => onOptionSelect({ summary_language: option.code })}
                >
                  <span>{t(option.labelKey, { defaultValue: option.defaultLabel })}</span>
                  {selected ? (
                    <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                  ) : (
                    <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
});

RegenerateMenu.displayName = 'RegenerateMenu';
