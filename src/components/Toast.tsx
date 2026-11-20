import { AlertIcon, CheckIcon, CloseIcon } from './icons';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error';
  text: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;

  const isError = toast.type === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-card border border-border bg-panel px-4 py-3 text-sm text-ink shadow-soft"
    >
      {isError ? (
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      ) : (
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <p className="flex-1 leading-snug">{toast.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-0.5 text-muted transition-colors hover:text-ink"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
