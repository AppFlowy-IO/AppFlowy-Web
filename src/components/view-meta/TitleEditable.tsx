import { debounce } from 'lodash-es';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Log } from '@/utils/log';

/**
 * Title Update Flow & Echo Prevention Mechanism:
 * 
 * 1. USER INPUT → LOCAL UPDATE
 *    - User types → debounced update (300ms) → send to server
 *    - User blurs/enters → immediate update → send to server
 *    - Cache sent values with timestamps for echo detection
 * 
 * 2. REMOTE UPDATE HANDLING
 *    - Ignore updates while user is actively typing (500ms window)
 *    - Ignore updates shortly after sending (2s protection window)
 *    - Detect and ignore "echo" updates (values we recently sent)
 *    - Accept genuine remote updates and clean old cache entries
 * 
 * 3. ECHO PREVENTION STRATEGY
 *    - Track sent values in Map<string, timestamp>
 *    - Ignore remote updates matching recently sent values
 *    - Auto-cleanup old cache entries (15s expiry)
 *    - Clear old cache when genuine remote updates arrive
 */

// Cursor utility functions
const isCursorAtEnd = (el: HTMLDivElement) => {
  const selection = window.getSelection();

  if (!selection) return false;
  
  const range = selection.getRangeAt(0);
  const text = el.textContent || '';

  return range.startOffset === text.length;
};

const getCursorOffset = () => {
  const selection = window.getSelection();

  if (!selection) return 0;
  
  return selection.getRangeAt(0).startOffset;
};

