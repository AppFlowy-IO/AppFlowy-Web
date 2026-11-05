import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TemplateService } from '@/application/services/domains';
import { Template, TemplateCategoryType, TemplateIcon } from '@/application/template.type';
import TemplatePanel from '@/components/app/share/TemplatePanel';
import { copyTextToClipboard } from '@/utils/copy';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ TemplateService: { getById: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (viewId: string) => ({ view_id: viewId, name: 'Template' }),
}));
jest.mock('@/components/app/share/publish.hooks', () => ({
  useLoadPublishInfo: () => ({ url: 'https://example.com/published' }),
}));
jest.mock('@/components/as-template/AsTemplateButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/as-template/DeleteTemplate', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn() } }));
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: jest.fn().mockResolvedValue(undefined) }));

const categories = [
  { id: 'docs', name: 'Docs' },
  { id: 'engineering', name: 'Engineering' },
].map((category) => ({
  ...category,
  icon: TemplateIcon.docs,
  bg_color: '#eee',
  description: '',
  category_type: TemplateCategoryType.ByUseCase,
  priority: 0,
}));

function template(overrides: Partial<Template>): Template {
  return {
    view_id: 'template-id',
    name: 'Template',
    description: '',
    about: '',
    view_url: 'https://example.com/published',
    creator: { id: 'creator', name: 'Creator', avatar_url: '' },
    categories,
    primary_category_id: 'engineering',
    is_new_template: false,
    is_featured: false,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

it.each([
  { order: 'alphabetical', categories },
  { order: 'reversed', categories: [...categories].reverse() },
])(
  'displays and copies the saved primary category URL with $order categories',
  async ({ categories: orderedCategories }) => {
    jest.mocked(TemplateService.getById).mockResolvedValue(template({ categories: orderedCategories }));
    render(<TemplatePanel viewId='template-id' />);

    const url = `${window.location.origin}/templates/engineering/template-id`;

    await screen.findByDisplayValue(url);
    fireEvent.click(screen.getByRole('button', { name: 'grid.url.copy' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(url));
  }
);

it.each([undefined, null, 'deleted'])('uses the alphabetical fallback when the primary category is %s', async (primary) => {
  jest.mocked(TemplateService.getById).mockResolvedValue(
    template({ categories: [...categories].reverse(), primary_category_id: primary })
  );
  render(<TemplatePanel viewId='template-id' />);

  const url = `${window.location.origin}/templates/docs/template-id`;

  await screen.findByDisplayValue(url);
  fireEvent.click(screen.getByRole('button', { name: 'grid.url.copy' }));
  await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(url));
});

it('does not invent a template URL when no categories remain', async () => {
  jest.mocked(TemplateService.getById).mockResolvedValue(template({ categories: [] }));
  render(<TemplatePanel viewId='template-id' />);

  const input = await screen.findByRole<HTMLInputElement>('textbox');

  expect(input.value).toBe('');
});
