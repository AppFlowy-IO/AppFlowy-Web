import {
  buildSummaryRegeneratePrompt,
  DEFAULT_SUMMARY_DETAIL,
  DEFAULT_SUMMARY_LANGUAGE,
  DEFAULT_SUMMARY_TEMPLATE,
  getSummaryDetailId,
  getSummaryLanguageCode,
  getSummaryTemplateId,
  normalizeGeneratedSummaryMarkdown,
} from '../ai-meeting.summary-regenerate';

describe('ai-meeting.summary-regenerate', () => {
  describe('getSummaryTemplateId', () => {
    it('falls back to default for invalid values', () => {
      expect(getSummaryTemplateId(undefined)).toBe(DEFAULT_SUMMARY_TEMPLATE);
      expect(getSummaryTemplateId('')).toBe(DEFAULT_SUMMARY_TEMPLATE);
      expect(getSummaryTemplateId('unknown_template')).toBe(DEFAULT_SUMMARY_TEMPLATE);
    });

    it('returns the valid template id', () => {
      expect(getSummaryTemplateId('meeting_minutes')).toBe('meeting_minutes');
    });

    it('matches ids case-insensitively and normalizes labels', () => {
      expect(getSummaryTemplateId('MEETING_MINUTES')).toBe('meeting_minutes');
      expect(getSummaryTemplateId('Meeting Minutes')).toBe('meeting_minutes');
    });
  });

  describe('getSummaryDetailId', () => {
    it('falls back to default for invalid values', () => {
      expect(getSummaryDetailId(undefined)).toBe(DEFAULT_SUMMARY_DETAIL);
      expect(getSummaryDetailId('')).toBe(DEFAULT_SUMMARY_DETAIL);
      expect(getSummaryDetailId('unknown_detail')).toBe(DEFAULT_SUMMARY_DETAIL);
    });

    it('returns the valid detail id', () => {
      expect(getSummaryDetailId('detailed')).toBe('detailed');
    });

    it('matches details case-insensitively and normalizes labels', () => {
      expect(getSummaryDetailId('BALANCED')).toBe('balanced');
      expect(
        getSummaryDetailId('Brief', [
          { id: 'brief', defaultLabel: 'Brief', prompt: 'brief prompt' },
          { id: 'balanced', defaultLabel: 'Balanced', prompt: 'balanced prompt' },
        ])
      ).toBe('brief');
    });
  });

  describe('getSummaryLanguageCode', () => {
    it('falls back to default for invalid values', () => {
      expect(getSummaryLanguageCode(undefined)).toBe(DEFAULT_SUMMARY_LANGUAGE);
      expect(getSummaryLanguageCode('')).toBe(DEFAULT_SUMMARY_LANGUAGE);
      expect(getSummaryLanguageCode('invalid')).toBe(DEFAULT_SUMMARY_LANGUAGE);
    });

    it('accepts case-insensitive supported languages', () => {
      expect(getSummaryLanguageCode('ZH-cn')).toBe('zh-CN');
      expect(getSummaryLanguageCode('en')).toBe('en');
    });

    it('supports flutter parity languages', () => {
      expect(getSummaryLanguageCode('da')).toBe('da');
      expect(getSummaryLanguageCode('sv')).toBe('sv');
    });
  });

  describe('buildSummaryRegeneratePrompt', () => {
    it('includes selected language and summary constraints', () => {
      const prompt = buildSummaryRegeneratePrompt({
        templateId: 'action_focused',
        detailId: 'concise',
        languageCode: 'zh-CN',
      });

      expect(prompt).toContain('Output language: Chinese (Simplified) (zh-CN).');
      expect(prompt).toContain('Do not output citation markers like ^1, [1], or similar.');
      expect(prompt).toContain('1. OVERVIEW');
      expect(prompt).toContain('5. ACTION ITEMS');
    });

    it('falls back to defaults when options are invalid', () => {
      const prompt = buildSummaryRegeneratePrompt({
        templateId: 'invalid_template',
        detailId: 'invalid_detail',
        languageCode: 'invalid_language',
      });

      expect(prompt).toContain('Output language: English (en).');
    });

    it('uses remote fixed prompt when template config is provided', () => {
      const prompt = buildSummaryRegeneratePrompt({
        templateId: 'auto',
        detailId: 'brief',
        languageCode: 'zh-CN',
        templateConfig: {
          fixedPrompt: 'Language Code: ${LANGUAGE_CODE}',
          templateOptions: [
            { id: 'auto', defaultLabel: 'Auto', prompt: 'Template prompt text' },
          ],
          detailOptions: [
            { id: 'brief', defaultLabel: 'Brief', prompt: 'Detail prompt text' },
          ],
          templateSections: [
            { id: 's1', title: 'AI Template', options: [{ id: 'auto', defaultLabel: 'Auto', prompt: 'Template prompt text' }] },
          ],
        },
        speakerInfoMap: {
          s1: { name: 'Lucas Xu', email: 'lucas.xu@appflowy.io' },
        },
      });

      expect(prompt).toContain('Language Code: ZH-CN');
      expect(prompt).toContain('Detail Instruction: Detail prompt text');
      expect(prompt).toContain('Meeting Type Template Prompt: Template prompt text');
      expect(prompt).toContain('Meeting Participants:');
      expect(prompt).toContain('- Lucas Xu (email: lucas.xu@appflowy.io)');
    });
  });

  describe('normalizeGeneratedSummaryMarkdown', () => {
    it('unwraps fenced markdown output', () => {
      const raw = '```markdown\n# OVERVIEW\n- Item\n```';

      expect(normalizeGeneratedSummaryMarkdown(raw)).toBe('# OVERVIEW\n- Item');
    });

    it('returns trimmed plain text when not fenced', () => {
      expect(normalizeGeneratedSummaryMarkdown('  # Title  ')).toBe('# Title');
    });
  });
});