const setCursorPosition = (element: HTMLDivElement, position: number) => {
  const range = document.createRange();
  const selection = window.getSelection();
  
  if (!element.firstChild) return;
  
  const textNode = element.firstChild;
  const maxPosition = textNode.textContent?.length || 0;
  const safePosition = Math.min(position, maxPosition);
  
  range.setStart(textNode, safePosition);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

function TitleEditable({
  viewId,
  name,
  onUpdateName,
  onEnter,
  onFocus,
  autoFocus = true,
}: {
  viewId: string;
  name: string;
  onUpdateName: (name: string) => void;
  onEnter?: (text: string) => void;
  onFocus?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();

  // Component state and refs
  const [isFocused, setIsFocused] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Timing and cache refs
  const lastInputTimeRef = useRef<number>(0);
  const lastUpdateSentTimeRef = useRef<number>(0);
  const sentValuesRef = useRef<Map<string, number>>(new Map());
  
  // Timer refs
  const inputTimerRef = useRef<NodeJS.Timeout>();
  const blurTimerRef = useRef<NodeJS.Timeout>();
  const cleanupTimerRef = useRef<NodeJS.Timeout>();

  // State checking functions
  const isTyping = useCallback(() => {
    return Date.now() - lastInputTimeRef.current < 500; // 500ms typing window
  }, []);

  const isRecentlyUpdated = useCallback(() => {
    return Date.now() - lastUpdateSentTimeRef.current < 2000; // 2s protection window
  }, []);

  const isPotentialEcho = useCallback((value: string) => {
    return sentValuesRef.current.has(value);
  }, []);

  // Cache management
  const cleanOldSentValues = useCallback(() => {
    const now = Date.now();
    const maxAge = 15000; // 15 seconds
    
    for (const [value, timestamp] of sentValuesRef.current.entries()) {
      if (now - timestamp > maxAge) {
        sentValuesRef.current.delete(value);
        Log.debug('🧹 Cleaned old sent value:', value);
      }
    }
  }, []);

  const scheduleCleanup = useCallback(() => {
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
    }
    
    cleanupTimerRef.current = setTimeout(cleanOldSentValues, 5000);
  }, [cleanOldSentValues]);

  // Update functions - send changes to server and cache for echo detection
  const sendUpdate = useCallback((value: string, isImmediate = false) => {
    Log.debug(isImmediate ? '⚡ Immediate update:' : '⏰ Debounced update:', value);
    
    const now = Date.now();

    lastUpdateSentTimeRef.current = now;
    sentValuesRef.current.set(value, now);
    scheduleCleanup();
    onUpdateName(value);
  }, [onUpdateName, scheduleCleanup]);

  const debouncedUpdate = useMemo(() => {
    return debounce((value: string) => sendUpdate(value, false), 300);
  }, [sendUpdate]);

  const sendUpdateImmediately = useCallback((value: string) => {
    debouncedUpdate.cancel();
    sendUpdate(value, true);
  }, [debouncedUpdate, sendUpdate]);

  // Handle remote updates with echo prevention
  useEffect(() => {
    // Never overwrite user edits while the title is focused.
    // The title uses a plain contentEditable (not Y.js CRDT), so
    // last-writer-wins via the API is the correct model.
    // On blur, sendUpdateImmediately sends the user's final value.
    if (isFocused) {
      return;
    }

    if (isTyping() || isRecentlyUpdated()) {
      return;
    }

    if (isPotentialEcho(name)) {
      return;
    }

    // Genuine remote update — clean old cache entries
    const now = Date.now();

    for (const [value, timestamp] of sentValuesRef.current.entries()) {
      if (now - timestamp > 5000) {
        sentValuesRef.current.delete(value);
      }
    }

    // Apply remote update to UI
    if (contentRef.current) {
      const currentContent = contentRef.current.textContent || '';

      if (currentContent !== name) {
        contentRef.current.textContent = name;
      }
    }
  }, [name, isTyping, isRecentlyUpdated, isPotentialEcho, isFocused]);

  // Initialize component
  useEffect(() => {
    const contentBox = contentRef.current;

    if (!contentBox) {
      console.warn('[TitleEditable] contentRef not available yet');
      return;
    }

    contentBox.textContent = name;

    if (autoFocus) {
      requestAnimationFrame(() => {
        if (contentBox && document.contains(contentBox)) {
          contentBox.focus();
          if (contentBox.textContent) {
            setCursorPosition(contentBox, contentBox.textContent.length);
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusedTextbox = useCallback(() => {
    const textbox = document.getElementById(`editor-${viewId}`) as HTMLElement;

    textbox?.focus();
  }, [viewId]);

  // Event handlers with useCallback optimization
  const handleFocus = useCallback(() => {
    Log.debug('🎯 Input focused');
    
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = undefined;
    }
    
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    Log.debug('👋 Input blurred');
    const currentText = contentRef.current?.textContent || '';
    
    sendUpdateImmediately(currentText);
    setIsFocused(false);
    
    blurTimerRef.current = setTimeout(() => {
      Log.debug('🧹 Cleaning input state after blur');
      lastInputTimeRef.current = 0;
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
      }
    }, 100);
  }, [sendUpdateImmediately]);

  const handleInput = useCallback(() => {
    if (!contentRef.current) return;
    
    lastInputTimeRef.current = Date.now();

    // Clean up browser auto-inserted <br> tags
    if (contentRef.current.innerHTML === '<br>') {
      contentRef.current.innerHTML = '';
    }
    
    const currentText = contentRef.current.textContent || '';

    debouncedUpdate(currentText);
    
    if (inputTimerRef.current) {
      clearTimeout(inputTimerRef.current);
    }
    
    inputTimerRef.current = setTimeout(() => {
      Log.debug('⏸️ User stopped typing');
    }, 500);
  }, [debouncedUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!contentRef.current) return;
    
    lastInputTimeRef.current = Date.now();

    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      
      if (e.key === 'Enter') {
        const currentText = e.currentTarget.textContent || '';
        const offset = getCursorOffset();
        
        if (offset >= currentText.length || offset <= 0) {
          sendUpdateImmediately(currentText);
          onEnter?.('');
        } else {
          const beforeText = currentText.slice(0, offset);
          const afterText = currentText.slice(offset);
          
          contentRef.current.textContent = beforeText;
          sendUpdateImmediately(beforeText);
          onEnter?.(afterText);
        }
        
        setTimeout(() => focusedTextbox(), 0);
      } else {
        const currentText = contentRef.current.textContent || '';

        sendUpdateImmediately(currentText);
      }
      
      setTimeout(() => {
        lastInputTimeRef.current = 0;
        if (inputTimerRef.current) {
          clearTimeout(inputTimerRef.current);
        }
      }, 100);
    } else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && isCursorAtEnd(contentRef.current))) {
      e.preventDefault();
      focusedTextbox();
    }
  }, [sendUpdateImmediately, onEnter, focusedTextbox]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
      }

      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
      }

      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }

      debouncedUpdate.cancel();
    };
  }, [debouncedUpdate]);


  return (
    <div
      ref={contentRef}
      suppressContentEditableWarning={true}
      id={`editor-title-${viewId}`}
      data-testid='page-title-input'
      style={{ wordBreak: 'break-word' }}
      className={
        'custom-caret relative flex-1 cursor-text whitespace-pre-wrap break-words empty:before:text-text-tertiary empty:before:content-[attr(data-placeholder)] focus:outline-none'
      }
      data-placeholder={t('menuAppHeader.defaultNewPageName')}
      contentEditable={true}
      autoFocus={autoFocus}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
    />
  );
}

export default memo(TitleEditable);