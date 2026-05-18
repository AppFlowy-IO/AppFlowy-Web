import { Inbox } from 'lucide-react';
import { useMemo } from 'react';

import { useDatabase , useDatabaseContext } from '@/application/database-yjs/context';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Toolbar button that jumps to the form's "responses" surface — the
 * sibling Grid view that displays every submission as a row. Mirrors
 * the desktop's "Responses" tab convention: a form view never shows
 * the data inline (the form itself only displays authoring chrome),
 * so the canonical way to inspect submissions is to switch to the
 * Grid tab the desktop creates alongside every form (`make_default_form`
 * seeds both).
 *
 * F1 scope: no submission-count badge. The cloud's
 * `list_form_submissions` endpoint pages with cursor + limit, no
 * dedicated COUNT(*) endpoint exists. Surfacing an exact total
 * would need either a full pagination walk (slow) or a new biz
 * endpoint — both deferred. The Grid view itself shows row count
 * once the user clicks through.
 *
 * Renders disabled with a tooltip when no Grid sibling exists — that
 * happens when a form was added via the web tab-bar (which doesn't
 * auto-create a Responses tab) without a Grid being present.
 */
export function FormSubmissionsLink() {
  const database = useDatabase();
  const { navigateToView } = useDatabaseContext();

  // Find the first sibling Grid view. We don't require it to be named
  // "Responses" — any Grid tab counts. The desktop's seed names it
  // "Responses" but a user might have renamed it.
  const gridViewId = useMemo(() => {
    const views = database?.get(YjsDatabaseKey.views);

    if (!views) return undefined;
    let found: string | undefined;

    views.forEach((view, viewId) => {
      if (found) return;
      if (typeof viewId !== 'string') return;
      const layout = Number(view.get(YjsDatabaseKey.layout));

      if (layout === DatabaseViewLayout.Grid) {
        found = viewId;
      }
    });
    return found;
  }, [database]);

  if (!gridViewId || !navigateToView) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant='ghost' size='sm' className='gap-1' disabled>
              <Inbox size={14} />
              View responses
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Add a Grid view to this database to see form responses.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant='ghost'
      size='sm'
      className='gap-1'
      onClick={() => void navigateToView(gridViewId)}
    >
      <Inbox size={14} />
      View responses
    </Button>
  );
}
