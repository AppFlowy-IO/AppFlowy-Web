import CircularProgress from '@mui/material/CircularProgress';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AIMeetingBlockData } from '@/application/types';
import { ReactComponent as TemplateApplyIcon } from '@/assets/ai-transcript/summary-menu-apply.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/ai-transcript/summary-menu-arrow.svg';
import { ReactComponent as CheckIcon } from '@/assets/ai-transcript/summary-menu-check.svg';
import { ReactComponent as MoreIcon } from '@/assets/ai-transcript/summary-more.svg';
import { ReactComponent as RegenerateIcon } from '@/assets/ai-transcript/summary-regenerate.svg';
import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary_tab.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { SummaryDetailOption, SummaryLanguageOption, SummaryTemplateOption, SummaryTemplateSection } from './ai-meeting.summary-regenerate';

interface RegenerateMenuProps {
  action?: 'generate' | 'regenerate';
  isRegenerating: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
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

const menuItemClass = 'group w-full justify-between gap-2 rounded-md py-1.5 font-normal leading-5';
const sectionLabelClass = 'min-h-0 py-1.5 text-xs font-medium leading-[18px] tracking-[0.1px]';

function OptionIndicator({ selected, applyOnHover = false }: { selected: boolean; applyOnHover?: boolean }) {
  return (
    <span aria-hidden className='relative ml-auto h-5 w-5 shrink-0'>
      {selected && <CheckIcon aria-hidden className={cn('h-5 w-5 text-icon-info-thick [&_[stroke]]:stroke-current', applyOnHover && 'group-hover:opacity-0 group-data-[highlighted]:opacity-0')} />}
      {(!selected || applyOnHover) && (
        <TemplateApplyIcon aria-hidden className='absolute inset-0 h-5 w-5 text-icon-secondary opacity-0 group-hover:opacity-100 group-data-[highlighted]:opacity-100 [&_[stroke]]:stroke-current' />
      )}
    </span>
  );
}

export const RegenerateMenu = memo(({
  action = 'regenerate',
  isRegenerating,
  menuOpen,
  onMenuOpenChange,
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
  const isInitialGeneration = action === 'generate';
  const ActionIcon = isInitialGeneration ? SummaryIcon : RegenerateIcon;
  const [showAllSections, setShowAllSections] = useState(false);
  const visibleSections = showAllSections ? templateSections : templateSections.slice(0, 1);
  const currentLanguage = languageOptions.find((option) => option.code.toLowerCase() === selectedLanguage.toLowerCase());

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open && isRegenerating) return;
        if (open) setShowAllSections(false);
        onMenuOpenChange(open);
      }}
    >
      <div className={cn('relative inline-flex shrink-0 items-stretch', isInitialGeneration ? 'h-10 rounded-full bg-fill-theme-thick' : 'h-8 rounded-lg', isRegenerating && 'opacity-60')}>
        <Button
          type='button'
          variant={isInitialGeneration ? 'default' : 'ghost'}
          disabled={isRegenerating}
          onClick={onRegenerate}
          className={cn('h-full gap-1.5 rounded-r-none py-0 text-sm font-medium leading-5 focus-visible:ring-2 focus-visible:ring-border-theme-thick/50', isInitialGeneration ? 'rounded-l-full pl-4 pr-3' : 'rounded-l-lg pl-3 pr-[10px]')}
        >
          {isRegenerating ? (
            <CircularProgress size={20} thickness={4.5} sx={{ color: 'currentColor' }} />
          ) : (
            <ActionIcon aria-hidden className='h-5 w-5 [&_[stroke]]:stroke-current' />
          )}
          <span>{t(isRegenerating ? 'document.aiMeeting.regenerate.generating' : isInitialGeneration ? 'document.aiMeeting.generateSummary' : 'document.aiMeeting.regenerate.regenerate')}</span>
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant={isInitialGeneration ? 'default' : 'ghost'}
            disabled={isRegenerating}
            aria-label={t('document.aiMeeting.regenerate.menuLabel')}
            className={cn('relative h-full rounded-l-none py-0 focus-visible:ring-2 focus-visible:ring-border-theme-thick/50', isInitialGeneration ? 'rounded-r-full pl-3 pr-4 data-[state=open]:bg-fill-theme-thick-hover' : 'rounded-r-lg pl-1.5 pr-2 text-icon-secondary data-[state=open]:bg-fill-content-hover')}
          >
            <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 w-px', isInitialGeneration ? 'bg-text-on-fill' : 'bg-border-primary')} />
            <ArrowDownIcon aria-hidden className='h-5 w-3 [&_[stroke]]:stroke-current' />
          </Button>
        </DropdownMenuTrigger>
        {/* Figma's inside strokes do not add to the controls' layout dimensions. */}
        {!isInitialGeneration && <span aria-hidden className='pointer-events-none absolute inset-0 rounded-lg border border-border-primary' />}
      </div>
      <DropdownMenuContent
        align='end'
        sideOffset={6}
        aria-label={t('document.aiMeeting.regenerate.menuLabel')}
        className={cn('max-h-[var(--radix-dropdown-menu-content-available-height)] w-[250px] min-w-0 rounded-xl border-0 bg-surface-layer-04 text-sm ring-1 ring-inset ring-border-primary', showAllSections && 'max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))]')}
      >
        {visibleSections.map((section, sectionIndex) => (
          <DropdownMenuGroup key={section.id}>
            {sectionIndex > 0 && <DropdownMenuSeparator className='my-2' />}
            <DropdownMenuLabel className={sectionLabelClass}>{section.title}</DropdownMenuLabel>
            {section.options.map((option) => {
              const selected = selectedTemplate === option.id;

              return (
                <DropdownMenuItem
                  key={option.id}
                  role='menuitemradio'
                  aria-checked={selected}
                  className={menuItemClass}
                  onSelect={() => onOptionSelect({ summary_template: option.id })}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    {option.icon && <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center'>{option.icon}</span>}
                    <span>{getOptionLabel(option)}</span>
                  </span>
                  <OptionIndicator selected={selected} />
                </DropdownMenuItem>
              );
            })}
            {!showAllSections && templateSections.length > 1 && (
              <DropdownMenuItem
                className={cn(menuItemClass, 'justify-start text-text-tertiary')}
                onSelect={(event) => {
                  event.preventDefault();
                  setShowAllSections(true);
                }}
              >
                <MoreIcon aria-hidden className="h-5 w-5 text-icon-tertiary [&_[fill='#6F748C']]:fill-current [&_[stroke]]:stroke-current" />
                {t('document.aiMeeting.regenerate.moreTemplates')}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator className='my-2' />
        <DropdownMenuGroup>
          <DropdownMenuLabel className={sectionLabelClass}>{t('document.aiMeeting.regenerate.summaryDetail')}</DropdownMenuLabel>
          {detailOptions.map((option) => (
            <DropdownMenuItem
              key={option.id}
              role='menuitemradio'
              aria-checked={selectedDetail.toLowerCase() === option.id.toLowerCase()}
              className={menuItemClass}
              onSelect={() => onOptionSelect({ summary_detail: option.id })}
            >
              <span>{getOptionLabel(option)}</span>
              <OptionIndicator selected={selectedDetail.toLowerCase() === option.id.toLowerCase()} applyOnHover />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className='my-2' />
        <DropdownMenuLabel className={sectionLabelClass}>{t('document.aiMeeting.regenerate.summaryLanguage')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className='gap-1 py-1.5 font-normal leading-5'>
            <span className='mr-auto'>{t('document.aiMeeting.regenerate.languageMenu')}</span>
            <span className='text-xs leading-[18px] tracking-[0.1px] text-text-secondary'>
              {currentLanguage ? getOptionLabel(currentLanguage) : selectedLanguage}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              aria-label={t('document.aiMeeting.regenerate.summaryLanguage')}
              aria-labelledby={undefined}
              sideOffset={6}
              className='max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] w-[240px] min-w-0 overflow-y-auto rounded-xl bg-surface-layer-04 ring-1 ring-inset ring-border-primary data-[side=right]:ml-0'
            >
              {languageOptions.map((option) => (
                <DropdownMenuItem
                  key={option.code}
                  role='menuitemradio'
                  aria-checked={selectedLanguage.toLowerCase() === option.code.toLowerCase()}
                  className={menuItemClass}
                  onSelect={() => onOptionSelect({ summary_language: option.code })}
                >
                  <span>{getOptionLabel(option)}</span>
                  <OptionIndicator selected={selectedLanguage.toLowerCase() === option.code.toLowerCase()} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

RegenerateMenu.displayName = 'RegenerateMenu';
