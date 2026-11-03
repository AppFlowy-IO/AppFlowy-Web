import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTransformComponent, type ReactZoomPanPinchContextState } from 'react-zoom-pan-pinch';

import { ReactComponent as BackIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as RootIcon } from '@/assets/icons/arrow_left_line.svg';
import { ReactComponent as DrillIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as CollapseIcon } from '@/assets/icons/collapse.svg';
import { ReactComponent as ExitFullscreenIcon } from '@/assets/icons/exit_full_screen.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { ReactComponent as FitIcon } from '@/assets/icons/fit_content.svg';
import { ReactComponent as FullscreenIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as MinusIcon } from '@/assets/icons/minus.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as ResetIcon } from '@/assets/icons/reset.svg';
import { isMac } from '@/utils/hotkeys';

import MindMapStylePicker from './MindMapStylePicker';

import type { MapBranchLine, MapStructure } from './mindmap-layout';
import type { usePresentationFullscreen } from './usePresentationFullscreen';
import type { ComponentType, SVGProps } from 'react';

function MapTool({
  label,
  shortcut,
  keyShortcut,
  detail,
  Icon,
  onClick,
  disabled,
  pressed,
  container,
}: {
  label: string;
  shortcut?: string;
  keyShortcut?: string;
  detail?: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  container: HTMLElement | null;
}) {
  return (
    <Tooltip
      placement='top'
      disableInteractive
      PopperProps={{ container }}
      title={
        <div className='ps-map-tool-tooltip'>
          <span>{label}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
          {detail && <span className='ps-map-tool-detail'>{detail}</span>}
        </div>
      }
    >
      <span className='ps-map-tool-trigger'>
        <IconButton
          size='small'
          className='ps-map-tool'
          aria-label={label}
          aria-keyshortcuts={keyShortcut}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className='h-5 w-5' aria-hidden='true' />
        </IconButton>
      </span>
    </Tooltip>
  );
}

/** Module-level, so the pan/zoom subscription is not recreated on every render. */
const selectZoom = ({ state }: ReactZoomPanPinchContextState) => Math.round(state.scale * 100);

export default function MindMapToolbar({
  container,
  minZoom,
  focused,
  canDrill,
  fullscreen,
  structure,
  branchLine,
  onStructure,
  onBranchLine,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
  onCollapse,
  onExpand,
  onDrill,
  onParent,
  onShowAll,
}: {
  container: HTMLElement | null;
  minZoom: number;
  focused: boolean;
  canDrill: boolean;
  fullscreen: ReturnType<typeof usePresentationFullscreen>;
  structure: MapStructure;
  branchLine: MapBranchLine;
  onStructure: (value: MapStructure) => void;
  onBranchLine: (value: MapBranchLine) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  onFit: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onDrill: () => void;
  onParent: () => void;
  onShowAll: () => void;
}) {
  const mac = isMac();
  const modifier = mac ? '⌘' : 'Ctrl';
  const keyModifier = mac ? 'Meta' : 'Control';
  // Only the toolbar shows the zoom; it re-renders when the rounded value changes, not the whole map.
  const zoom = useTransformComponent(selectZoom);

  return (
    <div className='ps-map-controls' role='group' aria-label='Mind map controls'>
      <span className='sr-only' aria-label='Zoom level'>
        {zoom}%
      </span>
      <MapTool
        container={container}
        label='Zoom out'
        shortcut='−'
        Icon={MinusIcon}
        disabled={zoom <= minZoom}
        onClick={onZoomOut}
      />
      <MapTool
        container={container}
        label='Zoom in'
        shortcut='+'
        Icon={PlusIcon}
        disabled={zoom >= 400}
        onClick={onZoomIn}
      />
      <MapTool
        container={container}
        label='Reset zoom to 100%'
        detail={`Current zoom: ${zoom}%`}
        Icon={ResetIcon}
        onClick={onReset}
      />
      <MapTool
        container={container}
        label='Fit to screen'
        shortcut='F / 0'
        keyShortcut='F 0'
        Icon={FitIcon}
        onClick={onFit}
      />
      <span className='ps-map-toolbar-separator' aria-hidden='true' />
      <MindMapStylePicker
        container={container}
        structure={structure}
        branchLine={branchLine}
        onStructure={onStructure}
        onBranchLine={onBranchLine}
      />
      <MapTool container={container} label='Collapse all' Icon={CollapseIcon} onClick={onCollapse} />
      <MapTool container={container} label='Expand all' Icon={ExpandIcon} onClick={onExpand} />
      <span className='ps-map-toolbar-separator' aria-hidden='true' />
      <MapTool
        container={container}
        label='Drill down into selected node'
        shortcut={`${modifier} + ]`}
        keyShortcut={`${keyModifier}+]`}
        Icon={DrillIcon}
        disabled={!canDrill}
        onClick={onDrill}
      />
      {focused && (
        <>
          <MapTool
            container={container}
            label='Back to parent node'
            shortcut={`${modifier} + [`}
            keyShortcut={`${keyModifier}+[`}
            Icon={BackIcon}
            onClick={onParent}
          />
          <MapTool container={container} label='Show all branches' Icon={RootIcon} onClick={onShowAll} />
        </>
      )}
      <span className='ps-map-toolbar-separator' aria-hidden='true' />
      <div className='ps-fullscreen-control'>
        {fullscreen.error && (
          <span className='ps-fullscreen-error' role='alert'>
            {fullscreen.error}
          </span>
        )}
        <MapTool
          container={container}
          label={fullscreen.active ? 'Exit fullscreen' : 'Present mind map fullscreen'}
          shortcut={fullscreen.active ? 'Esc' : undefined}
          keyShortcut={fullscreen.active ? 'Escape' : undefined}
          Icon={fullscreen.active ? ExitFullscreenIcon : FullscreenIcon}
          pressed={fullscreen.active}
          disabled={fullscreen.pending}
          onClick={() => void fullscreen.toggle()}
        />
      </div>
    </div>
  );
}
