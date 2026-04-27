import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useState } from 'react';

import GlobalComment from '@/components/global-comment/GlobalComment';
import {
  GlobalCommentContext,
  useLoadComments,
  useLoadReactions,
} from '@/components/global-comment/GlobalComment.hooks';

export function GlobalCommentProvider({ disableFixedAddComment }: { disableFixedAddComment?: boolean }) {
  const { comments, loading, reload } = useLoadComments();
  const { reactions, toggleReaction } = useLoadReactions();
  const [replyCommentId, setReplyCommentId] = useState<string | null>(null);
  const [highLightCommentId, setHighLightCommentId] = useState<string | null>(null);
  const getComment = useCallback(
    (commentId: string) => {
      return comments?.find((comment) => comment.commentId === commentId);
    },
    [comments]
  );

  const replyComment = useCallback((commentId: string | null) => {
    setReplyCommentId(commentId);
  }, []);

  const debounceClearHighLightCommentId = useMemo(() => {
    return debounce(() => {
      setHighLightCommentId(null);
    }, 5000);
  }, []);

  useEffect(() => {
    if (highLightCommentId) {
      debounceClearHighLightCommentId();
    } else {
      debounceClearHighLightCommentId.cancel();
    }
  }, [highLightCommentId, debounceClearHighLightCommentId]);

  const contextValue = useMemo(
    () => ({
      reactions,
      replyCommentId,
      reload,
      getComment,
      loading,
      comments,
      replyComment,
      toggleReaction,
      highLightCommentId,
      setHighLightCommentId,
    }),
    [
      reactions,
      replyCommentId,
      reload,
      getComment,
      loading,
      comments,
      replyComment,
      toggleReaction,
      highLightCommentId,
    ]
  );

  return (
    <GlobalCommentContext.Provider value={contextValue}>
      <GlobalComment disableFixedAddComment={disableFixedAddComment} />
    </GlobalCommentContext.Provider>
  );
}

export default GlobalCommentProvider;
