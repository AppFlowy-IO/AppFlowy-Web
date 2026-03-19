/**
 * i18n constants for Playwright tests
 * Migrated from: cypress/support/i18n-constants.ts
 *
 * Maps translation keys to their English values for use in tests.
 */

export const SlashMenuNames = {
  text: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  image: 'Image',
  bulletedList: 'Bulleted list',
  numberedList: 'Numbered list',
  todoList: 'To-do list',
  doc: 'Doc',
  linkedDoc: 'Link to page',
  grid: 'Grid',
  linkedGrid: 'Linked Grid',
  kanban: 'Kanban',
  linkedKanban: 'Linked Kanban',
  calendar: 'Calendar',
  linkedCalendar: 'Linked Calendar',
  quote: 'Quote',
  divider: 'Divider',
  table: 'Table',
  callout: 'Callout',
  outline: 'Outline',
  mathEquation: 'Math Equation',
  code: 'Code',
  toggleList: 'Toggle list',
  toggleHeading1: 'Toggle heading 1',
  toggleHeading2: 'Toggle heading 2',
  toggleHeading3: 'Toggle heading 3',
  emoji: 'Emoji',
  aiWriter: 'AI Writer',
  dateOrReminder: 'Date or Reminder',
  photoGallery: 'Photo Gallery',
  file: 'File',
  continueWriting: 'Continue Writing',
  askAIAnything: 'Ask AI Anything',
} as const;

export function getSlashMenuItemName(key: keyof typeof SlashMenuNames): string {
  return SlashMenuNames[key];
}
