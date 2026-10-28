import type { Mode } from './types';

export type PresentationChoice = Extract<Mode, 'document' | 'mindmap' | 'slides'>;

const colors = {
  surface: 'var(--surface-primary)',
  hover: 'var(--fill-content-hover)',
  border: 'var(--border-primary)',
  text: 'var(--text-primary)',
  muted: 'var(--text-secondary)',
  blue: 'var(--fill-theme-thick)',
  softBlue: 'var(--fill-theme-select)',
  onBlue: 'var(--text-on-fill)',
};

const descriptions: Record<PresentationChoice, string> = {
  document: 'A document presented as a focused slide with its original content and slide navigation.',
  mindmap: 'A project plan connected to goals, progress and next steps, with zoom controls.',
  slides: 'A presentation preview with slide thumbnails and a three-column slide.',
};

/** Small, theme-aware illustrations; previewing a choice never loads or generates a presentation. */
export default function PresentationMenuPreview({ mode }: { mode: PresentationChoice }) {
  return (
    <svg
      role='img'
      aria-label={descriptions[mode]}
      viewBox='0 0 288 162'
      width='288'
      height='162'
      className='block h-auto w-full rounded-200 bg-surface-primary'
      fontFamily='inherit'
      fill={colors.text}
    >
      {mode === 'document' && (
        <>
          <rect x='12' y='12' width='264' height='132' rx='4' fill={colors.surface} stroke={colors.border} />
          <rect x='30' y='29' width='38' height='4' rx='2' fill={colors.blue} />
          <text x='30' y='53' fontSize='16' fontWeight='600'>
            Project update
          </text>
          <text x='30' y='69' fontSize='8' fill={colors.muted}>
            Turning ideas into progress
          </text>
          <circle cx='33' cy='87' r='2' fill={colors.blue} />
          <text x='41' y='90' fontSize='9'>
            Align the team
          </text>
          <circle cx='33' cy='103' r='2' fill={colors.blue} />
          <text x='41' y='106' fontSize='9'>
            Share what we learned
          </text>
          <circle cx='33' cy='119' r='2' fill={colors.blue} />
          <text x='41' y='122' fontSize='9'>
            Plan the next steps
          </text>
          <rect x='194' y='78' width='60' height='48' rx='4' fill={colors.softBlue} />
          <path d='M205 114H243M209 114V104M222 114V96M235 114V88' stroke={colors.blue} strokeWidth='5' />
          <path
            d='M121 151L118 154L121 157M167 151L170 154L167 157'
            fill='none'
            stroke={colors.muted}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <text x='144' y='157' fontSize='8' textAnchor='middle' fill={colors.muted}>
            1 / 4
          </text>
        </>
      )}
      {mode === 'mindmap' && (
        <>
          <g fill='none' stroke={colors.blue} strokeWidth='1.5'>
            <path d='M100 80H121Q134 80 134 67V44Q134 33 147 33H164' />
            <path d='M100 80H164' />
            <path d='M100 80H121Q134 80 134 93V116Q134 127 147 127H164' />
          </g>
          <rect x='16' y='65' width='84' height='30' rx='6' fill={colors.blue} />
          <text x='58' y='83' textAnchor='middle' fontSize='10' fontWeight='500' fill={colors.onBlue}>
            Project plan
          </text>
          {['Goals', 'Progress', 'Next steps'].map((label, index) => (
            <g key={label}>
              <rect x='164' y={18 + index * 47} width='108' height='30' rx='6' fill={colors.hover} />
              <text x='218' y={37 + index * 47} textAnchor='middle' fontSize='10'>
                {label}
              </text>
              <circle cx='155' cy={33 + index * 47} r='4' fill={colors.surface} stroke={colors.blue} />
              <path d={`M153 ${33 + index * 47}H157`} stroke={colors.blue} strokeLinecap='round' />
            </g>
          ))}
          <rect x='89' y='143' width='62' height='14' rx='4' fill={colors.hover} />
          <path d='M97 150H103M137 147V153M134 150H140' stroke={colors.muted} strokeLinecap='round' />
          <text x='119' y='153' fontSize='7' textAnchor='middle' fill={colors.muted}>
            100%
          </text>
        </>
      )}
      {mode === 'slides' && (
        <>
          <text x='12' y='15' fontSize='9' fontWeight='500'>
            Project update
          </text>
          <rect x='237' y='6' width='39' height='14' rx='4' fill={colors.blue} />
          <text x='256' y='16' fontSize='7' textAnchor='middle' fill={colors.onBlue}>
            Present
          </text>
          <path d='M0 25H288' stroke={colors.border} />
          <rect x='0' y='26' width='45' height='136' fill={colors.hover} />
          {[0, 1, 2].map((index) => (
            <g key={index}>
              <rect
                x='8'
                y={36 + index * 37}
                width='30'
                height='23'
                rx='2'
                fill={index === 0 ? colors.softBlue : colors.surface}
                stroke={index === 0 ? colors.blue : colors.border}
              />
              <path d={`M13 ${43 + index * 37}H31M13 ${48 + index * 37}H25`} stroke={colors.muted} strokeWidth='1.5' />
            </g>
          ))}
          <rect x='55' y='37' width='221' height='111' rx='3' fill={colors.softBlue} />
          <text x='70' y='61' fontSize='14' fontWeight='600'>
            Move forward, together
          </text>
          <text x='70' y='75' fontSize='7' fill={colors.muted}>
            A clear plan for the next quarter
          </text>
          {['Learn', 'Build', 'Launch'].map((label, index) => (
            <g key={label}>
              <path d={`M${70 + index * 65} 89h55`} stroke={colors.blue} strokeWidth='2' />
              <text x={70 + index * 65} y='106' fontSize='11' fill={colors.blue} fontWeight='600'>
                0{index + 1}
              </text>
              <text x={70 + index * 65} y='121' fontSize='9'>
                {label}
              </text>
              <path d={`M${70 + index * 65} 129h43`} stroke={colors.muted} strokeOpacity='.4' strokeWidth='2' />
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
