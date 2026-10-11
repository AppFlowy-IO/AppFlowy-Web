import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Template, UploadTemplatePayload } from '@/application/template.type';
import { TemplateCategoryType, TemplateIcon } from '@/application/template.type';

import AsTemplate from './AsTemplate';

import type { ReactNode } from 'react';

let mockTemplate: Template | null = null;
const mockLoadTemplate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockCreate = jest.fn<(payload: UploadTemplatePayload) => Promise<void>>().mockResolvedValue(undefined);
const mockUpdate = jest.fn<(id: string, payload: UploadTemplatePayload) => Promise<void>>().mockResolvedValue(undefined);
const mockLoadCategories = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockCategories = [
  { id: 'docs', name: 'Docs', icon: TemplateIcon.docs },
  { id: 'engineering', name: 'Engineering', icon: TemplateIcon.engineering },
  { id: 'marketing', name: 'Marketing', icon: TemplateIcon.marketing },
].map((category) => ({
  ...category,
  bg_color: '#ddd',
  description: '',
  category_type: TemplateCategoryType.ByUseCase,
  priority: 0,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; category?: string }) =>
      options?.defaultValue?.replace('{{category}}', options.category ?? '') ?? key,
  }),
}));
jest.mock('@/application/services/domains', () => ({
  TemplateService: { create: (payload: UploadTemplatePayload) => mockCreate(payload), update: (id: string, payload: UploadTemplatePayload) => mockUpdate(id, payload) },
}));
jest.mock('@/components/as-template/hooks', () => ({
  useLoadTemplate: () => ({ template: mockTemplate, loadTemplate: mockLoadTemplate, loading: false }),
  useLoadCategories: ({ searchText = '' }: { searchText?: string }) => ({
    categories: mockCategories.filter((category) => category.name.toLowerCase().includes(searchText.toLowerCase())),
    allCategories: mockCategories,
    loadCategories: mockLoadCategories,
    loading: false,
  }),
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/_shared/scroller', () => ({ AFScroller: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/as-template/DeleteTemplate', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/as-template/related-template/RelatedTemplates', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');

  return { __esModule: true, default: forwardRef<HTMLInputElement>(() => null) };
});
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
}));
jest.mock('@/components/as-template/category/AddCategory', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/as-template/category/CategoryItem', () => ({
  __esModule: true,
  default: ({ category, onClick }: { category: { name: string }; onClick: () => void }) => (
    <button onClick={onClick}>Toggle {category.name} category</button>
  ),
}));
jest.mock('@/components/as-template/creator/Creator', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange('creator')}>Select creator</button>,
}));

beforeEach(() => {
  mockTemplate = null;
  jest.clearAllMocks();
});

function existingTemplate(): Template {
  return {
    view_id: 'template-id',
    name: 'Existing template title',
    description: 'Existing description',
    about: 'Existing about text',
    view_url: 'https://example.com/published',
    creator: { id: 'creator', name: 'Existing creator', avatar_url: 'https://example.com/avatar.png' },
    categories: mockCategories.slice(0, 2),
    primary_category_id: 'engineering',
    related_templates: [{
      view_id: 'related-id',
      name: 'Related template',
      description: 'Related description',
      view_url: 'https://example.com/related',
      creator: { id: 'creator', name: 'Existing creator', avatar_url: 'https://example.com/avatar.png' },
      categories: [mockCategories[0]],
      is_new_template: false,
      is_featured: false,
    }],
    is_new_template: true,
    is_featured: true,
  };
}

function existingPayload(): UploadTemplatePayload {
  return {
    view_id: 'template-id',
    name: 'Existing template title',
    description: 'Existing description',
    about: 'Existing about text',
    view_url: 'https://example.com/published',
    creator_id: 'creator',
    category_ids: ['docs', 'engineering'],
    primary_category_id: 'engineering',
    related_view_ids: ['related-id'],
    is_new_template: true,
    is_featured: true,
  };
}

test('new templates require a selected primary category and include it in the create request', async () => {
  render(<AsTemplate viewId='template-id' viewName='Template' viewUrl='https://example.com/published' />);
  fireEvent.change(screen.getByRole('textbox', { name: /template.description/ }), { target: { value: 'Description' } });
  fireEvent.change(screen.getByRole('textbox', { name: /template.about/ }), { target: { value: 'About' } });
  const search = screen.getByPlaceholderText('template.category.typeToSearch');

  fireEvent.click(search);
  fireEvent.click(screen.getByText('Toggle Docs category'));
  fireEvent.click(screen.getByText('Toggle Engineering category'));
  fireEvent.click(screen.getByText('Select creator'));
  const save = screen.getByRole('button', { name: 'button.save' });

  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use Engineering as primary category' }));
  expect(save.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Use Engineering as primary category' }).textContent).toBe('Engineering (Primary)');
  expect(screen.getByRole('button', { name: 'Use Engineering as primary category' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Use Docs as primary category' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.change(search, { target: { value: 'marketing' } });
  expect(screen.getByRole('button', { name: 'Use Engineering as primary category' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Use Marketing as primary category' })).toBeNull();
  fireEvent.click(save);
  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith(
      {
        view_id: 'template-id',
        name: 'Template',
        description: 'Description',
        about: 'About',
        view_url: 'https://example.com/published',
        creator_id: 'creator',
        category_ids: ['docs', 'engineering'],
        primary_category_id: 'engineering',
        related_view_ids: [],
        is_new_template: false,
        is_featured: false,
      }
    )
  );
});

test('editing preserves the saved primary and requires a replacement when its category is removed', async () => {
  mockTemplate = existingTemplate();
  render(<AsTemplate viewId='template-id' viewName='Template' viewUrl='https://example.com/published' />);
  const save = screen.getByRole('button', { name: 'button.save' });

  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  expect(screen.getByRole('button', { name: 'Use Engineering as primary category' }).textContent).toBe('Engineering (Primary)');
  fireEvent.click(save);
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith(
      'template-id',
      existingPayload()
    )
  );
  fireEvent.click(screen.getByPlaceholderText('template.category.typeToSearch'));
  fireEvent.click(screen.getByText('Toggle Engineering category'));
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Use Engineering as primary category' })).toBeNull();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Primary category' }));
  fireEvent.click(screen.getByRole('option', { name: 'Docs' }));
  expect(screen.getByRole('button', { name: 'Use Docs as primary category' }).textContent).toBe('Docs (Primary)');
  fireEvent.click(save);
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenLastCalledWith(
      'template-id',
      {
        ...existingPayload(),
        category_ids: ['docs'],
        primary_category_id: 'docs',
      }
    )
  );
});

test.each([undefined, null])('assigning a primary to a legacy template (%s) preserves its other metadata', async (primary) => {
  mockTemplate = existingTemplate();
  if (primary === undefined) {
    delete mockTemplate.primary_category_id;
  } else {
    mockTemplate.primary_category_id = primary;
  }

  render(<AsTemplate viewId='template-id' viewName='Fallback title' viewUrl='https://example.com/published' />);
  expect((screen.getByRole('textbox', { name: /template.name/ })).value).toBe('Existing template title');
  expect((screen.getByRole('textbox', { name: /template.description/ })).value).toBe('Existing description');
  expect((screen.getByRole('textbox', { name: /template.about/ })).value).toBe('Existing about text');
  const save = screen.getByRole('button', { name: 'button.save' });

  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use Engineering as primary category' }));
  fireEvent.click(save);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('template-id', existingPayload()));
});
