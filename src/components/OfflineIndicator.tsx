import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-panel px-3 py-2 text-xs font-medium text-amber-200 shadow-soft"
    >
      <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
      <span>Offline mode — cached models ready</span>
    </div>
  );
}
