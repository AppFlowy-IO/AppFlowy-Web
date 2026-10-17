import { useEffect, useRef, useState } from 'react';

/** Portaled menus must not count as hovering the page header that owns them. */
export function useHeaderHover() {
  const ref = useRef<HTMLDivElement>(null);
  const [isHover, setIsHover] = useState(false);

  useEffect(() => {
    const element = ref.current;
    const enter = () => setIsHover(true);
    const leave = () => setIsHover(false);

    element?.addEventListener('mouseenter', enter);
    element?.addEventListener('mouseleave', leave);
    return () => {
      element?.removeEventListener('mouseenter', enter);
      element?.removeEventListener('mouseleave', leave);
    };
  }, []);

  return { ref, isHover };
}
