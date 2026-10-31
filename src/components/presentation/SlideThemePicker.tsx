import { useState } from 'react';

import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabLabel } from '@/components/ui/tabs';

import type { PresentationStyle } from './types';

export default function SlideThemePicker({
  style,
  themes = [],
  onSelect,
}: {
  style: PresentationStyle;
  themes?: PresentationStyle[];
  onSelect: (style: PresentationStyle) => void;
}) {
  const [intensity, setIntensity] = useState(style.id.includes('bold') ? 'bold' : 'soft');
  const [expanded, setExpanded] = useState(false);
  const matching = themes.filter((theme) => !theme.id.includes('appflowy-') || theme.id.includes(`-${intensity}-`));
  const selected = matching.find((theme) => theme.id === style.id);
  const visible = expanded ? matching : matching.slice(0, 5);

  if (!expanded && selected && !visible.includes(selected)) visible[visible.length - 1] = selected;

  function changeIntensity(value: string) {
    setIntensity(value);
    const suffix = style.id.replace(/^appflowy-(soft|bold)-/, '');
    const theme = themes.find((candidate) => candidate.id === `appflowy-${value}-${suffix}`);

    if (theme) onSelect(theme);
  }

  return (
    <div className='ps-ppt-theme-picker'>
      <Tabs value={intensity} onValueChange={changeIntensity}>
        <TabsList aria-label='Color intensity' className='ps-ppt-theme-tabs'>
          {['soft', 'bold'].map((value) => (
            <TabsTrigger key={value} value={value}>
              <TabLabel>{value === 'soft' ? 'Soft' : 'Bold'}</TabLabel>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className='ps-ppt-theme-cards' role='group' aria-label='AppFlowy color themes'>
        {visible.map((theme) => {
          const selected = style.id === theme.id;
          const label = theme.name;

          return (
            <button
              key={theme.id}
              type='button'
              className='ps-ppt-theme-card'
              aria-label={theme.name}
              aria-pressed={selected}
              onClick={() => onSelect(theme)}
            >
              <span
                className='ps-ppt-theme-preview'
                style={{ background: theme.background, color: theme.textColor }}
                aria-hidden='true'
              >
                <span
                  className='ps-ppt-theme-title-line'
                  style={{ background: intensity === 'bold' ? theme.color : undefined }}
                />
                <span className='ps-ppt-theme-body-line' />
                <span className='ps-ppt-theme-body-line ps-ppt-theme-short-line' />
                <span
                  className='ps-ppt-theme-dot'
                  style={{ background: intensity === 'bold' ? theme.color : undefined }}
                />
                {selected && (
                  <span className='ps-ppt-theme-check'>
                    <CheckIcon />
                  </span>
                )}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
        {!expanded && (
          <Button
            variant='outline'
            className='ps-ppt-more-themes w-full self-start whitespace-normal border-dashed text-text-action'
            onClick={() => setExpanded(true)}
          >
            +5 more
          </Button>
        )}
      </div>
      {expanded && (
        <Button variant='ghost' onClick={() => setExpanded(false)}>
          Show fewer themes
        </Button>
      )}
    </div>
  );
}
