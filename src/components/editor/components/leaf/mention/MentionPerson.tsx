import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MentionType } from '@/application/types';
import { useEditorContext } from '@/components/editor/EditorContext';

export function MentionPerson({ personId, person_name }: { type: MentionType; personId: string; person_name?: string }) {
  const [isDeleted, setIsDeleted] = useState(false);
  const { t } = useTranslation();
  const fallbackName = person_name?.trim() || personId;
  const [name, setName] = useState(fallbackName);
  const { getMentionUser } = useEditorContext();

  useEffect(() => {
    if (!getMentionUser) {
      setIsDeleted(false);
      setName(fallbackName);
      return;
    }

    const fetchUser = async () => {
      try {
        const user = await getMentionUser(personId);

        if (user) {
          setName(user.name);
          setIsDeleted(false);
        } else {
          setIsDeleted(true);
        }
      } catch (error) {
        setIsDeleted(false);
        setName(fallbackName);
      }
    };

    void fetchUser();
  }, [fallbackName, getMentionUser, personId]);

  return (
    <span contentEditable={false} data-mention-id={personId} className='mention-person'>
      <span className='mr-0.5 text-text-tertiary'>@</span>
      <span className='text-text-secondary'>{isDeleted ? t('deleted') : name}</span>
    </span>
  );
}
