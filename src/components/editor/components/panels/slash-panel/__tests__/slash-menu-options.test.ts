import {
  filterSlashMenuOptions,
  groupSlashMenuOptions,
  matchesSlashMenuOption,
  SlashMenuGroupKey,
  SlashMenuOptionBase,
} from '../slash-menu-options';

const option = (overrides: Partial<SlashMenuOptionBase> & Pick<SlashMenuOptionBase, 'key'>): SlashMenuOptionBase => ({
  label: overrides.key,
  keywords: [],
  group: SlashMenuGroupKey.BasicBlocks,
  ...overrides,
});

describe('slash-menu-options', () => {
  describe('matchesSlashMenuOption', () => {
    it('matches label, key, shortcut, keywords, and aliases', () => {
      expect(matchesSlashMenuOption(option({ key: 'heading1', label: 'Heading 1' }), 'heading 1')).toBe(true);
      expect(matchesSlashMenuOption(option({ key: 'numberedList', shortcut: '1.' }), '1.')).toBe(true);
      expect(matchesSlashMenuOption(option({ key: 'divider', keywords: ['horizontal line', 'hr'] }), 'hr')).toBe(true);
      expect(matchesSlashMenuOption(option({ key: 'simpleTable', aliases: ['st'] }), 'st')).toBe(true);
    });

    it('does not match unrelated queries', () => {
      expect(matchesSlashMenuOption(option({ key: 'heading1', label: 'Heading 1' }), 'calendar')).toBe(false);
    });
  });

  describe('filterSlashMenuOptions', () => {
    const options = [
      option({ key: 'text' }),
      option({ key: 'simpleTable' }),
      option({ key: 'grid' }),
      option({ key: 'linkedGrid' }),
      option({ key: 'chart' }),
      option({ key: 'linkedChart' }),
      option({ key: 'outline' }),
      option({ key: 'askAIAnything' }),
      option({ key: 'video' }),
      option({ key: 'pdf' }),
      option({ key: 'dateOrReminder', keywords: ['date', 'reminder'] }),
    ];

    it('hides desktop-excluded commands inside simple table cells', () => {
      const result = filterSlashMenuOptions(options, { isInsideSimpleTableCell: true });

      expect(result.map((item) => item.key)).toEqual(['text', 'video', 'pdf', 'dateOrReminder']);
    });

    it('hides desktop-excluded commands inside AI meeting blocks', () => {
      const result = filterSlashMenuOptions(options, { isInsideAIMeeting: true });

      expect(result.map((item) => item.key)).toEqual(['text', 'dateOrReminder']);
    });

    it('applies search after context exclusions', () => {
      const result = filterSlashMenuOptions(options, {
        searchText: 'reminder',
        isInsideSimpleTableCell: true,
      });

      expect(result.map((item) => item.key)).toEqual(['dateOrReminder']);
    });
  });

  describe('groupSlashMenuOptions', () => {
    it('keeps desktop-style group ordering and omits empty groups', () => {
      const result = groupSlashMenuOptions([
        option({ key: 'grid', group: SlashMenuGroupKey.Database }),
        option({ key: 'text', group: SlashMenuGroupKey.BasicBlocks }),
        option({ key: 'emoji', group: SlashMenuGroupKey.Inline }),
      ]);

      expect(result.map((group) => group.group)).toEqual([
        SlashMenuGroupKey.BasicBlocks,
        SlashMenuGroupKey.Database,
        SlashMenuGroupKey.Inline,
      ]);
    });
  });
});
