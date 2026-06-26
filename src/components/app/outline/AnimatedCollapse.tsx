import { Collapse } from '@mui/material';
import React, { useEffect, useState } from 'react';

/**
 * A height-animated container for sidebar children.
 *
 * MUI's `Collapse` only plays its enter transition when the content is already
 * in the DOM at the moment `in` flips to `true`. The sidebar lazy-loads
 * children, so on a first expand the content mounts in the *same* commit that
 * opens the section — and `Collapse` snaps open with no animation.
 *
 * This wrapper decouples the two: the caller passes `expanded` once the children
 * are ready (already rendered as `children`), and we flip the underlying `in`
 * on the next animation frame. By then the content has been committed (clipped
 * at height 0), so `Collapse` measures the real height and animates 0 → full —
 * the same path a second expand already takes.
 */
export function AnimatedCollapse({
  expanded,
  className,
  children,
}: {
  expanded: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  // `armed` latches one frame after `expanded` turns true, so the content has a
  // committed height-0 frame before `in` opens. It resets when collapsed so a
  // later re-open (e.g. after children are unloaded and re-fetched) re-defers.
  // `in` itself is derived during render — collapsing is immediate, only the
  // open is deferred.
  const [armed, setArmed] = useState(expanded);

  useEffect(() => {
    if (!expanded) {
      setArmed(false);
      return;
    }

    const id = requestAnimationFrame(() => setArmed(true));

    return () => cancelAnimationFrame(id);
  }, [expanded]);

  return (
    <Collapse in={expanded && armed} className={className}>
      {children}
    </Collapse>
  );
}

export default AnimatedCollapse;
