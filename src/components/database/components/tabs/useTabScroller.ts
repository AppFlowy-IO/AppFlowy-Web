import { useCallback, useEffect, useState } from 'react';

export const useTabScroller = () => {
    const [scrollerContainer, setScrollerContainer] = useState<HTMLDivElement | null>(null);
    const [showScrollRightButton, setShowScrollRightButton] = useState(false);
    const [showScrollLeftButton, setShowScrollLeftButton] = useState(false);

    const handleObserverScroller = useCallback(() => {
        if (scrollerContainer) {
            const scrollWidth = scrollerContainer.scrollWidth;
            const clientWidth = scrollerContainer.clientWidth;

            setShowScrollRightButton(
                scrollWidth > clientWidth && scrollerContainer.scrollLeft + 1 < scrollWidth - clientWidth
            );
            setShowScrollLeftButton(scrollerContainer.scrollLeft > 5);
        }
    }, [scrollerContainer]);

    useEffect(() => {
        if (!scrollerContainer) return;
        const onResize = () => {
            handleObserverScroller();
        };

        // Initial call
        onResize();

        const observer = new ResizeObserver(onResize);

        observer.observe(scrollerContainer);

        return () => {
            observer.disconnect();
        };
    }, [handleObserverScroller, scrollerContainer]);

    const scrollLeft = useCallback(() => {
        if (scrollerContainer) {
            scrollerContainer.scrollTo({
                left: scrollerContainer.scrollLeft - 200,
                behavior: 'smooth',
            });
        }
    }, [scrollerContainer]);

    const scrollRight = useCallback(() => {
        if (scrollerContainer) {
            scrollerContainer.scrollTo({
                left: scrollerContainer.scrollLeft + 200,
                behavior: 'smooth',
            });
        }
    }, [scrollerContainer]);

    return {
        setScrollerContainer,
        showScrollLeftButton,
        showScrollRightButton,
        scrollLeft,
        scrollRight,
        handleObserverScroller,
    };
};

