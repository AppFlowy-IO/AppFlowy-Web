import { Invitation } from '@/application/types';
import { ReactComponent as AppflowyLogo } from '@/assets/icons/appflowy.svg';
import ChangeAccount from '@/components/_shared/modal/ChangeAccount';
import { notify } from '@/components/_shared/notify';
import { getAvatar } from '@/components/_shared/view-icon/utils';
import { AFConfigContext, useCurrentUser, useService } from '@/components/main/app.hooks';
import { EmailOutlined } from '@mui/icons-material';
import { Avatar, Button, Divider } from '@mui/material';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

function AcceptInvitationPage() {
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated;
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get('invited_id');
  const service = useService();
  const [invitation, setInvitation] = useState<Invitation>();
  const [modalOpened, setModalOpened] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirectTo=' + encodeURIComponent(window.location.href));
    }
  }, [isAuthenticated, navigate]);

  const loadInvitation = useCallback(
    async (invitationId: string) => {
      if (!service) return;
      try {
        const res = await service.getInvitation(invitationId);

        if (res.status === 'Accepted') {
          notify.warning(t('invitation.alreadyAccepted'));
        }

        setInvitation(res);
        // eslint-disable-next-line
      } catch (e: any) {
        setModalOpened(true);
      }
    },
    [service, t]
  );

  useEffect(() => {
    if (!invitationId) return;
    void loadInvitation(invitationId);
  }, [loadInvitation, invitationId]);

  const workspaceIconProps = useMemo(() => {
    if (!invitation) return {};

    return getAvatar({
      icon: invitation.workspace_icon,
      name: invitation.workspace_name,
    });
  }, [invitation]);
  const url = useMemo(() => {
    return window.location.href;
  }, []);

  const inviterIconProps = useMemo(() => {
    if (!invitation) return {};

    return getAvatar({
      icon: invitation.inviter_icon,
      name: invitation.inviter_name,
    });
  }, [invitation]);

  return (
    <div
      className={
        'appflowy-scroller flex h-screen w-screen flex-col items-center gap-12 overflow-y-auto overflow-x-hidden bg-bg-base px-6 text-text-title max-md:gap-4'
      }
    >
      <div
        onClick={() => {
          navigate('/app');
        }}
        className={
          'sticky flex h-20 w-full cursor-pointer items-center justify-between max-md:h-32 max-md:justify-center'
        }
      >
        <AppflowyLogo className={'h-12 w-32 max-md:w-52'} />
      </div>
      <div className={'flex w-full max-w-[560px] flex-col items-center gap-6 text-center'}>
        <Avatar
          className={'h-20 w-20 rounded-[16px] border border-text-title text-[40px]'}
          {...workspaceIconProps}
          variant='rounded'
        />
        <div
          className={'whitespace-pre-wrap break-words px-4 text-center text-[40px] leading-[107%] max-sm:text-[24px]'}
        >
          {t('invitation.join')} <span className={'font-semibold'}>{invitation?.workspace_name}</span>{' '}
          {t('invitation.on')} <span className={'whitespace-nowrap'}>AppFlowy</span>
        </div>
        <Divider className={'w-[400px] max-w-full'} />
        <div className={'flex items-center justify-center gap-4 py-1'}>
          <Avatar
            className={'h-20 w-20 border border-line-divider text-[40px]'}
            {...inviterIconProps}
            variant='circular'
          />
          <div className={'flex flex-col items-start gap-1'}>
            <div className={'text-text-title'}>{t('invitation.invitedBy')}</div>
            <div className={'font-semibold text-text-title'}>{invitation?.inviter_name}</div>
            <div className={'text-sm text-text-caption'}>
              {t('invitation.membersCount', {
                count: invitation?.member_count || 0,
              })}
            </div>
          </div>
        </div>
        <div className={'w-[400px] max-w-full text-sm text-text-title'}>{t('invitation.tip')}</div>
        <div
          className={
            'flex w-[400px] max-w-full items-center gap-2 border-b border-line-border bg-bg-body py-2 px-4 max-sm:rounded-[8px] max-sm:border'
          }
        >
          <EmailOutlined />
          {currentUser?.email}
        </div>

        <Button
          variant={'contained'}
          color={'primary'}
          size={'large'}
          className={'w-[400px] max-w-full rounded-[16px] py-5 px-10 text-[24px]'}
          onClick={async () => {
            if (!invitationId) return;
            if (invitation?.status === 'Accepted') {
              notify.warning(t('invitation.alreadyAccepted'));
              return;
            }

            try {
              await service?.acceptInvitation(invitationId);
              notify.info({
                type: 'success',
                title: t('invitation.success'),
                message: t('invitation.successMessage'),
                okText: t('invitation.openWorkspace'),

                onOk: () => {
                  const origin = window.location.origin;

                  window.open(`${origin}/app/${invitation?.workspace_id}`, '_current');
                },
              });
            } catch (e) {
              notify.error('Failed to join workspace');
            }
          }}
        >
          {t('invitation.joinWorkspace')}
        </Button>
      </div>
      {isAuthenticated && <ChangeAccount redirectTo={url} setModalOpened={setModalOpened} modalOpened={modalOpened} />}
    </div>
  );
}

export default AcceptInvitationPage;
