import { useState } from 'react';
import { MAX_FILE_MB, MAX_SIDE_PX } from '../config';
import { AlertIcon, UploadIcon } from './icons';

// --- Blueprint Dark Design Tokens ---
const COLORS = {
  bg: '#0c0d12',
  bgRaised: '#101117',
  line: '#23252d',
  lineStrong: '#3a3d48',
  text: '#ffffff',
  textBody: '#c9ccd6',
  textMuted: '#7b7f8c',
  accent: '#0fa36b',
  inverseBg: '#ffffff',
  inverseText: '#0c0d12',
};

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  onOpenPicker: () => void;
  onTrySample?: () => void;
  inlineError?: string | null;
  disabled?: boolean;
}

export function DropZone({
  onFileSelected,
  onOpenPicker,
  onTrySample,
  inlineError,
  disabled = false,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled && !isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const file = event.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenPicker();
    }
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload an image by clicking, dragging and dropping, or pasting from clipboard"
        aria-disabled={disabled}
        onClick={() => !disabled && onOpenPicker()}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center border-2 border-dashed p-6 text-center transition-colors duration-150 sm:min-h-[340px] sm:p-10 ${
          isDragging
            ? `border-[${COLORS.accent}] bg-[${COLORS.bgRaised}]`
            : `border-[${COLORS.line}] hover:border-[${COLORS.lineStrong}] hover:bg-[${COLORS.bgRaised}]`
        } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        {/* Corner Marks for Engineering Feel */}
        {!isDragging && (
          <>
            <div className="absolute left-2 top-2 h-2 w-2 border-l border-t border-[#7b7f8c]" />
            <div className="absolute right-2 top-2 h-2 w-2 border-r border-t border-[#7b7f8c]" />
            <div className="absolute bottom-2 left-2 h-2 w-2 border-b border-l border-[#7b7f8c]" />
            <div className="absolute bottom-2 right-2 h-2 w-2 border-b border-r border-[#7b7f8c]" />
          </>
        )}

        <div className={`flex h-14 w-14 items-center justify-center border border-[${COLORS.line}] bg-[${COLORS.bgRaised}] text-[${COLORS.accent}]`}>
          <UploadIcon className="h-6 w-6" />
        </div>

        <h2 className={`mt-5 text-xl font-bold tracking-tight text-[${COLORS.text}]`}>
          DROP IMAGE HERE
        </h2>
        <p className={`mt-2 max-w-md text-[14px] leading-[1.6] text-[${COLORS.textBody}]`}>
          Supports PNG, JPEG, and WebP up to {MAX_FILE_MB} MB and {MAX_SIDE_PX.toLocaleString()} px. 
          Paste directly with{' '}
          <kbd className={`font-mono text-[11px] uppercase tracking-[0.12em] border border-[${COLORS.line}] bg-[${COLORS.bg}] px-1.5 py-0.5 text-[${COLORS.textMuted}]`}>
            Ctrl/Cmd+V
          </kbd>
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenPicker(); }}
            className="flex h-12 items-center justify-center rounded-none bg-white px-6 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[#0c0d12] transition-colors duration-150 hover:bg-[#c9ccd6]"
          >
            CHOOSE IMAGE
          </button>
          {onTrySample && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTrySample();
              }}
              className={`h-12 px-6 bg-transparent border border-[${COLORS.lineStrong}] text-[${COLORS.text}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[${COLORS.bgRaised}] transition-colors duration-150 flex items-center justify-center`}
            >
              TRY SAMPLE
            </button>
          )}
        </div>
      </div>

      {inlineError && (
        <div
          role="alert"
          className={`flex items-start gap-3 border border-[${COLORS.line}] bg-[${COLORS.bgRaised}] px-4 py-3 text-sm`}
        >
          <AlertIcon className={`mt-0.5 h-4 w-4 shrink-0 text-[${COLORS.accent}]`} />
          <span className={`text-[${COLORS.textBody}]`}>{inlineError}</span>
        </div>
      )}
    </div>
  );
}