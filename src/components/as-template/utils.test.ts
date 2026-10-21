import { expect, test } from '@jest/globals';

import { TemplateCategoryType, TemplateIcon } from '@/application/template.type';

import { getTemplatePath } from './utils';

const categories = [
  { id: 'docs', name: 'Docs' },
  { id: 'engineering', name: 'Engineering' },
].map((category) => ({
  ...category, icon: TemplateIcon.docs, bg_color: '#eee', description: '',
  category_type: TemplateCategoryType.ByUseCase, priority: 0,
}));

test('shared links and editor preview prefer the saved primary regardless of category ordering', () => {
  for (const values of [categories, [...categories].reverse()]) {
    expect(getTemplatePath({ view_id: 'template-id', categories: values, primary_category_id: 'engineering' }))
      .toBe('/templates/engineering/template-id');
  }
});

test('legacy and invalid primary categories use the same alphabetical fallback as the website', () => {
  for (const primary of [undefined, null, 'deleted']) {
    expect(getTemplatePath({ view_id: 'template-id', categories: [...categories].reverse(), primary_category_id: primary }))
      .toBe('/templates/docs/template-id');
  }
});

test('templates without categories have no template URL', () => {
  expect(getTemplatePath({ view_id: 'template-id', categories: [] })).toBe('');
});
