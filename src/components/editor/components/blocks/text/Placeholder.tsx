import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Element, Range } from 'slate';
import { ReactEditor, useFocused, useSelected, useSlate } from 'slate-react';

import { BlockType, ToggleListBlockData } from '@/application/types';
import { HeadingNode, ToggleListNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';

import { usePlaceholderOverride } from './PlaceholderContext';

function Placeholder({ node, ...attributes }: { node: Element; className?: string; style?: CSSProperties }) {
  const { t } = useTranslation();
  const { readOnly, slashPlaceholder } = useEditorContext();
  const editor = useSlate();
  const focused = useFocused();
  const blockSelected = useSelected();
  const [isComposing, setIsComposing] = useState(false);
  const selected = focused && blockSelected && editor.selection && Range.isCollapsed(editor.selection);

  // Get placeholder override from context (if a container provides one)
  const placeholderOverride = usePlaceholderOverride();

  const getBlock = useCallback(() => {
    const path = ReactEditor.findPath(editor, node);
    const match = Editor.above(editor, {
      match: (n) => {
        return !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined && n.type !== undefined;
      },
      at: path,
    });

    if(!match) return null;

    return match[0] as Element;
  }, [editor, node]);

  const block = getBlock();

  // Check if this is the first child of the parent block (generic, no block-type knowledge)
  const isFirstChildOfParent = useMemo(() => {
    try {
      const path = ReactEditor.findPath(editor, node);
      const blockMatch = Editor.above(editor, {
        at: path,
        match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined,
      });

      if (!blockMatch) return true;

      const [, blockPath] = blockMatch;

      return blockPath[blockPath.length - 1] === 0;
    } catch {
      return true;
    }
  }, [editor, node]);

  const className = useMemo(() => {
    const classList = attributes.className?.split(' ') ?? [];

    classList.push('text-placeholder select-none w-full');

    return classList.join(' ');
  }, [attributes.className]);

  const unSelectedPlaceholder = useMemo(() => {
    // Check context override first (from parent container)
    if (placeholderOverride) {
      if (placeholderOverride.onlyFirstChild && !isFirstChildOfParent) {
        return '';
      }

      return placeholderOverride.unselected ?? '';
    }

    switch(block?.type) {
      case BlockType.Paragraph: {
        return '';
      }

      case BlockType.ToggleListBlock: {
        const level = (block as ToggleListNode).data.level;

        switch(level) {
          case 1:
            return t('editor.mobileHeading1');
          case 2:
            return t('editor.mobileHeading2');
          case 3:
            return t('editor.mobileHeading3');
          case 4:
            return t('editor.mobileHeading4');
          case 5:
            return t('editor.mobileHeading5');
          case 6:
            return t('editor.mobileHeading6');
          default:
            return t('blockPlaceholders.bulletList');
        }
      }

      case BlockType.QuoteBlock:
        return t('blockPlaceholders.quote');
      case BlockType.TodoListBlock:
        return t('blockPlaceholders.todoList');
      case BlockType.NumberedListBlock:
        return t('blockPlaceholders.numberList');
      case BlockType.BulletedListBlock:
        return t('blockPlaceholders.bulletList');
      case BlockType.HeadingBlock: {
        const level = (block as HeadingNode).data.level;

        switch(level) {
          case 1:
            return t('editor.mobileHeading1');
          case 2:
            return t('editor.mobileHeading2');
          case 3:
            return t('editor.mobileHeading3');
          case 4:
            return t('editor.mobileHeading4');
          case 5:
            return t('editor.mobileHeading5');
          case 6:
            return t('editor.mobileHeading6');
          default:
            return '';
        }
      }

      case BlockType.CodeBlock:
        return t('editor.typeSomething');
      default:
        return '';
    }
  }, [block, isFirstChildOfParent, placeholderOverride, t]);

  const selectedPlaceholder = useMemo(() => {
    // Check context override first (from parent container)
    if (placeholderOverride) {
      if (placeholderOverride.onlyFirstChild && !isFirstChildOfParent) {
        return '';
      }

      return placeholderOverride.selected ?? placeholderOverride.unselected ?? '';
    }

    if(block?.type === BlockType.ToggleListBlock && (block?.data as ToggleListBlockData).level) {
      return unSelectedPlaceholder;
    }

    switch(block?.type) {
      case BlockType.HeadingBlock:
        return unSelectedPlaceholder;
      case  BlockType.ToggleListBlock:
      case  BlockType.TodoListBlock:
      case  BlockType.Paragraph:
      case  BlockType.QuoteBlock:
      case  BlockType.BulletedListBlock:
      case  BlockType.NumberedListBlock:
        return slashPlaceholder ?? t('editor.slashPlaceHolder');

      default:
        return '';
    }
  }, [block?.data, block?.type, isFirstChildOfParent, placeholderOverride, t, unSelectedPlaceholder, slashPlaceholder]);

  useEffect(() => {
    if(!selected) return;

    const handleCompositionStart = () => {
      setIsComposing(true);
    };

    const handleCompositionEnd = () => {
      setIsComposing(false);
    };

    const editorDom = ReactEditor.toDOMNode(editor, editor);

    // placeholder should be hidden when composing
    editorDom.addEventListener('compositionstart', handleCompositionStart);
    editorDom.addEventListener('compositionend', handleCompositionEnd);
    editorDom.addEventListener('compositionupdate', handleCompositionStart);
    return () => {
      editorDom.removeEventListener('compositionstart', handleCompositionStart);
      editorDom.removeEventListener('compositionend', handleCompositionEnd);
      editorDom.removeEventListener('compositionupdate', handleCompositionStart);
    };
  }, [editor, selected]);

  if(isComposing) {
    return null;
  }

  return (
    <span
      data-placeholder={selected && !readOnly ? selectedPlaceholder : unSelectedPlaceholder}
      contentEditable={false}
      {...attributes}
      className={className}
    />
  );
}

export default Placeholder;
