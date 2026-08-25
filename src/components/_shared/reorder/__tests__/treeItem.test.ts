import {
  moveIdAfterPrevious,
  resolveTreeMoveDestination,
  type ActionableTreeInstruction,
} from '@/components/_shared/reorder/treeItem';

function instruction(type: ActionableTreeInstruction['type']): ActionableTreeInstruction {
  return { type, currentLevel: 0, indentPerLevel: 16 };
}

describe('sidebar tree move resolution', () => {
  it('appends a page to the target document while excluding the source itself', () => {
    expect(
      resolveTreeMoveDestination({
        instruction: instruction('make-child'),
        sourceId: 'source',
        targetId: 'parent',
        targetParentId: 'space',
        targetSiblingIds: ['source', 'parent'],
        targetChildIds: ['existing-child', 'source'],
      })
    ).toEqual({ parentId: 'parent', prevId: 'existing-child' });
  });

  it('resolves drops above and below a sibling to API previous-view semantics', () => {
    const common = {
      sourceId: 'source',
      targetId: 'target',
      targetParentId: 'destination-parent',
      targetSiblingIds: ['first', 'target', 'last'],
      targetChildIds: [],
    };

    expect(resolveTreeMoveDestination({ ...common, instruction: instruction('reorder-above') })).toEqual({
      parentId: 'destination-parent',
      prevId: 'first',
    });
    expect(resolveTreeMoveDestination({ ...common, instruction: instruction('reorder-below') })).toEqual({
      parentId: 'destination-parent',
      prevId: 'target',
    });
  });

  it('reorders a sibling after the resolved previous view', () => {
    expect(moveIdAfterPrevious(['first', 'source', 'target', 'last'], 'source', 'target')).toEqual({
      nextIds: ['first', 'target', 'source', 'last'],
      fromIndex: 1,
      toIndex: 2,
    });
    expect(moveIdAfterPrevious(['first', 'source'], 'source', null)).toEqual({
      nextIds: ['source', 'first'],
      fromIndex: 1,
      toIndex: 0,
    });
  });
});
