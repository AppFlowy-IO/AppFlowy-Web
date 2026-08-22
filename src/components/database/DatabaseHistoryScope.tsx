import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

export function DatabaseHistoryScope({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { readOnly } = useDatabaseContext();
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const pointerOwnershipRef = useRef<boolean | null>(null);
  const [hasDatabaseFocus, setHasDatabaseFocus] = useState(false);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const isInside = Boolean(scopeRef.current && target instanceof Node && scopeRef.current.contains(target));

      pointerOwnershipRef.current = isInside;
      setHasDatabaseFocus(isInside);
      queueMicrotask(() => {
        pointerOwnershipRef.current = null;
      });
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  useDatabaseRowHistoryHotkeys(undefined, {
    enabled: hasDatabaseFocus && !readOnly,
    ignoreInput: true,
    useLatest: true,
  });

  return (
    <div
      ref={scopeRef}
      className={className}
      style={style}
      onFocusCapture={() => setHasDatabaseFocus(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;

        // pointerdown precedes blur. When an in-scope pointer targets a
        // non-focusable card/surface, blur reports body/null; keep the pointer
        // ownership selected above instead of immediately clearing it.
        if (pointerOwnershipRef.current === true) return;

        if (!scopeRef.current || !(nextTarget instanceof Node) || !scopeRef.current.contains(nextTarget)) {
          setHasDatabaseFocus(false);
        }
      }}
    >
      {children}
    </div>
  );
}
