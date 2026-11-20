import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setHandoffFile } from '../lib/handoff';
import { CompareSlider } from './CompareSlider';
import { ArrowRightIcon, UploadIcon } from './icons';

export function Hero() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);

  const handleDropFile = (file: File | undefined) => {
    if (!file) return;
    setHandoffFile(file);
    navigate('/studio');
  };

  return (
    <section
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
          handleDropFile(file);
        }
      }}
      className="relative mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 lg:pt-20 lg:pb-24"
    >
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/85 backdrop-blur-sm">
          <div className="card-surface flex flex-col items-center gap-3 border-2 border-dashed border-accent px-10 py-8 text-center">
            <UploadIcon className="h-8 w-8 text-accent" />
            <p className="text-lg font-semibold text-ink">Drop image to open Studio</p>
            <p className="text-xs text-muted">Processed locally on your device — never uploaded</p>
          </div>
        </div>
      )}

      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="animate-enter lg:col-span-6">
          <h1 className="max-w-xl text-[clamp(2.25rem,4vw,3.75rem)] font-bold leading-[1.08] tracking-tight text-ink [text-wrap:balance]">
            Studio-clean background removal,{' '}
            <span className="bg-gradient-to-r from-accent to-accent-end bg-clip-text text-transparent">
              inside your browser
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Runs entirely in your browser. No uploads. No account. No AI. Fast, deterministic cutouts with full-resolution export.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/studio"
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <span>Remove background</span>
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center rounded-lg border border-border bg-panel px-5 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface whitespace-nowrap shrink-0"
            >
              How it works
            </a>
          </div>
          <p className="mt-3 text-xs text-muted">
            Tip: Drop a PNG, JPEG, or WebP right here to jump straight into Studio.
          </p>
        </div>

        <div className="animate-enter lg:col-span-6">
          <div className="card-surface p-2">
            <CompareSlider
              beforeSrc="/samples/before.svg"
              afterSrc="/samples/after.svg"
              beforeAlt="Sample product photo of a rangefinder camera with studio room background"
              afterAlt="Same rangefinder camera with its background cleanly removed"
              autoAnimate={true}
            />
          </div>
          <p className="mt-2.5 text-right text-xs text-muted">
            Drag slider or use arrow keys to compare before and after
          </p>
        </div>
      </div>
    </section>
  );
}
