import { useCallback, useMemo } from 'react';
import { createEditor } from 'slate';
import { Slate, withReact } from 'slate-react';

import { ERROR_CODE } from '@/application/constants';
import { ViewMetadataError } from '@/application/errors/view-metadata-error';
import { LoadViewMeta, MentionType, View, ViewLayout } from '@/application/types';
import { EditorContext } from '@/components/editor/EditorContext';

import MentionPage from './MentionPage';

import type { Meta, StoryObj } from '@storybook/react-vite';

import '@/components/editor/editor.scss';
import '../inline-leaf.scss';

type Outcome = 'available' | 'missing' | 'inTrash' | 'deleted' | 'denied' | 'unauthorized' | 'temporaryFailure';

const view: View = {
  view_id: 'referenced-page',
  name: 'Backlog',
  icon: { ty: 0, value: '📋' },
  layout: ViewLayout.Grid,
  children: [],
  extra: null,
  is_private: false,
  is_published: false,
};

function ReferenceExample({ outcome }: { outcome: Outcome }) {
  const editor = useMemo(() => withReact(createEditor()), []);
  const loadViewMeta = useCallback<LoadViewMeta>(async (_pageId, _callback, options) => {
    if (outcome === 'available' || (outcome === 'temporaryFailure' && options?.authoritative)) return view;
    if (outcome === 'inTrash') throw new ViewMetadataError('in_trash');

    const code = {
      available: 0,
      missing: ERROR_CODE.RECORD_NOT_FOUND,
      inTrash: 0,
      deleted: ERROR_CODE.RECORD_DELETED,
      denied: ERROR_CODE.NOT_HAS_PERMISSION,
      unauthorized: ERROR_CODE.USER_UNAUTHORIZED,
      temporaryFailure: ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE,
    }[outcome];

    return Promise.reject({ code, sourceDomain: 'appflowy.server', httpStatus: 200 });
  }, [outcome]);

  return (
    <Slate editor={editor} initialValue={[{ children: [{ text: '' }] }]}>
      <EditorContext.Provider value={{ workspaceId: 'preview-workspace', viewId: 'preview-page', readOnly: true, loadViewMeta }}>
        <div className={'appflowy-editor'}>
          <MentionPage pageId={view.view_id} text={{ text: '@' }} type={MentionType.PageRef} />
        </div>
      </EditorContext.Provider>
    </Slate>
  );
}

const meta = {
  title: 'Editor/Page references',
  component: ReferenceExample,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ReferenceExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = { args: { outcome: 'available' } };
export const Missing: Story = { args: { outcome: 'missing' } };
export const InTrash: Story = { args: { outcome: 'inTrash' } };
export const Deleted: Story = { args: { outcome: 'deleted' } };
export const Denied: Story = { args: { outcome: 'denied' } };
export const SignInRequired: Story = { args: { outcome: 'unauthorized' } };
export const Retry: Story = { args: { outcome: 'temporaryFailure' } };

export const AllStates: Story = {
  args: { outcome: 'available' },
  render: () => (
    <div className={'mx-auto max-w-xl space-y-6 p-8 text-lg'}>
      {(['available', 'missing', 'inTrash', 'deleted', 'denied', 'unauthorized', 'temporaryFailure'] as const).map((outcome) => (
        <ReferenceExample key={outcome} outcome={outcome} />
      ))}
    </div>
  ),
};
