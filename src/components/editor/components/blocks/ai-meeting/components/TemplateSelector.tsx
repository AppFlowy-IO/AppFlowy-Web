import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import {
  SummaryInstruction,
  SummaryTemplate,
  SummaryTemplateResult,
  SummaryTemplateSection,
} from '../services/types';

type DetailLevel = 'Brief' | 'Balanced' | 'Detailed';

interface TemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: SummaryTemplateResult | null;
  isLoading: boolean;
  onGenerate: (template: SummaryTemplate, instruction: SummaryInstruction, fixedPrompt: string) => void;
}

export const TemplateSelector = memo(({
  open,
  onOpenChange,
  templates,
  isLoading,
  onGenerate,
}: TemplateSelectorProps) => {
  const { t } = useTranslation();
  const [selectedSection, setSelectedSection] = useState<SummaryTemplateSection | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<SummaryTemplate | null>(null);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('Balanced');

  // Reset selection when dialog opens
  useEffect(() => {
    if (open && templates?.sections && templates.sections.length > 0) {
      const firstSection = templates.sections[0];

      setSelectedSection(firstSection);
      setSelectedTemplate(firstSection?.templates?.[0] || null);
    }
  }, [open, templates]);

  const handleSectionChange = useCallback((section: SummaryTemplateSection) => {
    setSelectedSection(section);
    setSelectedTemplate(section?.templates?.[0] || null);
  }, []);

  const handleGenerate = useCallback(() => {
    if (!selectedTemplate || !templates || !templates.instructions) return;

    const instruction = templates.instructions.find(i => i.key === detailLevel);

    if (!instruction) return;

    onGenerate(selectedTemplate, instruction, templates.fixed_prompt || '');
    onOpenChange(false);
  }, [selectedTemplate, templates, detailLevel, onGenerate, onOpenChange]);

  const detailLevels: DetailLevel[] = ['Brief', 'Balanced', 'Detailed'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('aiMeeting.summary.selectTemplate', 'Select Summary Template')}</DialogTitle>
          <DialogDescription>
            {t('aiMeeting.summary.templateDescription', 'Choose a template and detail level for your meeting summary.')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-fill-theme-thick" />
          </div>
        ) : templates ? (
          <div className="space-y-4 my-4">
            {/* Section Tabs */}
            <div className="flex flex-wrap gap-2">
              {templates.sections?.map((section) => (
                <button
                  key={section.section_name}
                  onClick={() => handleSectionChange(section)}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                    selectedSection?.section_name === section.section_name
                      ? 'bg-fill-theme-thick text-white'
                      : 'bg-fill-list-hover text-text-secondary hover:text-text-primary'
                  )}
                >
                  {section.section_name}
                </button>
              ))}
            </div>

            {/* Templates Grid */}
            {selectedSection && selectedSection.templates && (
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                {selectedSection.templates?.map((template) => (
                  <button
                    key={template.prompt_name}
                    onClick={() => setSelectedTemplate(template)}
                    className={cn(
                      'p-3 text-left rounded-lg border transition-colors',
                      selectedTemplate?.prompt_name === template.prompt_name
                        ? 'border-fill-theme-thick bg-fill-list-active'
                        : 'border-line-divider hover:border-line-border'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {template.icon && <span className="text-lg">{template.icon}</span>}
                      <span className="text-sm font-medium">{template.prompt_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Detail Level */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                {t('aiMeeting.summary.detailLevel', 'Detail Level')}
              </label>
              <div className="flex gap-2">
                {detailLevels.map((level) => (
                  <button
                    key={level}
                    onClick={() => setDetailLevel(level)}
                    className={cn(
                      'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors',
                      detailLevel === level
                        ? 'border-fill-theme-thick bg-fill-list-active text-text-primary'
                        : 'border-line-divider text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {t(`aiMeeting.summary.${level.toLowerCase()}`, level)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-text-secondary">
            {t('aiMeeting.summary.noTemplates', 'No templates available')}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('button.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selectedTemplate || isLoading}
          >
            {t('aiMeeting.summary.generate', 'Generate Summary')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

TemplateSelector.displayName = 'TemplateSelector';

export default TemplateSelector;
