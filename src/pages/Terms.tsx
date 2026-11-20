import { Link } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';
import { APP_NAME } from '../config';
import { useHead } from '../hooks/useHead';

// --- Blueprint Dark Design Tokens ---
const COLORS = {
  bg: '#0c0d12',
  bgRaised: '#101117',
  line: '#23252d',
  lineStrong: '#3a3d48',
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

export default function Terms() {
  useHead({
    title: `Terms of Use — ${APP_NAME}`,
    description: `Terms of use for ${APP_NAME}, a free client-side background removal studio running locally in your browser without AI or uploads.`,
    path: '/terms',
  });

  return (
    <div className={`flex min-h-dvh flex-col bg-[${COLORS.bg}] text-[${COLORS.text}] font-sans selection:bg-[${COLORS.accent}] selection:text-[${COLORS.text}]`}>
      {/* Frame Lines */}
      <div className={`fixed left-[44px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />
      <div className={`fixed right-[28px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />

      <Navbar />

      <main className="flex-1 md:ml-[44px] md:mr-[28px] py-12 md:py-16 px-4 md:px-6">
        <section className={`relative max-w-4xl mx-auto border border-[${COLORS.line}] bg-[${COLORS.bg}]`}>
          <Crosshair position="top-left" />
          <Crosshair position="top-right" />
          <Crosshair position="bottom-left" />
          <Crosshair position="bottom-right" />

          {/* Caption Strip */}
          <div className={`h-12 border-b border-[${COLORS.line}] flex items-center justify-between px-4 md:px-6`}>
            <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c]">
              01 / TERMS OF USE
            </span>
            <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c] hidden sm:block">
              EFFECTIVE NOVEMBER 2026 · {APP_NAME.toUpperCase()}
            </span>
          </div>

          {/* Content */}
          <div className="p-6 md:p-10">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4">
              Usage <span className="font-serif italic text-[#0fa36b]">terms.</span>
            </h1>
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}] max-w-2xl mb-12`}>
              Terms of use for {APP_NAME}, a free client-side background removal studio running locally in your browser without AI or uploads.
            </p>

            <div className="space-y-0 border-t border-[${COLORS.line}]">
              {[
                {
                  id: '01',
                  title: 'Service description',
                  content: `${APP_NAME} provides a free, client-side web utility for removing backgrounds and editing alpha masks on PNG, JPEG, and WebP images completely inside your browser without accounts, uploads, or AI services. You retain full ownership and copyright over all images you process and export.`
                },
                {
                  id: '02',
                  title: 'Acceptable use',
                  content: `You are responsible for ensuring you have the legal rights or permission to edit and export any images you process with ${APP_NAME}. Because all processing happens locally on your own hardware, ${APP_NAME} never inspects, moderates, or stores your files.`
                },
                {
                  id: '03',
                  title: 'Availability and warranties',
                  content: `${APP_NAME} is provided on an “as is” and “as available” basis without warranties of any kind, whether express or implied. Output quality depends on image lighting, subject contrast, and your editing selections.`
                },
                {
                  id: '04',
                  title: 'Limitation of liability',
                  content: `To the fullest extent permitted by law, the maintainers of ${APP_NAME} shall not be liable for any indirect, incidental, or consequential damages arising from your use of the tool, browser memory constraints, or exported image accuracy.`
                }
              ].map((item) => (
                <div key={item.id} className={`border-b border-[${COLORS.line}] last:border-b-0 p-6 md:p-8 relative group hover:bg-[${COLORS.bgRaised}] transition-colors duration-150`}>
                  <span className={`absolute top-6 right-6 md:top-8 md:right-8 font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textDim}]`}>
                    {item.id}
                  </span>
                  <h2 className="text-xl md:text-2xl font-bold tracking-tight leading-[1.1] mb-4 pr-12">{item.title}</h2>
                  <p className={`text-[14px] md:text-[15px] leading-[1.6] text-[${COLORS.textBody}]`}>
                    {item.content}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-10 pt-8 border-t border-[${COLORS.line}]">
              <Link
                to="/"
                className={`inline-flex h-12 px-6 bg-transparent border border-[${COLORS.lineStrong}] text-[${COLORS.text}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[${COLORS.bgRaised}] transition-colors duration-150 items-center justify-center`}
              >
                BACK TO HOME
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}