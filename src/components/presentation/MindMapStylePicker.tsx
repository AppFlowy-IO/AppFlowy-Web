import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import { useId, useState } from 'react';

import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';

import type { MapBranchLine, MapStructure } from './mindmap-layout';

const structures: { value: MapStructure; label: string }[] = [
  { value: 'right', label: 'Right-facing tree' },
  { value: 'left', label: 'Left-facing tree' },
  { value: 'balanced', label: 'Two-sided mind map' },
  { value: 'down', label: 'Top-down tree' },
];
const lines: { value: MapBranchLine; label: string }[] = [
  { value: 'rounded', label: 'Rounded branches' },
  { value: 'curved', label: 'Curved branches' },
];

function StructurePreview({ structure }: { structure: MapStructure }) {
  return (
    <svg
      viewBox='0 0 60 44'
      fill='none'
      stroke='currentColor'
      strokeWidth='2.5'
      strokeLinecap='round'
      aria-hidden='true'
    >
      {structure === 'down' ? (
        <>
          <circle cx='30' cy='5' r='3' fill='currentColor' stroke='none' />
          <path d='M 30 8 V 13 M 12 23 V 19 Q 12 15 16 15 H 44 Q 48 15 48 19 V 23 M 30 13 V 23' />
          <path opacity='.5' d='M 7 29 H 17 M 25 29 H 35 M 43 29 H 53 M 7 38 H 17 M 25 38 H 35 M 43 38 H 53' />
        </>
      ) : structure === 'balanced' ? (
        <>
          <circle cx='30' cy='22' r='3' fill='currentColor' stroke='none' />
          <path d='M 19 7 C 25 7 23 22 30 22 C 37 22 35 7 41 7 M 19 22 H 41 M 19 37 C 25 37 23 22 30 22 C 37 22 35 37 41 37' />
          <path opacity='.5' d='M 8 7 H 12 M 8 22 H 12 M 8 37 H 12 M 48 7 H 52 M 48 22 H 52 M 48 37 H 52' />
        </>
      ) : (
        <g transform={structure === 'left' ? 'translate(60 0) scale(-1 1)' : undefined}>
          <circle cx='10' cy='22' r='3' fill='currentColor' stroke='none' />
          <path d='M 11 22 C 24 22 14 7 24 7 M 11 22 H 24 M 11 22 C 24 22 14 37 24 37' />
          <path opacity='.5' d='M 32 7 H 50 M 32 22 H 50 M 32 37 H 50' />
        </g>
      )}
    </svg>
  );
}

export default function MindMapStylePicker({
  container,
  structure,
  branchLine,
  onStructure,
  onBranchLine,
}: {
  container: HTMLElement | null;
  structure: MapStructure;
  branchLine: MapBranchLine;
  onStructure: (value: MapStructure) => void;
  onBranchLine: (value: MapBranchLine) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();

  return (
    <>
      <Tooltip title='Mind map styles' placement='top' disableInteractive PopperProps={{ container }}>
        <IconButton
          size='small'
          className='ps-map-tool'
          aria-label='Mind map styles'
          aria-haspopup='dialog'
          aria-expanded={!!anchor}
          aria-controls={anchor ? id : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <LayoutIcon className='h-5 w-5' aria-hidden='true' />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        container={container}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ backdrop: { style: { backgroundColor: 'transparent' } } }}
        data-presentation-escape-layer
        onKeyDown={(event) => event.stopPropagation()}
        PaperProps={{ id, role: 'dialog', 'aria-label': 'Mind map styles', className: 'ps-map-style-picker' }}
      >
        <fieldset>
          <legend>Structure</legend>
          <div className='ps-map-style-options'>
            {structures.map((option) => (
              <Tooltip
                key={option.value}
                title={option.label}
                disableInteractive
                disableFocusListener
                PopperProps={{ container }}
              >
                <label className='ps-map-style-option'>
                  <input
                    className='sr-only'
                    type='radio'
                    name={`${id}-structure`}
                    aria-label={option.label}
                    value={option.value}
                    checked={structure === option.value}
                    autoFocus={structure === option.value}
                    onChange={() => onStructure(option.value)}
                  />
                  <span>
                    <StructurePreview structure={option.value} />
                  </span>
                </label>
              </Tooltip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Branch line</legend>
          <div className='ps-map-style-options ps-map-line-options'>
            {lines.map((option) => (
              <Tooltip
                key={option.value}
                title={option.label}
                disableInteractive
                disableFocusListener
                PopperProps={{ container }}
              >
                <label className='ps-map-style-option'>
                  <input
                    className='sr-only'
                    type='radio'
                    name={`${id}-line`}
                    aria-label={option.label}
                    value={option.value}
                    checked={branchLine === option.value}
                    onChange={() => onBranchLine(option.value)}
                  />
                  <span>
                    <svg
                      viewBox='0 0 100 54'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      aria-hidden='true'
                    >
                      <path
                        d={
                          option.value === 'rounded'
                            ? 'M 18 27 H 46 M 70 9 H 58 Q 46 9 46 21 V 33 Q 46 45 58 45 H 70'
                            : 'M 18 27 H 28 C 48 27 50 9 74 9 M 28 27 C 48 27 50 45 74 45'
                        }
                      />
                    </svg>
                  </span>
                </label>
              </Tooltip>
            ))}
          </div>
        </fieldset>
      </Popover>
    </>
  );
}
