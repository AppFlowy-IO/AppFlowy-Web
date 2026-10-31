import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import MindMapNodePopover from '../MindMapNodePopover';
import { sourceToSnapshot } from '../server-adapter';
import { describeSlideSources } from '../slide-sources';

import { cellId, databaseSource } from './fixtures/database-source';

import type { MapNode } from '../types';

jest.mock('react-zoom-pan-pinch', () => ({ useTransformEffect: jest.fn() }));
const node: MapNode = {
  id: 'topic',
  parentId: 'root',
  label: 'Accepted label',
  summary: 'Accepted summary',
  sourceIds: ['canonical-source'],
};

function Editor({ value = node, onSave }: { value?: MapNode; onSave: (next: MapNode) => Promise<void> }) {
  return (
    <MindMapNodePopover
      container={null}
      node={value}
      sourceNumbers={new Map([['canonical-source', 1]])}
      canDrill={false}
      canParent={false}
      modifierLabel='Ctrl'
      modifierKey='Control'
      onClose={() => undefined}
      onDrill={() => undefined}
      onParent={() => undefined}
      onSource={() => undefined}
      onSave={onSave}
    />
  );
}

test('keeps IDs and evidence while awaiting an accepted node edit', async () => {
  let complete!: () => void;
  const save = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );

  render(<Editor onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit node' }));
  fireEvent.change(screen.getByLabelText('Node label'), { target: { value: '  Edited label  ' } });
  fireEvent.change(screen.getByLabelText('Node summary'), { target: { value: 'Edited summary' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save node' }));
  expect(save).toHaveBeenCalledWith({ ...node, label: 'Edited label', summary: 'Edited summary' });
  expect((screen.getByRole('button', { name: 'Saving…' })).disabled).toBe(true);
  complete();
  await waitFor(() => expect(screen.queryByLabelText('Node label')).toBeNull());
});

test('retains the editable draft and reports a rejected server version', async () => {
  const save = jest.fn().mockRejectedValue(new Error('The map changed. Reopen it to continue.'));

  render(<Editor onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit node' }));
  fireEvent.change(screen.getByLabelText('Node label'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save node' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The map changed. Reopen it to continue.');
  expect((screen.getByLabelText('Node label')).value).toBe('Draft');
  expect(node.label).toBe('Accepted label');
});

test('keeps the root title immutable while allowing a summary edit', async () => {
  const save = jest.fn().mockResolvedValue(undefined);

  render(<Editor value={{ ...node, parentId: null }} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit node' }));
  expect((screen.getByLabelText('Node label')).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Node summary'), { target: { value: 'Root summary' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save node' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...node, parentId: null, summary: 'Root summary' }));
});

test('shows readable database evidence on hover and passes the canonical citation on click', async () => {
  const onSource = jest.fn();

  render(<MindMapNodePopover
    container={null} node={{ ...node, sourceIds: [cellId] }} sourceNumbers={new Map([[cellId, 28]])}
    sourceDetails={describeSlideSources(sourceToSnapshot(databaseSource))}
    canDrill={false} canParent={false} modifierLabel='Ctrl' modifierKey='Control'
    onClose={jest.fn()} onDrill={jest.fn()} onParent={jest.fn()} onSource={onSource}
  />);
  const button = screen.getByRole('button', { name: 'Open source 28: LLM Experiments · v4 Hard examples › Passing answers' });

  fireEvent.mouseOver(button);
  const tooltip = await screen.findByRole('tooltip');

  expect(tooltip.textContent).toContain('LLM Experiments');
  expect(tooltip.textContent).toContain('v4 Hard examples');
  expect(tooltip.textContent).toContain('88');
  expect(tooltip.textContent).not.toContain(cellId);
  expect(screen.getByRole('button', { name: 'Open source 28: LLM Experiments · v4 Hard examples › Passing answers' })).toBe(button);
  fireEvent.click(button);
  expect(onSource).toHaveBeenCalledWith(cellId);
});
