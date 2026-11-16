import { AITranslateLanguage, getTypeOptions } from '@/application/database-yjs';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

export function parseAITranslateTypeOption(field?: YDatabaseField) {
  const typeOption = getTypeOptions(field);

  const language = typeOption ? Number(typeOption.get(YjsDatabaseKey.language)) : AITranslateLanguage.English;

  return {
    language,
  };
}

export const languageTexts = [{
  label: 'English',
  value: AITranslateLanguage.English,
}, {
  label: 'Traditional Chinese',
  value: AITranslateLanguage.Traditional_Chinese,
}, {
  label: 'Spanish',
  value: AITranslateLanguage.Spanish,
}, {
  label: 'French',
  value: AITranslateLanguage.French,
}, {
  label: 'German',
  value: AITranslateLanguage.German,
}, {
  label: 'Hindi',
  value: AITranslateLanguage.Hindi,
}, {
  label: 'Portuguese',
  value: AITranslateLanguage.Portuguese,
}, {
  label: 'Standard Arabic',
  value: AITranslateLanguage.Standard_Arabic,
}, {
  label: 'Simplified Chinese',
  value: AITranslateLanguage.Simplified_Chinese,
}];