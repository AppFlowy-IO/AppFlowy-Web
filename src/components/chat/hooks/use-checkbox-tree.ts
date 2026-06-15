import { useCallback, useEffect, useRef, useState } from 'react';

import { findAncestors } from '@/components/chat/lib/views';
import { View } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';

export const useCheckboxTree = (initialSelected: string[] = [], source: View[]) => {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected),
  );

  const initialExpandViewIds = useRef(new Set<string>());

  useEffect(() => {
    setSelected(new Set(initialSelected));
  }, [initialSelected]);

  useEffect(() => {

    initialSelected.forEach(id => {
      findAncestors(source, id)?.forEach(ancestor => {
        initialExpandViewIds.current.add(ancestor.view_id);
      });
    });

  }, [source, initialSelected]);

  // Get all descendant IDs of a view
  const getDescendantIds = useCallback((view: View): string[] => {
    const ids: string[] = [view.view_id];

    view.children.forEach(child => {
      ids.push(...getDescendantIds(child));
    });
    return ids;
  }, []);

  // Get the check status of a view
  const getCheckStatus = useCallback((view: View): CheckStatus => {
    const isCurrentSelected = selected.has(view.view_id);

    if(view.children.length === 0) {
      return isCurrentSelected ? CheckStatus.Checked : CheckStatus.Unchecked;
    }

    const childrenStatuses = view.children.map(child =>
      getCheckStatus(child),
    );

    // if(childrenStatuses.every(status => status === 'unchecked')) {
    //   if(isCurrentSelected) {
    //     setSelected(prev => {
    //       const next = new Set(prev);
    //       next.delete(view.view_id);
    //       return next;
    //     });
    //   }
    //   return CheckStatus.Unchecked;
    // }
    if(!isCurrentSelected) {
      return CheckStatus.Unchecked;
    }

    if(childrenStatuses.every(status => status === 'checked')) {
      return CheckStatus.Checked;
    }

    return CheckStatus.Indeterminate;
  }, [selected]);

  const toggleNode = useCallback((view: View) => {
    const status = getCheckStatus(view);
    const descendantIds = getDescendantIds(view);

    const next = new Set(selected);

    if(status === CheckStatus.Checked) {
      descendantIds.forEach(id => next.delete(id));
    } else {
      descendantIds.forEach(id => next.add(id));
    }

    setSelected(next);
    return next;
  }, [getCheckStatus, getDescendantIds, selected]);

  const selectAll = useCallback((views: View[]) => {
    setSelected(prev => {
      const next = new Set(prev);

      views.forEach(view => {
        getDescendantIds(view).forEach(id => next.add(id));
      });
      return next;
    });
  }, [getDescendantIds]);

  const unselectAll = useCallback((views: View[]) => {
    setSelected(prev => {
      const next = new Set(prev);

      views.forEach(view => {
        getDescendantIds(view).forEach(id => next.delete(id));
      });
      return next;
    });
  }, [getDescendantIds]);

  const getSelected = useCallback(() => {
    return Array.from(selected);
  }, [selected]);

  const getInitialExpand = useCallback((id: string) => {
    return initialExpandViewIds.current.has(id);
  }, []);

  return {
    selected,
    getCheckStatus,
    getInitialExpand,
    toggleNode,
    selectAll,
    unselectAll,
    getSelected,
  };
};