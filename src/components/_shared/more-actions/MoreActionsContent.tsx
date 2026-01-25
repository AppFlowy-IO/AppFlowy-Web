import React, { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { clearRedirectTo } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { ReactComponent as TrashIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as ReportIcon } from '@/assets/icons/feedback.svg';
import { ReactComponent as LoginIcon } from '@/assets/icons/logout.svg';
import { ReactComponent as MoonIcon } from '@/assets/icons/moon.svg';
import { ReactComponent as SunIcon } from '@/assets/icons/sun.svg';
import CacheClearingDialog from '@/components/_shared/modal/CacheClearingDialog';
import LogoutConfirm from '@/components/app/workspaces/LogoutConfirm';
import { AFConfigContext } from '@/components/main/app.hooks';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { openUrl } from '@/utils/url';

function MoreActionsContent({
  itemClicked,
}: {
  itemClicked: (item: { Icon: React.ElementType; label: string; onClick: () => void }) => void;
}) {
  const { isDark, setDark } = useContext(ThemeModeContext) || {};
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated || false;
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = useCallback(() => {
    clearRedirectTo(); // Clear stored redirect URL from previous user
    invalidToken();
    // Clean up old global key for backward compatibility
    localStorage.removeItem('last_view_id');
    navigate('/login?redirectTo=' + encodeURIComponent(window.location.href));
  }, [navigate]);

  const handleLogin = useCallback(() => {
    if (isAuthenticated) {
      setOpenLogoutConfirm(true);
    } else {
      handleLogout();
    }
  }, [isAuthenticated, handleLogout]);
  const [openConfirm, setOpenConfirm] = React.useState(false);
  const [openLogoutConfirm, setOpenLogoutConfirm] = React.useState(false);

  const actions = useMemo(() => {
    const items = [
      {
        Icon: LoginIcon,
        label: isAuthenticated ? t('button.logout') : t('web.login'),
        onClick: handleLogin,
      },

      isDark
        ? {
          Icon: SunIcon,
          label: t('settings.appearance.themeMode.light'),
          onClick: () => {
            setDark?.(false);
          },
        }
        : {
          Icon: MoonIcon,
          label: t('settings.appearance.themeMode.dark'),
          onClick: () => {
            setDark?.(true);
          },
        },
      {
        Icon: ReportIcon,
        label: t('publish.reportPage'),
        onClick: () => {
          void openUrl('https://report.appflowy.io/', '_blank');
        },
      },
      {
        Icon: TrashIcon,
        label: t('settings.files.clearCache'),
        onClick: () => {
          setOpenConfirm(true);
        },
      },
    ];

    return items;
  }, [t, isAuthenticated, handleLogin, isDark, setDark]);

  return (
    <>
      <div className={'flex w-[240px] flex-col gap-2 px-2 py-2 max-md:w-full'}>
        {actions.map((action, index) => (
          <button
            onClick={() => {
              action.onClick();
              itemClicked(action);
            }}
            key={index}
            className={
              'flex items-center gap-2 rounded-[8px] p-1.5 hover:bg-fill-content-hover focus:bg-fill-content-hover focus:outline-none'
            }
          >
            <action.Icon className={'h-[1.25em] w-[1.25em]'} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <CacheClearingDialog open={openConfirm} onClose={() => setOpenConfirm(false)} />
      <LogoutConfirm
        open={openLogoutConfirm}
        onClose={() => setOpenLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}

export default MoreActionsContent;
