import { useCallback, useEffect, useRef, useState } from 'react';

import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

interface UseKeyboardNavigationProps {
    itemCount: number;
    onSelect: (index: number) => void;
    onClose: () => void;
    isOpen: boolean;
}

export function useKeyboardNavigation({ itemCount, onSelect, onClose, isOpen }: UseKeyboardNavigationProps) {
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (!isOpen) {
            setSelectedIndex(-1);
            return;
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (createHotkey(HOT_KEY_NAME.UP)(e) || createHotkey(HOT_KEY_NAME.DOWN)(e)) {
                e.preventDefault();
                e.stopPropagation();

                if (createHotkey(HOT_KEY_NAME.UP)(e)) {
                    setSelectedIndex(prev => (prev <= 0 ? itemCount - 1 : prev - 1));
                } else {
                    setSelectedIndex(prev => (prev >= itemCount - 1 ? 0 : prev + 1));
                }
            } else if (createHotkey(HOT_KEY_NAME.ENTER)(e)) {
                e.preventDefault();
                e.stopPropagation();
                if (selectedIndex >= 0) {
                    onSelect(selectedIndex);
                    onClose();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [isOpen, selectedIndex, itemCount, onSelect, onClose]);

    const getButtonProps = useCallback((index: number) => ({
        ref: (el: HTMLButtonElement | null) => {
            buttonRefs.current[index] = el;
        },
        sx: {
            '&:hover': {
                backgroundColor: 'var(--fill-list-hover)'
            },
            ...(selectedIndex === index && {
                backgroundColor: 'var(--fill-list-hover)'
            })
        }
    }), [selectedIndex]);

    return {
        selectedIndex,
        getButtonProps
    };
} 