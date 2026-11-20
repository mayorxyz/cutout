import { Link } from 'react-router-dom';
import { APP_NAME } from '../config';
import { BrandMark } from './icons';

// --- Blueprint Dark Design Tokens ---
const COLORS = {
  bg: '#0c0d12',
  line: '#23252d',
  text: '#ffffff',
  textBody: '#c9ccd6',
  textMuted: '#7b7f8c',
  textDim: '#555966',
  brandBlue: '#2f6bff',
};

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={`border-t border-[${COLORS.line}] bg-[${COLORS.bg}] md:ml-[44px] md:mr-[28px]`}>
      {/* Main Footer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5">
        
        {/* Brand Column (Spans 2 cols on desktop) */}
        <div className="md:col-span-2 p-6 md:p-8 border-b md:border-b-0 md:border-r border-[#23252d]">
          <div className="flex items-center gap-3 mb-6">
            <BrandMark className="h-8 w-8 shrink-0 text-[#ffffff]" />
            <span className="text-lg font-bold tracking-tight text-[${COLORS.text}]">{APP_NAME}</span>
          </div>
          <p className={`text-[16px] leading-[1.5] text-[${COLORS.textBody}] mb-6 max-w-xs`}>
            Free, private background remover that runs entirely inside your browser. No uploads, no account, no AI.
          </p>
          <a href="mailto:hello@example.com" className={`font-mono text-[11px] uppercase tracking-[0.12em] text-[${COLORS.textMuted}] hover:text-[${COLORS.brandBlue}] transition-colors`}>
            HELLO@EXAMPLE.COM
          </a>
        </div>

        {/* Product Column */}
        <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-[#23252d]">
          <h4 className={`font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] mb-4`}>PRODUCT</h4>
          <ul className="space-y-3">
            <li><Link to="/studio" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Studio</Link></li>
            <li><Link to="/" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Features</Link></li>
            <li><Link to="/" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Pricing</Link></li>
          </ul>
        </div>

        {/* Resources Column */}
        <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-[#23252d]">
          <h4 className={`font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] mb-4`}>RESOURCES</h4>
          <ul className="space-y-3">
            <li><Link to="/privacy" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Privacy Policy</Link></li>
            <li><Link to="/terms" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Terms of Use</Link></li>
            <li><a href="#" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Documentation</a></li>
          </ul>
        </div>

        {/* Community Column */}
        <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-[#23252d] last:border-r-0">
          <h4 className={`font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textMuted}] mb-4`}>COMMUNITY</h4>
          <ul className="space-y-3">
            <li><a href="#" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>GitHub</a></li>
            <li><a href="#" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Discord</a></li>
            <li><a href="#" className={`text-[14px] text-[${COLORS.text}] hover:text-[${COLORS.brandBlue}] transition-colors`}>Twitter / X</a></li>
          </ul>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className={`h-12 border-t border-[${COLORS.line}] flex items-center justify-between px-4 md:px-6`}>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] text-[${COLORS.textDim}]`}>
          © {currentYear} {APP_NAME.toUpperCase()}
        </span>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] text-[${COLORS.textDim}]`}>
          SYSTEM STATUS: OPERATIONAL
        </span>
      </div>
    </footer>
  );
}