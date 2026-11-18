import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { isMemberRecipient, MemberRecipient, RuleAction } from '@/application/services/js-services/http/automation-api';
import { useMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';
import { Button } from '@/components/ui/button';

import { isRecipientField, RuleField } from './model';
import { Select } from './Select';
import { TextFields } from './TextFields';

export function MemberEmailFields({
  action,
  change,
  fields,
  previous,
  hasRow,
  scheduled,
}: {
  action: RuleAction;
  change: (action: RuleAction) => void;
  fields: RuleField[];
  previous: RuleAction[];
  hasRow: boolean;
  scheduled: boolean;
}) {
  const { t } = useTranslation();
  const { users, fetchUsers } = useMentionableUsers();
  const groups = ['to', 'cc', 'bcc'] as const;
  const members = groups.flatMap((g) => action[g] || []);
  const needsUsers = [...members, action.reply_to].some((v) => v && isMemberRecipient(v) && v.type === 'workspace_user');

  useEffect(() => {
    if (needsUsers) void fetchUsers();
  }, [needsUsers, fetchUsers]);
  const personFields = hasRow ? fields.filter(isRecipientField) : [];

  function selector(
    group: (typeof groups)[number] | 'reply_to',
    v: MemberRecipient | undefined,
    set: (v?: MemberRecipient) => void
  ) {
    const groupName = t(`databaseAutomation.${group}`);
    const kinds: MemberRecipient['type'][] = ['address', 'workspace_user'];

    if (!scheduled) kinds.push('actor');
    if (personFields.length) kinds.push('person_field');

    return (
      <>
        <Select
          label={t('databaseAutomation.recipientSource', { group: groupName })}
          value={v?.type || ''}
          options={kinds.map((id) => ({ id, name: t(`databaseAutomation.recipientKinds.${id}`) }))}
          change={([type]) => {
            if (type === 'actor') set({ type });
            else if (type === 'workspace_user') set({ type, user_id: '' });
            else if (type === 'person_field') set({ type, field_id: personFields[0]?.id || '' });
            else if (type === 'address') set({ type, value: '' });
            else if (group === 'reply_to') set(undefined);
          }}
        />
        {v?.type === 'address' && (
          <TextFields
            label={groupName}
            {...{ fields, previous }}
            value={v.value}
            change={(value) => set({ ...v, value })}
          />
        )}
        {v?.type === 'workspace_user' && (
          <Select
            label={t('databaseAutomation.people')}
            value={v.user_id}
            options={users.map((u) => ({ id: u.person_id, name: u.name || u.email }))}
            change={([user_id]) => set({ ...v, user_id })}
          />
        )}
        {v?.type === 'person_field' && (
          <Select
            label={t('databaseAutomation.property')}
            value={v.field_id}
            options={personFields}
            change={([field_id]) => set({ ...v, field_id })}
          />
        )}
      </>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const values = action[group] || [];

        return (
          <div key={group}>
            {values.map((v, i) => (
              <div key={i}>
                {isMemberRecipient(v) &&
                  selector(group, v, (next) => {
                    if (next) change({ ...action, [group]: values.map((prior, index) => (index === i ? next : prior)) });
                  })}
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => change({ ...action, [group]: values.filter((_, index) => i !== index) })}
                >
                  {t('databaseAutomation.removeRecipient')}
                </Button>
              </div>
            ))}
            {members.length < 10 && (
              <Button
                type='button'
                variant='outline'
                onClick={() => change({ ...action, [group]: [...values, { type: 'address', value: '' }] })}
              >
                {t('databaseAutomation.addAddress', { group: t(`databaseAutomation.${group}`) })}
              </Button>
            )}
          </div>
        );
      })}
      {selector(
        'reply_to',
        action.reply_to && isMemberRecipient(action.reply_to) ? action.reply_to : undefined,
        (reply_to) => change({ ...action, reply_to })
      )}
      <TextFields
        label={t('databaseAutomation.sender_name')}
        value={action.sender_name}
        {...{ fields, previous }}
        change={(v) => change({ ...action, sender_name: v || undefined })}
      />
    </>
  );
}
