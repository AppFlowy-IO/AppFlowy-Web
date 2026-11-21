import { NIL, validate as isUuid } from 'uuid';

import { parseAppFlowyPageLink } from '@/utils/url';

/** Route rendered page links through the current workspace's normal view authorization. */
function pageInWorkspace(link: string, workspace: string): string | undefined {
  if (link.startsWith('appflowy-flutter://open-page/')) {
    const [ws, view, extra] = link.slice('appflowy-flutter://open-page/'.length).split('/');

    return ws === workspace && isUuid(view) && view !== NIL && extra === undefined ? view : undefined;
  }

  const page = parseAppFlowyPageLink(link, window.location.hostname);

  return page?.workspaceId === workspace && !page.rowId && !page.blockId ? page.viewId : undefined;
}

export function AutomationMessage({
  message,
  workspace,
  openPage,
}: {
  message: string;
  workspace: string;
  openPage: (view: string) => Promise<void>;
}) {
  const segments = message.split(/((?:https?:\/\/|appflowy-flutter:\/\/open-page\/)[^\s()]+)/g);

  return (
    <div className='mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-text-primary'>
      {segments.map((text, index) => {
        if (index % 2 === 0) return text;
        const view = pageInWorkspace(text, workspace);

        if (!view) return text;
        return (
          <a
            key={index}
            className='text-text-action underline'
            href={'/app/' + workspace + '/' + view}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              void openPage(view);
            }}
          >
            {text}
          </a>
        );
      })}
    </div>
  );
}
