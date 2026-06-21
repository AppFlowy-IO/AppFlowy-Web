export enum SlashMenuGroupKey {
  AppFlowyAI = 'appflowyAI',
  BasicBlocks = 'basicBlocks',
  Media = 'media',
  Database = 'database',
  AdvancedBlocks = 'advancedBlocks',
  Inline = 'inline',
}

export interface SlashMenuOptionBase {
  key: string;
  label: string;
  keywords: string[];
  aliases?: string[];
  shortcut?: string;
  disabled?: boolean;
  group: SlashMenuGroupKey;
}

export interface SlashMenuFilterContext {
  searchText?: string;
  isInsideSimpleTableCell?: boolean;
  isInsideAIMeeting?: boolean;
}

export const SLASH_MENU_GROUP_ORDER = [
  SlashMenuGroupKey.AppFlowyAI,
  SlashMenuGroupKey.BasicBlocks,
  SlashMenuGroupKey.Media,
  SlashMenuGroupKey.Database,
  SlashMenuGroupKey.AdvancedBlocks,
  SlashMenuGroupKey.Inline,
] as const;

export const SIMPLE_TABLE_EXCLUDED_OPTION_KEYS = new Set([
  'askAIAnything',
  'continueWriting',
  'simpleTable',
  'grid',
  'linkedGrid',
  'board',
  'linkedKanban',
  'calendar',
  'linkedCalendar',
  'chart',
  'linkedChart',
  'outline',
]);

export const AI_MEETING_EXCLUDED_OPTION_KEYS = new Set([
  'askAIAnything',
  'continueWriting',
  'simpleTable',
  'grid',
  'linkedGrid',
  'board',
  'linkedKanban',
  'calendar',
  'linkedCalendar',
  'chart',
  'linkedChart',
  'outline',
  'video',
  'pdf',
]);

export function matchesSlashMenuOption(option: SlashMenuOptionBase, searchText?: string) {
  const query = searchText?.trim().toLowerCase();

  if (!query) return true;

  return [option.key, option.label, option.shortcut, ...(option.keywords ?? []), ...(option.aliases ?? [])].some(
    (value) => value?.toLowerCase().includes(query)
  );
}

export function filterSlashMenuOptions<T extends SlashMenuOptionBase>(options: T[], context: SlashMenuFilterContext) {
  return options.filter((option) => {
    if (option.disabled) return false;
    if (context.isInsideSimpleTableCell && SIMPLE_TABLE_EXCLUDED_OPTION_KEYS.has(option.key)) return false;
    if (context.isInsideAIMeeting && AI_MEETING_EXCLUDED_OPTION_KEYS.has(option.key)) return false;

    return matchesSlashMenuOption(option, context.searchText);
  });
}

export function groupSlashMenuOptions<T extends SlashMenuOptionBase>(options: T[]) {
  return SLASH_MENU_GROUP_ORDER.map((group) => ({
    group,
    options: options.filter((option) => option.group === group),
  })).filter(({ options }) => options.length > 0);
}
