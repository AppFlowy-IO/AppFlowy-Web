import type { TemplateSummary } from '@/application/template.type';

export function slugify (text: string) {
  return text
    .toString() // ensure the text is a string
    .toLowerCase() // make the text lowercase
    .trim() // remove leading and trailing whitespaces
    .replace(/\s+/g, '-') // replace all whitespaces with '-'
    .replace(/[^\w-]+/g, '') // remove all non-word characters
    .replace(/--+/g, '-'); // replace multiple '-' with single '-'
}

export function getTemplatePath(template: Pick<TemplateSummary, 'view_id' | 'categories' | 'primary_category_id'>) {
  const category = template.categories.find((item) => item.id === template.primary_category_id) ??
    [...template.categories].sort((a, b) => a.name.localeCompare(b.name))[0];

  return category ? `/templates/${slugify(category.name)}/${template.view_id}` : '';
}
