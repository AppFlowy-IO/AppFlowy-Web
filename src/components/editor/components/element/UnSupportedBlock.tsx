import { Alert } from '@mui/material';
import { forwardRef } from 'react';

import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

export const UnSupportedBlock = forwardRef<HTMLDivElement, EditorElementProps>(({ node, children, className, ...attributes }, ref) => {
  const isDev = import.meta.env.DEV;

  return (
    <div
      ref={ref}
      {...attributes}
      data-testid="unsupported-block"
      className={cn(
        className,
        'my-1 flex w-full select-none items-center gap-2 rounded-lg border border-line-divider bg-fill-list-hover px-3 py-2 text-text-caption'
      )}
      contentEditable={false}
    >
      <WarningIcon className="h-5 w-5 flex-shrink-0 text-function-warning" />
      <span className="text-sm">
        This block type <span className="font-medium text-text-title">&ldquo;{node.type}&rdquo;</span> is not supported yet
      </span>
      {isDev && (
        <details className="ml-auto text-xs">
          <summary className="cursor-pointer text-text-caption hover:text-text-title">Debug</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg-body p-2">
            <code>{JSON.stringify(node, null, 2)}</code>
          </pre>
        </details>
      )}
      {children}
    </div>
  );
});

export const UnSupportedBlockDev = forwardRef<HTMLDivElement, EditorElementProps>(({ node, children }, ref) => {
  return (
    <div className={'w-full select-none'} ref={ref} contentEditable={false}>
      <Alert className={'h-fit w-full'} severity={'warning'}>
        <div className={'text-base font-semibold'}>{`Unsupported Block: ${node.type}`}</div>

        <div className={'my-4 whitespace-pre font-medium'}>
          {`We're sorry for inconvenience \n`}
          Submit an issue on our{' '}
          <a
            className={'text-text-action underline'}
            href={'https://github.com/AppFlowy-IO/AppFlowy/issues/new?template=bug_report.yaml'}
          >
            Github
          </a>{' '}
          page that describes your error
        </div>

        <span className={'text-sm'}>
          <pre>
            <code>{JSON.stringify(node, null, 2)}</code>
          </pre>
        </span>
        {children}
      </Alert>
    </div>
  );
});
