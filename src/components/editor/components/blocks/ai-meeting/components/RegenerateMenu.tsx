import { memo, ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right_small.svg';
import { ReactComponent as ApplyIcon } from '@/assets/icons/ai_apply.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import {
  SummaryInstruction,
  SummaryTemplate,
  SummaryTemplateResult,
  SummaryTemplateSection,
} from '../services/types';

// Supported languages for summary generation
export const SUMMARY_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'it', name: 'Italian' },
  { code: 'sv', name: 'Swedish' },
] as const;

export type DetailLevel = 'Brief' | 'Balanced' | 'Detailed';

interface RegenerateMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: SummaryTemplateResult | null;
  isLoading?: boolean;
  selectedTemplate: string;
  selectedDetail: DetailLevel;
  selectedLanguage: string;
  onTemplateSelect: (template: SummaryTemplate, section: SummaryTemplateSection) => void;
  onDetailSelect: (detail: DetailLevel, instruction: SummaryInstruction) => void;
  onLanguageSelect: (languageCode: string) => void;
  children: ReactNode;
}

// Menu item component
const MenuItem = memo(({
  icon,
  label,
  isSelected,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
  showApplyOnHover = false,
  className,
}: {
  icon?: string;
  label: string;
  isSelected?: boolean;
  isHovered?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  showApplyOnHover?: boolean;
  className?: string;
}) => {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-text-primary transition-colors',
        isHovered && 'bg-fill-list-hover',
        className
      )}
    >
      {icon && <span className="text-sm w-5 text-center">{icon}</span>}
      <span className="flex-1 text-left leading-5">{label}</span>
      {isSelected && (
        <CheckIcon className="h-5 w-5 text-text-primary" />
      )}
      {!isSelected && isHovered && showApplyOnHover && (
        <ApplyIcon className="h-5 w-5 text-icon-secondary" />
      )}
    </button>
  );
});

MenuItem.displayName = 'MenuItem';

// Section header component
const SectionHeader = memo(({ title }: { title: string }) => {
  return (
    <div className="px-2 py-1.5 text-xs font-medium text-text-tertiary tracking-wide">
      {title}
    </div>
  );
});

SectionHeader.displayName = 'SectionHeader';

// Divider component
const MenuDivider = memo(() => {
  return <div className="my-2 border-t border-line-divider" />;
});

MenuDivider.displayName = 'MenuDivider';

