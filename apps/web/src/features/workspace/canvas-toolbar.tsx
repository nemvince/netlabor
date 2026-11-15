import { AlignCenterHorizontalIcon as AlignCenterHorizontal, AlignCenterVerticalIcon as AlignCenterVertical, AlignBottomIcon as AlignEndHorizontal, AlignRightIcon as AlignEndVertical, AlignTopIcon as AlignStartHorizontal, AlignLeftIcon as AlignStartVertical, PlugIcon as Cable, ClipboardIcon as ClipboardPaste, ColumnsIcon as Columns3, CopyIcon as Copy, GridNineIcon as Grid3x3, ImageIcon as ImageIcon, StackIcon as Layers, LinkIcon as Link2, MagnetIcon as Magnet, MapTrifoldIcon as MapIcon, PaintBrushBroadIcon as PaintBucket, PlayIcon as Play, RectangleIcon as RectangleHorizontal, ArrowArcRightIcon as Redo2, RowsIcon as Rows3, SquareIcon as Square, StickerIcon as StickyNote, TrashIcon as Trash2, TextAaIcon as Type, ArrowArcLeftIcon as Undo2   } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@netlabor/ui/components/dropdown-menu';
import type { ReactNode } from 'react';
import { useRef } from 'react';

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

interface CanvasToolbarProps {
  selectionCount: number;
  nodeSelectionCount: number;
  canControl: boolean;
  canEdit: boolean;
  canDraw: boolean;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  layers: string[];
  layerFilter: string;
  gridVisible: boolean;
  snapEnabled: boolean;
  minimapVisible: boolean;
  portLabelsAlways: boolean;
  onToggleMinimap: () => void;
  onTogglePortLabels: () => void;
  canvasBackground: string;
  onChangeCanvasBackground: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onAddDrawing: (type: 'rect' | 'text' | 'note') => void;
  onAddImage: (file: File) => void;
  onLayerFilter: (layer: string) => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onDelete: () => void;
  onStartSelected: () => void;
  onStopSelected: () => void;
  connectMode: boolean;
  onToggleConnect: () => void;
}

const MENU_CLASS = 'z-50 min-w-44 rounded-[3px] border p-1';
const MENU_STYLE = {
  background: 'var(--color-panel)',
  borderColor: 'var(--color-rule-strong)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
} as const;
const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 text-[12px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/[0.06]';

function ToolButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="nb-button"
      data-size="sm"
      data-variant="ghost"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={
        active ? { color: 'var(--color-copper)', borderColor: 'var(--color-copper)' } : undefined
      }
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  children,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem className={ITEM_CLASS} disabled={disabled} onSelect={onSelect}>
      <span aria-hidden style={{ color: 'var(--color-ink-faint)' }}>
        {icon}
      </span>
      {children}
    </DropdownMenuItem>
  );
}

function ViewToggle({
  checked,
  children,
  onCheckedChange,
}: {
  checked: boolean;
  children: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      className={ITEM_CLASS}
      checked={checked}
      onCheckedChange={() => onCheckedChange(!checked)}
      onSelect={(event) => event.preventDefault()}
    >
      {children}
    </DropdownMenuCheckboxItem>
  );
}

