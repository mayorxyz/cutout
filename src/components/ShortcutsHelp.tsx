import { useEffect, useRef, useState } from 'react';
import { KeyboardIcon } from './icons';

const SHORTCUTS = [
  { key: 'V', label: 'Pan / Hand tool' },
  { key: 'B', label: 'Select brush / Restore brush' },
  { key: 'W', label: 'Magic Wand (CIELAB)' },
  { key: 'L', label: 'Freehand lasso' },
  { key: 'P', label: 'Polygon lasso' },
  { key: 'M', label: 'Rectangle select' },
  { key: 'E', label: 'Ellipse select' },
  { key: 'X', label: 'Swap Add/Subtract or Restore/Erase' },
  { key: '[ / ]', label: 'Decrease / increase brush size' },
  { key: 'Shift / Alt', label: 'Add / Subtract selection' },
  { key: 'Enter', label: 'Erase background (from selection)' },
  { key: 'Esc', label: 'Cancel current selection operation' },
  { key: 'Ctrl/Cmd + Z', label: 'Undo edit' },
  { key: 'Ctrl/Cmd + Shift + Z', label: 'Redo edit' },
  { key: 'Space + Drag', label: 'Hold to pan canvas' },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Keyboard shortcuts"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-panel px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface hover:text-ink whitespace-nowrap"
      >
        <KeyboardIcon className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Shortcuts</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="absolute right-0 z-50 mt-2 w-80 rounded-card border border-border bg-panel p-4 shadow-soft"
        >
          <p className="text-xs font-semibold text-ink">Keyboard shortcuts</p>
          <dl className="mt-3 space-y-1.5">
            {SHORTCUTS.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                <dt className="text-muted">{item.label}</dt>
                <dd className="shrink-0">
                  <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink">
                    {item.key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
