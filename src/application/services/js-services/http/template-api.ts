import {
  Template,
  TemplateCategory,
  TemplateCategoryFormValues,
  TemplateCreator,
  TemplateCreatorFormValues,
  TemplateSummary,
  UploadTemplatePayload,
} from '@/application/template.type';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function createTemplate(template: UploadTemplatePayload) {
  const url = '/api/template-center/template';

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, template)
  );
}

export async function updateTemplate(viewId: string, template: UploadTemplatePayload) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, template)
  );
}

export async function getTemplates({ categoryId, nameContains }: { categoryId?: string; nameContains?: string }) {
  const url = `/api/template-center/template`;

  return executeAPIRequest<{ templates: TemplateSummary[] }>(() =>
    getAxios()?.get<APIResponse<{ templates: TemplateSummary[] }>>(url, {
      params: {
        category_id: categoryId,
        name_contains: nameContains,
      },
    })
  ).then((data) => data.templates);
}

export async function getTemplateById(viewId: string) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIRequest<Template>(() =>
    getAxios()?.get<APIResponse<Template>>(url)
  );
}

export async function deleteTemplate(viewId: string) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url)
  );
}

export async function getTemplateCategories() {
  const url = '/api/template-center/category';

  return executeAPIRequest<{ categories: TemplateCategory[] }>(() =>
    getAxios()?.get<APIResponse<{ categories: TemplateCategory[] }>>(url)
  ).then((data) => data.categories);
}

export async function addTemplateCategory(category: TemplateCategoryFormValues) {
  const url = '/api/template-center/category';

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, category)
  );
}

export async function updateTemplateCategory(id: string, category: TemplateCategoryFormValues) {
  const url = `/api/template-center/category/${id}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, category)
  );
}

export async function deleteTemplateCategory(categoryId: string) {
  const url = `/api/template-center/category/${categoryId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url)
  );
}

export async function getTemplateCreators() {
  const url = '/api/template-center/creator';

  return executeAPIRequest<{ creators: TemplateCreator[] }>(() =>
    getAxios()?.get<APIResponse<{ creators: TemplateCreator[] }>>(url)
  ).then((data) => data.creators);
}

export async function createTemplateCreator(creator: TemplateCreatorFormValues) {
  const url = '/api/template-center/creator';

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, creator)
  );
}

export async function updateTemplateCreator(creatorId: string, creator: TemplateCreatorFormValues) {
  const url = `/api/template-center/creator/${creatorId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, creator)
  );
}

export async function deleteTemplateCreator(creatorId: string) {
  const url = `/api/template-center/creator/${creatorId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url)
  );
}

export async function uploadTemplateAvatar(file: File) {
  const url = '/api/template-center/avatar';
  const formData = new FormData();

  formData.append('avatar', file);

  const data = await executeAPIRequest<{ file_id: string }>(() =>
    getAxios()?.request<APIResponse<{ file_id: string }>>({
      method: 'PUT',
      url,
      data: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  );

  return getAxios()?.defaults.baseURL + '/api/template-center/avatar/' + data.file_id;
}
