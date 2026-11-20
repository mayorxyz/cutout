import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME } from '../config';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';
import { BrandMark, CloseIcon, MenuIcon } from './icons';

// --- Blueprint Dark Design Tokens ---
const COLORS = {
  bg: '#0c0d12',
  bgRaised: '#101117',
  line: '#23252d',
  lineStrong: '#3a3d48', // Stronger border for visibility
  text: '#ffffff',
  textMuted: '#7b7f8c',
};

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  return (
    <>
      {/* Desktop Fixed Nav */}
      <nav className={`fixed top-0 left-[44px] right-[28px] h-12 border-b border-[${COLORS.line}] bg-[${COLORS.bg}] z-50 hidden md:flex items-center`}>
        <div className="flex h-full w-full">
          {/* Logo Cell */}
          <Link to="/" className={`h-full w-12 border-r border-[${COLORS.line}] flex items-center justify-center hover:bg-[${COLORS.bgRaised}] transition-colors duration-150`}>
            <BrandMark className="h-5 w-5 shrink-0 text-[#ffffff]" />
          </Link>

          {/* Left Group */}
          <div className="flex h-full">
            {[
              { label: 'HOME', href: '/' },
              { label: 'HOW IT WORKS', href: '/#how-it-works' },
              { label: 'FAQ', href: '/#faq' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`h-full px-4 border-r border-[${COLORS.line}] flex items-center font-mono text-[11px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] hover:bg-[${COLORS.bgRaised}] hover:text-[${COLORS.text}] transition-colors duration-150`}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="flex-1" />

          {/* Right Group */}
          <div className="flex h-full items-center">
            <div className={`h-full border-l border-r border-[${COLORS.line}] flex items-center px-4`}>
               <PWAInstallButton />
            </div>
            <Link
              to="/studio"
              className={`h-full px-6 bg-[${COLORS.bgRaised}] border-l border-[${COLORS.line}] text-[${COLORS.text}] flex items-center font-mono text-[11px] uppercase font-bold tracking-[0.12em] hover:bg-[${COLORS.line}] transition-colors duration-150`}
            >
              LAUNCH APP
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile Header */}
      <header className={`sticky top-0 z-40 border-b border-[${COLORS.line}] bg-[${COLORS.bg}]/90 backdrop-blur-md md:hidden`}>
        <div className={`flex h-14 items-center justify-between px-4`}>
          <Link to="/" className="inline-flex shrink-0 items-center gap-2.5 text-lg font-bold tracking-tight text-[${COLORS.text}] whitespace-nowrap">
            <BrandMark className="h-6 w-6 shrink-0" />
            <span>{APP_NAME}</span>
          </Link>

          <button
            type="button"
            className={`inline-flex h-10 w-10 items-center justify-center border border-[${COLORS.line}] bg-[${COLORS.bgRaised}] text-[${COLORS.text}] transition-colors duration-150`}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div id="mobile-nav-menu" className={`border-t border-[${COLORS.line}] bg-[${COLORS.bgRaised}] px-4 py-4`}>
            <nav aria-label="Mobile navigation" className="flex flex-col gap-3">
              <Link
                to="/#how-it-works"
                className={`font-mono text-[11px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] hover:text-[${COLORS.text}] transition-colors duration-150`}
              >
                How it works
              </Link>
              <Link
                to="/#faq"
                className={`font-mono text-[11px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] hover:text-[${COLORS.text}] transition-colors duration-150`}
              >
                FAQ
              </Link>
              <div className="pt-2 border-t border-[${COLORS.line}]">
                <PWAInstallButton />
              </div>
              <Link
                to="/studio"
                className={`mt-2 inline-flex h-12 items-center justify-center bg-[${COLORS.bgRaised}] border border-[${COLORS.lineStrong}] text-[${COLORS.text}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[${COLORS.line}] transition-colors duration-150`}
              >
                OPEN STUDIO
              </Link>
            </nav>
          </div>
        )}
      </header>
      <OfflineIndicator />
    </>
  );
}