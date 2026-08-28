import { forwardRef, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { EditorElementProps, ToggleListNode } from '@/components/editor/editor.type';

export const ToggleList = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ToggleListNode>>(({ node, children, ...attributes }, ref) => {
    const blockId = node.blockId;
    const editor = useSlateStatic() as YjsEditor;
    const { collapsed, level = 0 } = useMemo(() => node.data || {}, [node.data]);
    const { t } = useTranslation();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    const className = useMemo(() => {
      const classList = ['flex w-full flex-col'];

      if (attributes.className) {
        classList.push(attributes.className);
      }

      if (collapsed) {
        classList.push('collapsed');
      }

      if (level) {
        classList.push(`toggle-heading level-${level}`);
      }

      return classList.join(' ');
    }, [collapsed, level, attributes.className]);

    return (
      <>
        <div {...attributes} ref={ref} className={className} id={level ? `heading-${blockId}` : undefined}>
          {children}
          {!readOnly && !collapsed && node.children.length <= 1 && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                CustomEditor.addChildBlock(editor, blockId, BlockType.Paragraph, {});
              }}
              data-testid={'toggle-list-empty'}
              contentEditable={false}
              className={
                'ml-[1.45em] flex h-[36px] cursor-pointer select-none items-center rounded-[6px] px-[0.5em] text-sm text-text-secondary hover:bg-fill-content-hover'
              }
            >
              {level === 0
                ? t('document.plugins.emptyToggleList')
                : t('document.plugins.emptyToggleHeadingWeb', { level })}
            </div>
          )}
        </div>
      </>
    );
  })
);

export default ToggleList;
