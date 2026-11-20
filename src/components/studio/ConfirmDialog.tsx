import { useEffect } from 'react';

/* ---------- Blueprint Dark style tokens (design only) ---------- */
const MONO = 'font-mono uppercase tracking-[0.1em]';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050506]/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-[#101117] p-4 sm:p-5">
        <p className={`text-[10px] text-[#555966] ${MONO}`}>Confirm action</p>
        <h2
          id="confirm-dialog-title"
          className="mt-1.5 text-[15px] font-bold tracking-tight text-white sm:text-base"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-desc"
          className="mt-2 text-[13px] leading-relaxed text-[#c9ccd6] sm:text-sm"
        >
          {message}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:flex sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className={`h-9 rounded-lg bg-[#1a1c24] px-4 text-[10px] font-bold whitespace-nowrap text-white transition-colors duration-150 hover:bg-[#23252d] sm:h-10 sm:text-[11px] ${MONO}`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-9 rounded-lg px-4 text-[10px] font-bold whitespace-nowrap transition-colors duration-150 sm:h-10 sm:text-[11px] ${MONO} ${
              destructive
                ? 'bg-[#c23b3b] text-white hover:bg-[#d84a4a]'
                : 'bg-white text-[#0c0d12] hover:bg-[#c9ccd6]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}