import LandingFooter from '@/components/app/landing-pages/LandingFooter';
import { AFConfigContext, useCurrentUser, useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { toast } from 'sonner';

const InvalidInviteCode = 1068;

function InviteCode () {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated;
  const url = useMemo(() => {
    return window.location.href;
  }, []);
  const currentUser = useCurrentUser();
  const service = useService();
  const params = useParams();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirectTo=' + encodeURIComponent(url));
    }
  }, [isAuthenticated, navigate, url]);

  const [isValid, setIsValid] = useState(false);
  const [workspace, setWorkspace] = useState<{
    name: string;
    avatar: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      if (!service || !params.code) return;
      try {
        const info = await service.getWorkspaceInfoByInvitationCode(params.code);

        if (info.is_member) {
          window.location.href = `/app/${info.workspace_id}`;
          return;
        }

        setWorkspace({
          name: info.workspace_name,
          avatar: info.workspace_icon_url,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.code === InvalidInviteCode) {
          setIsValid(true);
        } else {
          toast.error(e.message);
        }
      }
    })();
  }, [params.code, service]);

  const handleJoin = async () => {
    if (!service || !params.code) return;
    setLoading(true);
    try {
      const workspaceId = await service.joinWorkspaceByInvitationCode(params.code);

      window.location.href = `/app/${workspaceId}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code === InvalidInviteCode) {
        setIsValid(true);
      } else {
        toast.error(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={'bg-background-primary flex h-screen w-screen items-center justify-center'}>
      <div className={'flex w-[352px] text-text-primary flex-col gap-5 items-center justify-center px-4'}>
        <div
          onClick={() => {
            window.location.href = '/';
          }}
          className={'flex cursor-pointer'}
        >
          <Logo className={'h-10 w-10'} />
        </div>
        <div className={'text-xl text-center text-text-primary font-semibold'}>
          {isValid ? t('inviteCode.invalid') : t('inviteCode.title', {
            workspaceName: workspace?.name,
          })}
        </div>
        <div className={'flex text-sm w-full text-center items-center flex-col justify-center'}>
          <div className={'font-normal'}>{t('inviteCode.haveBeenInvited')}</div>
          <div className={'font-semibold'}>
            {currentUser?.email}
          </div>
        </div>
        {isValid ? (
          <Button
            variant={'outline'}
            size={'lg'}
            className={'w-full'}
            onClick={() => {
              window.location.href = '/app';
            }}
          >
            {t('inviteCode.backToMyContent')}
          </Button>
        ) : <Button
          size={'lg'}
          className={'w-full'}
          onClick={handleJoin}
          loading={loading}
        >
          {loading ? t('inviteCode.joining') : t('inviteCode.joinWorkspace')}
        </Button>}
        <LandingFooter />
      </div>
    </div>
  );
}

export default InviteCode;