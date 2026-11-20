import { useEffect, useState } from 'react';

const STEPS = ['Reading file', 'Decoding pixels', 'Building preview'];

export function DecodingPanel({ fileName }: { fileName?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative min-h-[280px] overflow-hidden border border-[#2c2f3a] bg-[#101117]"
    >
      <style>{`
        @keyframes dec-scan { 0% { top: 0; } 100% { top: 100%; } }
        @keyframes dec-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes dec-blink { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .dec-anim { animation: none !important; }
        }
      `}</style>

      <div className="flex items-center gap-2 border-b border-[#2c2f3a] px-3 py-2 sm:px-4">
        <span className="dec-anim h-1.5 w-1.5 bg-[#2f6bff]" style={{ animation: 'dec-blink 1s ease-in-out infinite' }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8e9c]">Decoding image</span>
      </div>

      <div className="flex flex-col gap-4 p-3 sm:p-5">
        {/* Scan preview */}
        <div className="relative mx-auto aspect-[16/9] w-full max-w-sm overflow-hidden border border-[#2c2f3a] bg-[#0c0d12]">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(#2c2f3a 1px, transparent 1px), linear-gradient(90deg, #2c2f3a 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />
          <div
            className="dec-anim absolute left-0 right-0 h-0.5 bg-[#2f6bff] shadow-[0_0_12px_2px_rgba(47,107,255,0.6)]"
            style={{ animation: 'dec-scan 1.6s linear infinite' }}
          />
        </div>

        {/* Indeterminate bar */}
        <div className="h-1.5 w-full overflow-hidden border border-[#2c2f3a] bg-[#0c0d12]">
          <div
            className="dec-anim h-full w-2/5 bg-white"
            style={{ animation: 'dec-bar 1.2s ease-in-out infinite' }}
          />
        </div>

        {/* Steps */}
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={label}
                className={`flex min-h-10 items-center justify-center gap-1.5 border px-1.5 text-center font-mono text-[10px] uppercase leading-tight tracking-[0.08em] transition-colors duration-200 ${
                  active
                    ? 'border-white bg-white text-[#0c0d12]'
                    : done
                      ? 'border-[#0fa36b] bg-[#0fa36b]/15 text-[#0fa36b]'
                      : 'border-[#2c2f3a] text-[#6a6e7c]'
                }`}
              >
                {done ? '✓ ' : ''}
                {label}
              </li>
            );
          })}
        </ol>

        {fileName && (
          <p className="truncate text-center font-mono text-[11px] text-[#8a8e9c]">{fileName}</p>
        )}
      </div>
    </div>
  );
}
