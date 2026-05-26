import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { clearRedirectTo } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { UserService } from '@/application/services/domains';
import { DateFormat, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import LogoutConfirm from '@/components/app/workspaces/LogoutConfirm';
import { useAppConfig } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { i18nInstance } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

import { SetupPasswordDialog } from './SetupPasswordDialog';

const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English (US)' },
  { code: 'am-ET', label: 'አማርኛ' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'ca-ES', label: 'Català' },
  { code: 'ckb-KU', label: 'کوردی' },
  { code: 'cs-CZ', label: 'Čeština' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'el-GR', label: 'Ελληνικά' },
  { code: 'es-VE', label: 'Español' },
  { code: 'eu-ES', label: 'Euskara' },
  { code: 'fa', label: 'فارسی' },
  { code: 'fr-CA', label: 'Français (Canada)' },
  { code: 'fr-FR', label: 'Français (France)' },
  { code: 'he', label: 'עברית' },
  { code: 'hin', label: 'हिन्दी' },
  { code: 'hu-HU', label: 'Magyar' },
  { code: 'id-ID', label: 'Bahasa Indonesia' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'sv-SE', label: 'Svenska' },
  { code: 'th-TH', label: 'ไทย' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'uk-UA', label: 'Українська' },
  { code: 'ur', label: 'اردو' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'vi-VN', label: 'Tiếng Việt (Việt Nam)' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
];

function formatDateTimeExample(dateFormat: DateFormat, timeFormat: TimeFormat): string {
  const now = dayjs();
  const dateToken = (() => {
    switch (dateFormat) {
      case DateFormat.US:
        return 'YYYY/MM/DD';
      case DateFormat.ISO:
        return 'YYYY-MM-DD';
      case DateFormat.Friendly:
        return 'MMM DD, YYYY';
      case DateFormat.DayMonthYear:
        return 'DD/MM/YYYY';
      case DateFormat.Local:
      default:
        return 'MM/DD/YYYY';
    }
  })();
  const timeToken = timeFormat === TimeFormat.TwentyFourHour ? 'HH:mm' : 'h:mm A';
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const offset = minutes === 0 ? `${sign}${hours}` : `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  return `${now.format(dateToken)} ${now.format(timeToken)} (${offset})`;
}

export function AccountAppPanel() {
  const { t } = useTranslation();
  const { currentUser, updateCurrentUser } = useAppConfig();
  const navigate = useNavigate();

  const [dateFormat, setDateFormat] = useState(
    () => Number(currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) || DateFormat.Local
  );
  const [timeFormat, setTimeFormat] = useState(
    () => Number(currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat) || TimeFormat.TwelveHour
  );
  const [startWeekOn, setStartWeekOn] = useState(
    () => Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0
  );
  const [language, setLanguage] = useState<string>(
    () => (currentUser?.metadata?.[MetadataKey.Language] as string) || i18nInstance.language || 'en'
  );
  const [openSetupPassword, setOpenSetupPassword] = useState(false);
  const [openLogoutConfirm, setOpenLogoutConfirm] = useState(false);

  const metadataUpdateRef = useRef<Record<string, unknown> | null>(null);
  const userTouchedRef = useRef(false);
  const currentUserRef = useRef(currentUser);
  const updateCurrentUserRef = useRef(updateCurrentUser);

  useEffect(() => {
    currentUserRef.current = currentUser;
    updateCurrentUserRef.current = updateCurrentUser;
  }, [currentUser, updateCurrentUser]);

  const debouncedUpdateProfile = useMemo(() => {
    return debounce(async () => {
      if (!metadataUpdateRef.current) return;
      try {
        await UserService.updateProfile(metadataUpdateRef.current);
        const u = currentUserRef.current;

        if (u) {
          await updateCurrentUserRef.current({ ...u, metadata: metadataUpdateRef.current });
        }
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      void debouncedUpdateProfile.flush();
    };
  }, [debouncedUpdateProfile]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      userTouchedRef.current = true;
      metadataUpdateRef.current = { ...(metadataUpdateRef.current ?? {}), ...patch };
      await debouncedUpdateProfile();
    },
    [debouncedUpdateProfile]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const user = await UserService.getCurrentRaw();

      if (cancelled || !user) return;
      if (userTouchedRef.current) {
        metadataUpdateRef.current = { ...user.metadata, ...(metadataUpdateRef.current ?? {}) };
        return;
      }

      setDateFormat(Number(user.metadata?.[MetadataKey.DateFormat] as DateFormat) || DateFormat.Local);
      setTimeFormat(Number(user.metadata?.[MetadataKey.TimeFormat] as TimeFormat) || TimeFormat.TwelveHour);
      setStartWeekOn(Number(user.metadata?.[MetadataKey.StartWeekOn]) || 0);
      const lang = (user.metadata?.[MetadataKey.Language] as string) || i18nInstance.language || 'en';

      setLanguage(lang);
      metadataUpdateRef.current = { ...user.metadata };
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectDateFormat = useCallback(
    async (next: number) => {
      setDateFormat(next);
      await persist({ [MetadataKey.DateFormat]: next });
    },
    [persist]
  );

  const handleSelectTimeFormat = useCallback(
    async (next: number) => {
      setTimeFormat(next);
      await persist({ [MetadataKey.TimeFormat]: next });
    },
    [persist]
  );

  const handleSelectStartWeekOn = useCallback(
    async (next: number) => {
      setStartWeekOn(next);
      await persist({ [MetadataKey.StartWeekOn]: next });
    },
    [persist]
  );

  const handleSelectLanguage = useCallback(
    async (code: string) => {
      setLanguage(code);
      await i18nInstance.changeLanguage(code);
      await persist({ [MetadataKey.Language]: code });
    },
    [persist]
  );

  const handleSignOut = useCallback(() => {
    clearRedirectTo();
    invalidToken();
    navigate('/login?force=true');
  }, [navigate]);

  if (!currentUser) return null;

  const example = formatDateTimeExample(dateFormat, timeFormat);

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>
          {t('settings.accountPage.accountAndApp')}
        </h2>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <div className='flex flex-col gap-6'>
          <Section title={t('settings.accountPage.email.title')}>
            <div className='text-sm text-text-secondary'>{currentUser.email}</div>
          </Section>

          <Divider />

          <Section title={t('settings.accountPage.dateTime.title')}>
            <div className='text-sm text-text-secondary'>{example}</div>
            <div className='flex flex-col gap-3'>
              <DateFormatDropdown dateFormat={dateFormat} onSelect={handleSelectDateFormat} />
              <TimeFormatDropdown timeFormat={timeFormat} onSelect={handleSelectTimeFormat} />
              <StartWeekOnDropdown startWeekOn={startWeekOn} onSelect={handleSelectStartWeekOn} />
            </div>
          </Section>

          <Divider />

          <Section title={t('settings.accountPage.language.title')}>
            <LanguageDropdown language={language} onSelect={handleSelectLanguage} />
          </Section>

          <Divider />

          <Row>
            <div className='flex flex-col gap-1'>
              <div className='text-sm font-semibold text-text-primary'>
                {t('settings.accountPage.password.title')}
              </div>
              <div className='text-xs text-text-secondary'>
                {t('settings.accountPage.password.description')}
              </div>
            </div>
            <Button
              variant='outline'
              size='default'
              onClick={() => setOpenSetupPassword(true)}
              data-testid='setup-password-button'
            >
              {t('settings.accountPage.password.setupButton')}
            </Button>
          </Row>

          <Divider />

          <Row>
            <div className='text-sm font-semibold text-text-primary'>
              {t('settings.accountPage.login.title')}
            </div>
            <Button
              variant='outline'
              size='default'
              onClick={() => setOpenLogoutConfirm(true)}
              data-testid='settings-logout-button'
            >
              {t('settings.accountPage.login.logoutLabel')}
            </Button>
          </Row>
        </div>
      </div>

      <SetupPasswordDialog open={openSetupPassword} onClose={() => setOpenSetupPassword(false)} />
      <LogoutConfirm
        open={openLogoutConfirm}
        onClose={() => setOpenLogoutConfirm(false)}
        onConfirm={handleSignOut}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='text-sm font-semibold text-text-primary'>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className='flex items-center justify-between gap-4'>{children}</div>;
}

function Divider() {
  return <div className='border-t border-border-primary' />;
}

const triggerCls =
  'flex h-8 w-[260px] cursor-pointer items-center gap-1 rounded-300 border px-2 text-sm font-normal';

function DateFormatDropdown({
  dateFormat,
  onSelect,
}: {
  dateFormat: number;
  onSelect: (next: number) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const items = useMemo(
    () => [
      { value: DateFormat.Local, label: t('grid.field.dateFormatLocal') },
      { value: DateFormat.US, label: t('grid.field.dateFormatUS') },
      { value: DateFormat.ISO, label: t('grid.field.dateFormatISO') },
      { value: DateFormat.Friendly, label: t('grid.field.dateFormatFriendly') },
      { value: DateFormat.DayMonthYear, label: t('grid.field.dateFormatDayMonthYear') },
    ],
    [t]
  );
  const current = items.find((i) => i.value === dateFormat);

  return (
    <Field label={t('grid.field.dateFormat')}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger
          data-testid='date-format-dropdown'
          asChild
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={() => setIsOpen((p) => !p)}
        >
          <div
            className={cn(
              triggerCls,
              isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
            )}
          >
            <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
              {current?.label || t('settings.workspacePage.dateTime.dateFormat.label')}
            </span>
            <ChevronDownIcon className='text-icon-primary' />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuRadioGroup
            value={dateFormat.toString()}
            onValueChange={(v) => onSelect(Number(v))}
          >
            {items.map((item) => (
              <DropdownMenuRadioItem
                key={item.value}
                data-testid={`date-format-${item.value}`}
                value={item.value.toString()}
              >
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

function TimeFormatDropdown({
  timeFormat,
  onSelect,
}: {
  timeFormat: number;
  onSelect: (next: number) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const items = useMemo(
    () => [
      { value: TimeFormat.TwelveHour, label: t('grid.field.timeFormatTwelveHour') },
      { value: TimeFormat.TwentyFourHour, label: t('grid.field.timeFormatTwentyFourHour') },
    ],
    [t]
  );
  const current = items.find((i) => i.value === timeFormat);

  return (
    <Field label={t('grid.field.timeFormat')}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger
          data-testid='time-format-dropdown'
          asChild
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={() => setIsOpen((p) => !p)}
        >
          <div
            className={cn(
              triggerCls,
              isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
            )}
          >
            <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
              {current?.label || t('grid.field.timeFormatTwelveHour')}
            </span>
            <ChevronDownIcon className='text-icon-primary' />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuRadioGroup
            value={timeFormat.toString()}
            onValueChange={(v) => onSelect(Number(v))}
          >
            {items.map((item) => (
              <DropdownMenuRadioItem
                key={item.value}
                data-testid={`time-format-${item.value}`}
                value={item.value.toString()}
              >
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

function StartWeekOnDropdown({
  startWeekOn,
  onSelect,
}: {
  startWeekOn: number;
  onSelect: (next: number) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const items = useMemo(
    () => [
      { value: 0, label: dayjs().day(0).format('dddd') },
      { value: 1, label: dayjs().day(1).format('dddd') },
    ],
    []
  );
  const current = items.find((i) => i.value === startWeekOn);

  return (
    <Field label={t('web.startWeekOn')}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger
          data-testid='start-week-on-dropdown'
          asChild
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={() => setIsOpen((p) => !p)}
        >
          <div
            className={cn(
              triggerCls,
              isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
            )}
          >
            <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
              {current?.label || t('web.startWeekOn')}
            </span>
            <ChevronDownIcon className='text-icon-primary' />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuRadioGroup
            value={startWeekOn.toString()}
            onValueChange={(v) => onSelect(Number(v))}
          >
            {items.map((item) => (
              <DropdownMenuRadioItem
                key={item.value}
                data-testid={`start-week-${item.value}`}
                value={item.value.toString()}
              >
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

function LanguageDropdown({
  language,
  onSelect,
}: {
  language: string;
  onSelect: (code: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <DropdownMenuTrigger
        data-testid='language-dropdown'
        asChild
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={() => setIsOpen((p) => !p)}
      >
        <div
          className={cn(
            triggerCls,
            isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
          )}
        >
          <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
            {current.label}
          </span>
          <ChevronDownIcon className='text-icon-primary' />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='max-h-[320px] overflow-y-auto'>
        <DropdownMenuRadioGroup value={language} onValueChange={onSelect}>
          {SUPPORTED_LANGUAGES.map((item) => (
            <DropdownMenuRadioItem
              key={item.code}
              data-testid={`language-${item.code}`}
              value={item.code}
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
    </div>
  );
}

export default AccountAppPanel;
