import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DownloadIcon } from './icons';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface whitespace-nowrap shrink-0"
      >
        <DownloadIcon className="h-3.5 w-3.5 text-accent" />
        <span>Install app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface whitespace-nowrap shrink-0"
        >
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Install Cutout on iOS"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          >
            <div className="card-surface w-full max-w-sm p-6">
              <h2 className="text-base font-semibold text-ink">Install on iPhone or iPad</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                1. Tap the <strong className="text-ink">Share</strong> button in Safari&apos;s toolbar.
                <br />
                2. Scroll down and tap <strong className="text-ink">Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="btn-primary mt-5 w-full rounded-lg py-2.5 text-sm font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
