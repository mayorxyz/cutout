import { Link } from 'react-router-dom';
import { APP_NAME } from '../config';
import { useHead } from '../hooks/useHead';

// --- Blueprint Dark Design Tokens ---
const COLORS = {
  bg: '#0c0d12',
  line: '#23252d',
  text: '#ffffff',
  textBody: '#c9ccd6',
  textMuted: '#7b7f8c',
  textDim: '#555966',
  inverseBg: '#ffffff',
  inverseText: '#0c0d12',
  accent: '#0fa36b',
};

const Crosshair = ({ position }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) => {
  const posClasses = {
    'top-left': '-top-[5px] -left-[5px]',
    'top-right': '-top-[5px] -right-[5px]',
    'bottom-left': '-bottom-[5px] -left-[5px]',
    'bottom-right': '-bottom-[5px] -right-[5px]',
  };
  return (
    <div className={`absolute w-2.5 h-2.5 ${posClasses[position]} z-10 hidden md:block`}>
      <svg width="10" height="10" viewBox="0 0 10 10" className="text-[#555966]">
        <line x1="5" y1="0" x2="5" y2="10" stroke="currentColor" strokeWidth="1" />
        <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  );
};

export default function NotFound() {
  useHead({
    title: `Page Not Found — ${APP_NAME}`,
    description: `The page you requested could not be found on ${APP_NAME}.`,
    path: '/404',
  });

  return (
    <div className={`flex min-h-dvh flex-col bg-[${COLORS.bg}] text-[${COLORS.text}] font-sans selection:bg-[${COLORS.accent}] selection:text-[${COLORS.text}]`}>
      {/* Frame Lines */}
      <div className={`fixed left-[44px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />
      <div className={`fixed right-[28px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />

      {/* Minimal Nav for Error Page */}
      <nav className={`fixed top-0 left-[44px] right-[28px] h-12 border-b border-[${COLORS.line}] bg-[${COLORS.bg}] z-50 hidden md:flex items-center justify-between px-6`}>
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c]">
          {APP_NAME.toUpperCase()} / ERROR
        </div>
        <Link
          to="/"
          className={`h-full px-4 flex items-center font-mono text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c] hover:text-[${COLORS.text}] transition-colors duration-150`}
        >
          RETURN HOME
        </Link>
      </nav>

      <main className="flex-1 md:ml-[44px] md:mr-[28px] flex items-center justify-center p-4 md:p-8">
        <section className={`relative w-full max-w-2xl border border-[${COLORS.line}] bg-[${COLORS.bg}]`}>
          <Crosshair position="top-left" />
          <Crosshair position="top-right" />
          <Crosshair position="bottom-left" />
          <Crosshair position="bottom-right" />

          {/* Caption Strip */}
          <div className={`h-12 border-b border-[${COLORS.line}] flex items-center justify-between px-4 md:px-6`}>
            <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c]">
              01 / NOT FOUND
            </span>
            <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c] hidden sm:block">
              HTTP STATUS 404
            </span>
          </div>

          {/* Content */}
          <div className="p-8 md:p-12 text-center">
            <p className={`font-mono text-[10px] md:text-[11px] uppercase tracking-[0.16em] text-[${COLORS.accent}] mb-6`}>
              ERROR CODE: 404
            </p>
            
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] mb-6">
              Path <span className="font-serif italic text-[#0fa36b]">missing.</span>
            </h1>
            
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}] max-w-[480px] mx-auto mb-10`}>
              The page you are looking for does not exist or has been moved. Please verify the URL or return to the main entry point.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/"
                className={`h-12 px-6 bg-[${COLORS.inverseBg}] text-[${COLORS.inverseText}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[#c9ccd6] transition-colors duration-150 flex items-center justify-center min-w-[160px]`}
              >
                BACK TO HOME
              </Link>
              <Link
                to="/studio"
                className={`h-12 px-6 bg-transparent border border-[${COLORS.line}] text-[${COLORS.text}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[#101117] transition-colors duration-150 flex items-center justify-center min-w-[160px]`}
              >
                OPEN STUDIO
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Minimal Footer for Error Page */}
      <footer className={`border-t border-[${COLORS.line}] bg-[${COLORS.bg}] md:ml-[44px] md:mr-[28px]`}>
        <div className={`h-12 flex items-center justify-between px-4 md:px-6`}>
          <span className={`font-mono text-[10px] uppercase tracking-[0.12em] text-[${COLORS.textDim}]`}>
            © 2026 {APP_NAME.toUpperCase()}
          </span>
          <span className={`font-mono text-[10px] uppercase tracking-[0.12em] text-[${COLORS.textDim}]`}>
            SYSTEM STATUS: OPERATIONAL
          </span>
        </div>
      </footer>
    </div>
  );
}