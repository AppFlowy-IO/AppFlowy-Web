import LandingFooter from '@/components/app/landing-pages/LandingFooter';
import { AFConfigContext, useCurrentUser, useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';

const InvalidInviteCode = 1068;

function InviteCode () {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated;
  const url = useMemo(() => {
    return window.location.href;
  }, []);
  const service = useService();
  const params = useParams();
  const [loading, setLoading] = useState(false);
  const currentUser = useCurrentUser();
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirectTo=' + encodeURIComponent(url));
    }
  }, [isAuthenticated, navigate, url]);

  const [isValid, setIsValid] = useState(false);
  const [workspace, setWorkspace] = useState<{
    name: string;
    avatar: string;
    id: string
  } | null>(null);

  const openWorkspace = useCallback((workspaceId: string) => {
    window.open(`appflowy-flutter://invitation-callback?workspace_id=${workspaceId}&email=${currentUser?.email}`, '_blank');
  }, [currentUser?.email]);

  useEffect(() => {
    void (async () => {
      if (!service || !params.code) return;
      try {
        const info = await service.getWorkspaceInfoByInvitationCode(params.code);

        setWorkspace({
          name: info.workspace_name,
          avatar: info.workspace_icon_url,
          id: info.workspace_id,
        });

        if (info.is_member) {
          window.location.href = `/app/${info.workspace_id}`;
          return;
        }
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

      setHasJoined(true);
      openWorkspace(workspaceId);
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
          <Avatar
            shape={'square'}
          >
            <AvatarImage
              src={workspace?.avatar}
              alt={''}
            />
            <AvatarFallback>{workspace?.name?.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </div>
        <div className={'text-xl text-center whitespace-pre-wrap break-words text-text-primary font-semibold'}>
          {isValid ? t('inviteCode.invalid') : hasJoined ? t('inviteCode.hasJoined', {
            workspaceName: workspace?.name,
          }) : t('inviteCode.title', {
            workspaceName: workspace?.name,
          })}
        </div>
        {isValid || hasJoined ? (
          <Button
            variant={'outline'}
            size={'lg'}
            className={'w-full'}
            onClick={() => {
              if (hasJoined) {
                window.location.href = `/app/${workspace?.id}`;
              } else {
                window.location.href = '/app';
              }
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