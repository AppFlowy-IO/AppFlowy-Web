import { TemplateIcon } from '@/application/template.type';
import Youtube from '@/assets/icons/youtube.svg?react';
import Twitter from '@/assets/icons/twitter.svg?react';
import Instagram from '@/assets/icons/instagram.svg?react';
import Facebook from '@/assets/icons/facebook.svg?react';
import Tiktok from '@/assets/icons/tiktok.svg?react';
import Website from '@/assets/icons/earth.svg?react';
import LinkedInIcon from '@/assets/icons/linkedin.svg?react';
import LightningIcon from '@/assets/icons/lightning.svg?react';
import MonitorIcon from '@/assets/icons/monitor.svg?react';
import Lightbulb from '@/assets/icons/lightbulb.svg?react';
import GraduationCap from '@/assets/icons/graduation_cap.svg?react';
import Database from '@/assets/icons/database.svg?react';
import Columns from '@/assets/icons/columns.svg?react';
import UsersThree from '@/assets/icons/users.svg?react';
import ChatCircleText from '@/assets/icons/chat_circle_text.svg?react';
import MegaphoneSimple from '@/assets/icons/megaphone_simple.svg?react';
import UserIcon from '@/assets/icons/user.svg?react';
import CurrencyCircleDollar from '@/assets/icons/currency_circle_dollar.svg?react';
import Sparkle from '@/assets/icons/ai.svg?react';
import Notepad from '@/assets/icons/notepad.svg?react';
import Book from '@/assets/icons/book.svg?react';

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
