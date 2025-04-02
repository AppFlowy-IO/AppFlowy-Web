import { TemplateIcon } from '@/application/template.type';
import { ReactComponent as Youtube } from '@/assets/icons/youtube.svg';
import { ReactComponent as Twitter } from '@/assets/icons/twitter.svg';
import { ReactComponent as Instagram } from '@/assets/icons/instagram.svg';
import { ReactComponent as Facebook } from '@/assets/icons/facebook.svg';
import { ReactComponent as Tiktok } from '@/assets/icons/tiktok.svg';
import { ReactComponent as Website } from '@/assets/icons/earth.svg';
import { ReactComponent as LinkedInIcon } from '@/assets/icons/linkedin.svg';
import { ReactComponent as LightningIcon } from '@/assets/icons/lightning.svg';
import { ReactComponent as MonitorIcon } from '@/assets/icons/monitor.svg';
import { ReactComponent as Lightbulb } from '@/assets/icons/lightbulb.svg';
import { ReactComponent as GraduationCap } from '@/assets/icons/graduation_cap.svg';
import { ReactComponent as Database } from '@/assets/icons/database.svg';
import { ReactComponent as Columns } from '@/assets/icons/columns.svg';
import { ReactComponent as UsersThree } from '@/assets/icons/users.svg';
import { ReactComponent as ChatCircleText } from '@/assets/icons/chat_circle_text.svg';
import { ReactComponent as MegaphoneSimple } from '@/assets/icons/megaphone_simple.svg';
import { ReactComponent as UserIcon } from '@/assets/icons/user.svg';
import { ReactComponent as CurrencyCircleDollar } from '@/assets/icons/currency_circle_dollar.svg';
import { ReactComponent as Sparkle } from '@/assets/sparkle.svg';
import { ReactComponent as Notepad } from '@/assets/icons/notepad.svg';
import { ReactComponent as Book } from '@/assets/icons/book.svg';

const categoryIcons: Record<string, React.ReactElement> = {
  [TemplateIcon.project]: <LightningIcon />,
  [TemplateIcon.engineering]: <MonitorIcon />,
  [TemplateIcon.startups]: <Lightbulb />,
  [TemplateIcon.schools]: <GraduationCap />,
  [TemplateIcon.marketing]: <MegaphoneSimple />,
  [TemplateIcon.management]: <ChatCircleText />,
  [TemplateIcon.humanResources]: <UserIcon />,
  [TemplateIcon.sales]: <CurrencyCircleDollar />,
  [TemplateIcon.teamMeetings]: <UsersThree />,
  [TemplateIcon.ai]: <Sparkle />,
  [TemplateIcon.docs]: <Notepad />,
  [TemplateIcon.wiki]: <Book />,
  [TemplateIcon.database]: <Database />,
  [TemplateIcon.kanban]: <Columns />,
};

export function CategoryIcon({ icon }: { icon: TemplateIcon }) {
  return categoryIcons[icon] || null;
}

export function accountLinkIcon(type: string) {
  switch (type) {
    case 'youtube':
      return <Youtube className='h-5 w-5' />;
    case 'twitter':
      return <Twitter className='h-5 w-5' />;
    case 'tiktok':
      return <Tiktok className='h-5 w-5' />;
    case 'facebook':
      return <Facebook className='h-5 w-5' />;
    case 'instagram':
      return <Instagram className='h-5 w-5' />;
    case 'linkedin':
      return <LinkedInIcon className='h-5 w-5' />;
    default:
      return <Website className='h-5 w-5' />;
  }
}
