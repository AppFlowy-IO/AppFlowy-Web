import type { HTMLAttributes } from 'react';

/** Read-only code surface for document presentations. */
export function CodeBlockFrame({ children, className = '', ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      {...props}
      spellCheck={false}
      className={`appflowy-scroller relative flex w-full flex-col overflow-auto rounded-[8px] border border-border-primary bg-fill-list-active p-5 pt-12 ${className}`}
    >
      {children}
    </pre>
  );
}