/** Compact canvas toolbar: history, clipboard, alignment, drawing, and view. */
export function CanvasToolbar({
  selectionCount,
  nodeSelectionCount,
  canControl,
  canEdit,
  canDraw,
  canPaste,
  canUndo,
  canRedo,
  layers,
  layerFilter,
  gridVisible,
  snapEnabled,
  minimapVisible,
  portLabelsAlways,
  canvasBackground,
  onChangeCanvasBackground,
  onToggleMinimap,
  onTogglePortLabels,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onAlign,
  onDistribute,
  onAddDrawing,
  onAddImage,
  onLayerFilter,
  onToggleGrid,
  onToggleSnap,
  onDelete,
  onStartSelected,
  onStopSelected,
  connectMode,
  onToggleConnect,
}: CanvasToolbarProps) {
  const multi = selectionCount >= 2;
  const triple = selectionCount >= 3;
  const imageInputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-nowrap items-center gap-0.5 overflow-x-auto rounded-[3px] border px-1 py-0.5"
      style={{
        background: 'color-mix(in oklab, var(--color-panel) 94%, transparent)',
        borderColor: 'var(--color-rule-strong)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      }}
      role="toolbar"
      aria-label="Canvas tools"
    >
      <ToolButton label="Undo" onClick={onUndo} disabled={!canUndo}>
        <Undo2 size={13} aria-hidden />
      </ToolButton>
      <ToolButton label="Redo" onClick={onRedo} disabled={!canRedo}>
        <Redo2 size={13} aria-hidden />
      </ToolButton>
      <Separator />
      <ToolButton label="Copy selected nodes" onClick={onCopy} disabled={!canEdit}>
        <Copy size={13} aria-hidden />
      </ToolButton>
      <ToolButton label="Paste nodes" onClick={onPaste} disabled={!canPaste || !canEdit}>
        <ClipboardPaste size={13} aria-hidden />
      </ToolButton>
      <Separator />
      <ToolButton
        label={connectMode ? 'Cancel connection (Esc)' : 'Connect nodes (L)'}
        onClick={onToggleConnect}
        disabled={!canEdit}
        active={connectMode}
      >
        <Link2 size={13} aria-hidden /> Connect
      </ToolButton>
      <Separator />
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            data-variant="ghost"
            disabled={!canEdit || !multi}
            title={multi ? 'Align or distribute selection' : 'Select at least two nodes'}
          >
            <AlignStartVertical size={13} aria-hidden /> Align
          </button>
        }>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className={MENU_CLASS}
            style={MENU_STYLE}
          >
            <MenuItem icon={<AlignStartVertical size={13} />} onSelect={() => onAlign('left')}>
              Align left
            </MenuItem>
            <MenuItem icon={<AlignCenterVertical size={13} />} onSelect={() => onAlign('center-h')}>
              Align centers
            </MenuItem>
            <MenuItem icon={<AlignEndVertical size={13} />} onSelect={() => onAlign('right')}>
              Align right
            </MenuItem>
            <DropdownMenuSeparator
              className="my-1 h-px"
              style={{ background: 'var(--color-rule)' }}
            />
            <MenuItem icon={<AlignStartHorizontal size={13} />} onSelect={() => onAlign('top')}>
              Align top
            </MenuItem>
            <MenuItem icon={<AlignCenterHorizontal size={13} />} onSelect={() => onAlign('middle')}>
              Align middles
            </MenuItem>
            <MenuItem icon={<AlignEndHorizontal size={13} />} onSelect={() => onAlign('bottom')}>
              Align bottom
            </MenuItem>
            <DropdownMenuSeparator
              className="my-1 h-px"
              style={{ background: 'var(--color-rule)' }}
            />
            <MenuItem
              icon={<Columns3 size={13} />}
              onSelect={() => onDistribute('horizontal')}
              disabled={!triple}
            >
              Distribute horizontally
            </MenuItem>
            <MenuItem
              icon={<Rows3 size={13} />}
              onSelect={() => onDistribute('vertical')}
              disabled={!triple}
            >
              Distribute vertically
            </MenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            data-variant="ghost"
            disabled={!canDraw}
            title="Insert a drawing annotation"
          >
            <Type size={13} aria-hidden /> Insert
          </button>
        }>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className={MENU_CLASS}
            style={MENU_STYLE}
          >
            <MenuItem
              icon={<RectangleHorizontal size={13} />}
              onSelect={() => onAddDrawing('rect')}
            >
              Rectangle
            </MenuItem>
            <MenuItem icon={<Type size={13} />} onSelect={() => onAddDrawing('text')}>
              Text
            </MenuItem>
            <MenuItem icon={<StickyNote size={13} />} onSelect={() => onAddDrawing('note')}>
              Note
            </MenuItem>
            <MenuItem
              icon={<ImageIcon size={13} />}
              onSelect={() => imageInputRef.current?.click()}
            >
              Image…
            </MenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <input
        ref={imageInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
        aria-hidden
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onAddImage(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            data-variant="ghost"
            title="Canvas display options"
          >
            <Grid3x3 size={13} aria-hidden /> View
          </button>
        }>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className={MENU_CLASS}
            style={MENU_STYLE}
          >
            <ViewToggle checked={gridVisible} onCheckedChange={onToggleGrid}>
              <Grid3x3 size={13} aria-hidden /> Grid
            </ViewToggle>
            <ViewToggle checked={snapEnabled} onCheckedChange={onToggleSnap}>
              <Magnet size={13} aria-hidden /> Snap to grid
            </ViewToggle>
            <ViewToggle checked={minimapVisible} onCheckedChange={onToggleMinimap}>
              <MapIcon size={13} aria-hidden /> Minimap
            </ViewToggle>
            <ViewToggle checked={portLabelsAlways} onCheckedChange={onTogglePortLabels}>
              <Cable size={13} aria-hidden /> Always show port numbers
            </ViewToggle>
            <label
              className="flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 text-[12px] hover:bg-white/[0.06]"
              title="Canvas background colour"
            >
              <PaintBucket size={13} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
              Background
              <input
                type="color"
                aria-label="Canvas background colour"
                value={canvasBackground || '#12161b'}
                onChange={(event) => onChangeCanvasBackground(event.target.value)}
                className="ml-auto size-5 cursor-pointer rounded-[2px] border-0 bg-transparent p-0"
              />
              {canvasBackground ? (
                <button
                  type="button"
                  aria-label="Reset canvas background"
                  className="text-[10px] hover:text-[var(--color-copper)]"
                  style={{ color: 'var(--color-ink-faint)' }}
                  onClick={() => onChangeCanvasBackground('')}
                >
                  reset
                </button>
              ) : null}
            </label>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <label
        className="flex items-center gap-1 px-1 text-[10px]"
        style={{ color: 'var(--color-ink-faint)' }}
      >
        <Layers size={12} aria-hidden />
        <select
          aria-label="Layer filter"
          value={layerFilter}
          onChange={(event) => onLayerFilter(event.target.value)}
          className="border-0 bg-transparent text-[10px] outline-none"
          style={{ color: 'var(--color-ink)' }}
        >
          <option value="all">all layers</option>
          {layers.map((layer) => (
            <option key={layer} value={layer}>
              {layer}
            </option>
          ))}
        </select>
      </label>
      <Separator />
      <ToolButton
        label="Start selected nodes"
        onClick={onStartSelected}
        disabled={!canControl || nodeSelectionCount === 0}
      >
        <Play size={13} aria-hidden /> Start
      </ToolButton>
      <ToolButton
        label="Stop selected nodes"
        onClick={onStopSelected}
        disabled={!canControl || nodeSelectionCount === 0}
      >
        <Square size={13} aria-hidden /> Stop
      </ToolButton>
      <Separator />
      <ToolButton
        label="Delete selection"
        onClick={onDelete}
        disabled={!canEdit || selectionCount === 0}
      >
        <Trash2 size={13} aria-hidden />
      </ToolButton>
    </div>
  );
}

function Separator() {
  return (
    <span
      aria-hidden
      className="mx-0.5 h-4 w-px shrink-0"
      style={{ background: 'var(--color-rule)' }}
    />
  );
}
