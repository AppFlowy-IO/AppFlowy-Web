import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function matches() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** Whether the user asked for reduced motion; charts then skip their entry animation (WP10 §2.5). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    const onChange = () => setReduced(query.matches);

    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
