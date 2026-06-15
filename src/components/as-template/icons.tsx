import { TemplateIcon } from '@/application/template.type';
import { ReactComponent as Sparkle } from '@/assets/icons/ai.svg';
import { ReactComponent as Kanban } from '@/assets/icons/board.svg';
import { ReactComponent as Controller } from '@/assets/icons/controller.svg';
import { ReactComponent as Database } from '@/assets/icons/database.svg';
import { ReactComponent as Website } from '@/assets/icons/earth.svg';
import { ReactComponent as Engineering } from '@/assets/icons/engineering.svg';
import { ReactComponent as Facebook } from '@/assets/icons/facebook.svg';
import { ReactComponent as GraduationCap } from '@/assets/icons/graduation_cap.svg';
import { ReactComponent as Instagram } from '@/assets/icons/instagram.svg';
import { ReactComponent as LinkedInIcon } from '@/assets/icons/linkedin.svg';
import { ReactComponent as Management } from '@/assets/icons/management.svg';
import { ReactComponent as Marketing } from '@/assets/icons/marketing.svg';
import { ReactComponent as Doc } from '@/assets/icons/page.svg';
import { ReactComponent as Sales } from '@/assets/icons/sales.svg';
import { ReactComponent as Startup } from '@/assets/icons/startup.svg';
import { ReactComponent as Tiktok } from '@/assets/icons/tiktok.svg';
import { ReactComponent as Twitter } from '@/assets/icons/twitter.svg';
import { ReactComponent as User } from '@/assets/icons/user.svg';
import { ReactComponent as UsersThree } from '@/assets/icons/users.svg';
import { ReactComponent as Wiki } from '@/assets/icons/wiki.svg';
import { ReactComponent as Youtube } from '@/assets/icons/youtube.svg';

const categoryIcons: Record<string, React.ReactElement> = {
  [TemplateIcon.project]: <Controller className='h-5 w-5' />,
  [TemplateIcon.engineering]: <Engineering className='h-5 w-5' />,
  [TemplateIcon.startups]: <Startup className='h-5 w-5' />,
  [TemplateIcon.schools]: <GraduationCap className='h-5 w-5' />,
  [TemplateIcon.marketing]: <Marketing className='h-5 w-5' />,
  [TemplateIcon.management]: <Management />,
  [TemplateIcon.humanResources]: <User className='h-5 w-5' />,
  [TemplateIcon.sales]: <Sales className='h-5 w-5' />,
  [TemplateIcon.teamMeetings]: <UsersThree className='h-5 w-5' />,
  [TemplateIcon.ai]: <Sparkle className='h-5 w-5' />,
  [TemplateIcon.docs]: <Doc className='h-5 w-5' />,
  [TemplateIcon.wiki]: <Wiki className='h-5 w-5' />,
  [TemplateIcon.database]: <Database className='h-5 w-5' />,
  [TemplateIcon.kanban]: <Kanban className='h-5 w-5' />,
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
