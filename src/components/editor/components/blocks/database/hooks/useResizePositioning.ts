import { useEffect, useState } from 'react';
import { Editor, Element } from 'slate';
import { ReactEditor } from 'slate-react';

import { getScrollParent } from '@/components/global-comment/utils';

interface UseResizePositioningProps {
  editor: Editor;
  node: Element;
}

export const useResizePositioning = ({ editor, node }: UseResizePositioningProps) => {
  const [paddingStart, setPaddingStart] = useState(0);
  const [paddingEnd, setPaddingEnd] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const dom = ReactEditor.toDOMNode(editor, node);
    // History previews use `.appflowy-scroller` and may not overflow before the
    // database finishes rendering, so prefer the stable container classes.
    const scrollContainer =
      dom.closest('.appflowy-scroll-container, .appflowy-scroller') || (getScrollParent(dom) as HTMLElement);

    if (!dom || !scrollContainer) return;

    const onResize = () => {
      const rect = scrollContainer.getBoundingClientRect();
      const blockRect = dom.getBoundingClientRect();

      const offsetLeft = blockRect.left - rect.left;
      const offsetRight = rect.right - blockRect.right;

      setWidth(rect.width);
      setPaddingStart(offsetLeft);
      setPaddingEnd(offsetRight);
    };

    onResize();

    const resizeObserver = new ResizeObserver(onResize);

    resizeObserver.observe(scrollContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [editor, node]);

  return {
    paddingStart,
    paddingEnd,
    width,
  };
};
