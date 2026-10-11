import { useCallback, useMemo, useRef, useState } from 'react';

import { TemplateService } from '@/application/services/domains';
import { Template, TemplateCategory, TemplateCreator, TemplateSummary } from '@/application/template.type';
import { notify } from '@/components/_shared/notify';

export function useLoadCategoryTemplates () {
  const [loading, setLoading] = useState(false);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  const loadCategoryTemplates = useCallback(async (categoryId: string, nameContains?: string) => {
    try {
      setLoading(true);
      const data = await TemplateService.getAll({ categoryId, nameContains });

      if (!data) throw new Error('Failed to fetch templates');
      setTemplates(data);
    } catch (error) {
      notify.error('Failed to fetch ${categoryId} templates');
      return Promise.reject(error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    templates,
    loadCategoryTemplates,
    loading,
  };

}

export function useLoadTemplate (id: string) {
  const [loading, setLoading] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const latestLoad = useRef(0);
  const loadTemplate = useCallback(async () => {
    const request = ++latestLoad.current;

    try {
      setLoading(true);
      const data = await TemplateService.getById(id);

      if (!data || request !== latestLoad.current) return;
      setTemplate(data);
    } catch (error) {
      // don't show error notification
    } finally {
      if (request === latestLoad.current) setLoading(false);
    }
  }, [id]);

  return {
    template,
    loadTemplate,
    loading,
  };
}

export function useLoadCategories (props?: {
  searchText?: string;
}) {
  const searchText = props?.searchText || '';
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await TemplateService.getCategories();

      if (!data) throw new Error('Failed to fetch categories');
      setCategories(data);
      return data;
    } catch (error) {
      notify.error('Failed to fetch categories');
      return Promise.reject(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredCategories = useMemo(() => categories.filter((category) => {
    return searchText ? category.name.toLowerCase().includes(searchText.toLowerCase()) : true;
  }), [categories, searchText]);

  return {
    categories: filteredCategories,
    allCategories: categories,
    loadCategories,
    loading,
  };
}

export function useLoadCreators ({
  searchText,
}: {
  searchText: string;
}) {
  const [loading, setLoading] = useState(false);
  const [creators, setCreators] = useState<TemplateCreator[]>([]);
  const loadCreators = useCallback(async () => {
    try {
      setLoading(true);
      const data = await TemplateService.getCreators();

      if (!data) throw new Error('Failed to fetch creators');
      setCreators(data);
    } catch (error) {
      notify.error('Failed to fetch creators');
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredCreators = useMemo(() => creators.filter((creator) => {
    return creator.name.toLowerCase().includes(searchText.toLowerCase());
  }), [creators, searchText]);

  return {
    creators: filteredCreators,
    loadCreators,
    loading,
  };
}