export const RegenerateMenu = memo(({
  open,
  onOpenChange,
  templates,
  isLoading = false,
  selectedTemplate,
  selectedDetail,
  selectedLanguage,
  onTemplateSelect,
  onDetailSelect,
  onLanguageSelect,
  children,
}: RegenerateMenuProps) => {
  const { t } = useTranslation();
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  const sections = useMemo(() => templates?.sections || [], [templates]);
  const instructions = useMemo(() => templates?.instructions || [], [templates]);

  // Flatten all templates from all sections
  const allTemplates = useMemo(() => {
    const result: { template: SummaryTemplate; section: SummaryTemplateSection }[] = [];

    sections.forEach(section => {
      section.templates.forEach(template => {
        result.push({ template, section });
      });
    });

    return result;
  }, [sections]);

  // Templates to display (first 5 or all)
  const templatesToShow = useMemo(() => {
    return showAllTemplates ? allTemplates : allTemplates.slice(0, 5);
  }, [allTemplates, showAllTemplates]);

  // Get language name from code
  const getLanguageName = useCallback((code: string) => {
    const lang = SUMMARY_LANGUAGES.find(l => l.code === code);

    return lang?.name || 'English';
  }, []);

  const handleTemplateClick = useCallback((template: SummaryTemplate, section: SummaryTemplateSection) => {
    onTemplateSelect(template, section);
    onOpenChange(false);
  }, [onTemplateSelect, onOpenChange]);

  const handleDetailClick = useCallback((key: DetailLevel) => {
    const instruction = instructions.find(i => i.key === key);

    if (instruction) {
      onDetailSelect(key, instruction);
      onOpenChange(false);
    }
  }, [instructions, onDetailSelect, onOpenChange]);

  const handleLanguageClick = useCallback((code: string) => {
    onLanguageSelect(code);
    setLanguageMenuOpen(false);
    onOpenChange(false);
  }, [onLanguageSelect, onOpenChange]);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60 p-0 bg-bg-body border border-line-divider rounded-xl shadow-md !animate-none data-[state=open]:!animate-fade-in"
        sideOffset={4}
      >
        {/* Loading State */}
        {(isLoading || !templates) ? (
          <div className="flex items-center justify-center py-8 px-4">
            <div className="flex flex-col items-center gap-2">
              <div className="h-5 w-5 border-2 border-fill-theme-thick border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-text-secondary">
                {t('aiMeeting.summary.loadingTemplates', 'Loading templates...')}
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* AI Template Section */}
            <div className="pt-2 px-2">
              <SectionHeader title={t('aiMeeting.summary.aiTemplate', 'AI template')} />

              {templatesToShow.map(({ template, section }) => {
                const templateId = template.prompt_name.toLowerCase().replace(/\s+/g, '_');
                const isSelected = templateId === selectedTemplate;
                const itemKey = `template-${templateId}`;

                return (
                  <MenuItem
                    key={templateId}
                    icon={template.icon}
                    label={template.prompt_name}
                    isSelected={isSelected}
                    isHovered={hoveredItem === itemKey}
                    showApplyOnHover={!isSelected}
                    onClick={() => handleTemplateClick(template, section)}
                    onMouseEnter={() => setHoveredItem(itemKey)}
                    onMouseLeave={() => setHoveredItem(null)}
                  />
                );
              })}

              {/* More templates option */}
              {!showAllTemplates && allTemplates.length > 5 && (
                <button
                  onClick={() => setShowAllTemplates(true)}
                  onMouseEnter={() => setHoveredItem('more')}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-text-tertiary transition-colors',
                    hoveredItem === 'more' && 'bg-fill-list-hover'
                  )}
                >
                  <span className="w-5 text-center text-text-tertiary">···</span>
                  <span className="flex-1 text-left leading-5">
                    {t('aiMeeting.summary.moreTemplates', 'more templates')}
                  </span>
                </button>
              )}
            </div>

            <MenuDivider />

            {/* Summary Detail Section */}
            <div className="px-2">
              <SectionHeader title={t('aiMeeting.summary.detailLevel', 'Summary detail')} />

              {(['Brief', 'Balanced', 'Detailed'] as DetailLevel[]).map((level) => {
                const isSelected = level === selectedDetail;
                const itemKey = `detail-${level}`;

                return (
                  <MenuItem
                    key={level}
                    label={t(`aiMeeting.summary.${level.toLowerCase()}`, level)}
                    isSelected={isSelected}
                    isHovered={hoveredItem === itemKey}
                    onClick={() => handleDetailClick(level)}
                    onMouseEnter={() => setHoveredItem(itemKey)}
                    onMouseLeave={() => setHoveredItem(null)}
                  />
                );
              })}
            </div>

            <MenuDivider />

            {/* Summary Language Section */}
            <div className="pb-2 px-2">
              <SectionHeader title={t('aiMeeting.summary.summaryLanguage', 'Summary language')} />

              <DropdownMenu open={languageMenuOpen} onOpenChange={setLanguageMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    onMouseEnter={() => setHoveredItem('language')}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors',
                      hoveredItem === 'language' && 'bg-fill-list-hover'
                    )}
                  >
                    <span className="flex-1 text-left text-text-primary leading-5">
                      {t('aiMeeting.summary.selectLanguage', 'Language')}
                    </span>
                    <span className="text-xs text-text-secondary tracking-wide">
                      {getLanguageName(selectedLanguage)}
                    </span>
                    <ChevronRightIcon className="h-5 w-5 text-text-tertiary" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="w-56 max-h-80 overflow-y-auto p-2 bg-bg-body border border-line-divider rounded-xl shadow-md !animate-none data-[state=open]:!animate-fade-in"
                  sideOffset={4}
                >
                  {SUMMARY_LANGUAGES.map((lang) => {
                    const isSelected = lang.code === selectedLanguage;
                    const itemKey = `lang-${lang.code}`;

                    return (
                      <MenuItem
                        key={lang.code}
                        label={lang.name}
                        isSelected={isSelected}
                        isHovered={hoveredItem === itemKey}
                        onClick={() => handleLanguageClick(lang.code)}
                        onMouseEnter={() => setHoveredItem(itemKey)}
                        onMouseLeave={() => setHoveredItem(null)}
                      />
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

RegenerateMenu.displayName = 'RegenerateMenu';

export default RegenerateMenu;
