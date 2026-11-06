import { createRoot } from 'react-dom/client';

import { CalendarEventPopover } from '@/components/database/fullcalendar/event/CalendarEventPopover';
import { Popover, PopoverTrigger } from '@/components/ui/popover';

createRoot(document.getElementById('root')!).render(
  <>
    <style>{`* { box-sizing: border-box; } body { margin: 0; } [data-slot="popover-content"] { background: white; }`}</style>
    <Popover>
      <PopoverTrigger style={{ position: 'fixed', left: 0, right: 0, bottom: 24, height: 32 }}>
        Selected week
      </PopoverTrigger>
      <CalendarEventPopover>
        <div style={{ height: 560 }}>Event properties</div>
        <button>Last property</button>
      </CalendarEventPopover>
    </Popover>
  </>
);
