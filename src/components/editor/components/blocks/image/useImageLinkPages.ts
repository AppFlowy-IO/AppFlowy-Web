import { useEffect, useMemo, useState } from 'react';

import { MentionTargetKind, UIVariant, View, ViewLayout } from '@/application/types';
import { isDatabaseLayout, isEmbeddedView, isSpaceView } from '@/application/view-utils';
import { useEditorContext } from '@/components/editor/EditorContext';

export type ImageLinkPage = Pick<View, 'view_id' | 'name' | 'icon' | 'layout'>;

function pageViews(views: View[], currentViewId: string, recursive = false) {
  const pages = new Map<string, View>();
  const visit = (items: View[]) => {
    for (const view of items) {
      if (view.view_id !== currentViewId && !isSpaceView(view) && !isEmbeddedView(view)) pages.set(view.view_id, view);
      if (recursive && !isDatabaseLayout(view.layout)) visit(view.children || []);
    }
  };

  visit(views);
  return [...pages.values()];
}

/** Desktop parity: five recents, then a debounced workspace-wide page search. */
export function useImageLinkPages(query: string, isURL: boolean) {
  const { loadViews, searchMentions, loadViewMeta, viewId, workspaceId } = useEditorContext();
  const cache = useMemo(() => ({ workspaceId, pages: new Map<string, ImageLinkPage>() }), [workspaceId]);
  const key = JSON.stringify([cache.workspaceId, viewId, query, isURL]);
  const [result, setResult] = useState<{ key: string; pages: ImageLinkPage[]; loading: boolean; failed?: boolean }>();

  useEffect(() => {
    if (isURL) return;
    let cancelled = false;
    const show = (pages: ImageLinkPage[], loading = false, failed = false) => {
      if (!cancelled) setResult({ key, pages, loading, failed });
    };

    const search = async () => {
      try {
        if (!query) {
          const pages = pageViews((await loadViews?.(UIVariant.Recent)) || [], viewId).slice(0, 5);

          if (cancelled) return;
          pages.forEach((page) => cache.pages.set(page.view_id, page));
          show(pages);
          return;
        }

        if (!searchMentions) {
          const pages = pageViews((await loadViews?.()) || [], viewId, true);

          show(pages.filter((page) => page.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 10));
          return;
        }

        const response = await searchMentions({
          query,
          limit: 11,
          include: [MentionTargetKind.Page, MentionTargetKind.Database],
          context: { view_id: viewId },
        });

        if (cancelled) return;
        const pages = new Map<string, ImageLinkPage>();

        for (const item of response.sections.flatMap((section) => section.items)) {
          const id =
            item.mention.type === MentionTargetKind.Page
              ? item.mention.page_id
              : item.mention.type === MentionTargetKind.Database
              ? item.mention.database_view_id || item.database_view_id
              : undefined;

          if (!id || id === viewId || item.can_access_context === false) continue;
          pages.set(id, {
            view_id: id,
            name: item.title,
            icon: cache.pages.get(id)?.icon || null,
            layout:
              cache.pages.get(id)?.layout ??
              (item.kind === MentionTargetKind.Database ? ViewLayout.Grid : ViewLayout.Document),
          });
        }

        const matches = [...pages.values()].slice(0, 10);

        show(matches);
        if (!loadViewMeta) return;
        // Results appear immediately; cached metadata supplies the actual
        // emoji/icon/layout without delaying the first search results.
        const enriched = await Promise.all(
          matches.map(async (page) => {
            try {
              const meta = await loadViewMeta(page.view_id);

              if (!meta) return page;
              if (isSpaceView(meta) || isEmbeddedView(meta)) return null;
              if (!cancelled) cache.pages.set(meta.view_id, meta);
              return meta;
            } catch {
              return page;
            }
          })
        );

        show(enriched.filter((page): page is ImageLinkPage => page !== null));
      } catch {
        show([], false, true);
      }
    };

    show([], true);
    const timer = window.setTimeout(
      () => {
        void search();
      },
      query ? 180 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cache, isURL, key, loadViewMeta, loadViews, query, searchMentions, viewId]);

  if (isURL) return { pages: [], loading: false, failed: false };
  return result?.key === key ? result : { pages: [], loading: true, failed: false };
}
