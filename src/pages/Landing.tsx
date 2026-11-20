import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaqAccordion } from '../components/FaqAccordion';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';
import { CompareSlider } from '../components/CompareSlider'; // Assuming this component exists
import { ArrowRightIcon, CheckIcon } from '../components/icons';
import { APP_NAME, SITE_URL } from '../config';
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
  brandBlue: '#2f6bff',
};

// --- Micro Components ---

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

const BlueprintButton = ({ 
  children, 
  variant = 'primary', 
  className = '', 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) => {
  const base = "h-12 px-6 font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none transition-colors duration-150 flex items-center justify-center gap-2";
  const variants = {
    primary: `bg-[${COLORS.inverseBg}] text-[${COLORS.inverseText}] hover:bg-[#c9ccd6]`,
    secondary: `bg-transparent border border-[${COLORS.lineStrong}] text-[${COLORS.text}] hover:bg-[${COLORS.bgRaised}]`,
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

const BlueprintSection = ({ 
  id, 
  number, 
  name, 
  descriptor, 
  children, 
  className = '' 
}: { 
  id: string; 
  number: string; 
  name: string; 
  descriptor: string; 
  children: React.ReactNode; 
  className?: string;
}) => {
  return (
    <section id={id} className={`relative border-t border-[${COLORS.line}] ${className}`}>
      <Crosshair position="top-left" />
      <Crosshair position="top-right" />
      
      {/* Caption Strip */}
      <div className={`h-12 border-b border-[${COLORS.line}] flex items-center justify-between px-4 md:px-6 bg-[${COLORS.bg}]`}>
        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c]">
          {number} / {name}
        </span>
        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-[#7b7f8c] hidden sm:block">
          {descriptor}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 md:p-6 lg:p-8">
        {children}
      </div>

      <Crosshair position="bottom-left" />
      <Crosshair position="bottom-right" />
    </section>
  );
};

const RightRail = () => {
  const [activeSection, setActiveSection] = useState('hero');
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = window.scrollY / totalHeight;
      setScrollTick(Math.round(progress * 50));
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { threshold: 0.3 }
    );
    const sections = document.querySelectorAll('section[id]');
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const navItems = [
    { id: 'hero', label: 'ENTRY' },
    { id: 'trust', label: 'GUARANTEES' },
    { id: 'workflow', label: 'WORKFLOW' },
    { id: 'features', label: 'FEATURES' },
    { id: 'guide', label: 'GUIDE' },
    { id: 'faq', label: 'FAQ' },
  ];

  return (
    <div className={`fixed right-0 top-0 bottom-0 w-[28px] border-l border-[${COLORS.line}] hidden md:flex flex-col items-center py-4 z-50 bg-[${COLORS.bg}]`}>
      {/* Dynamic Ruler */}
      <div className="absolute right-2 top-0 bottom-0 flex flex-col justify-between py-4 pointer-events-none">
        {Array.from({ length: 11 }).map((_, i) => {
          const tickValue = i * 5;
          const isActive = scrollTick >= tickValue && scrollTick < tickValue + 5;
          return (
            <div key={i} className="flex items-center gap-1">
              <span className={`font-mono text-[10px] transition-colors duration-300 ${isActive ? 'text-[#ffffff]' : 'text-[#555966]'}`}>
                {tickValue}
              </span>
              <div className={`w-1 h-px transition-colors duration-300 ${isActive ? 'bg-[#ffffff]' : 'bg-[#555966]'}`} />
            </div>
          );
        })}
      </div>

      {/* Section Index */}
      <div className="flex flex-col gap-3 items-end pr-1 mt-auto mb-auto z-10">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`flex items-center gap-2 transition-colors duration-200 ${
              activeSection === item.id ? 'text-[#ffffff]' : 'text-[#555966] hover:text-[#7b7f8c]'
            }`}
          >
            <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-right">
              {item.label}
            </span>
            <span className={`w-1.5 h-1.5 rounded-none transition-colors duration-200 ${
              activeSection === item.id ? `bg-[${COLORS.brandBlue}]` : 'bg-[#555966]'
            }`} />
          </a>
        ))}
      </div>
    </div>
  );
};

// --- Data ---

const TRUST_ITEMS = [
  {
    letter: 'A',
    title: '100% private',
    detail: 'Runs entirely in your browser. Images stay on your device with zero uploads.',
  },
  {
    letter: 'B',
    title: 'No account. No AI.',
    detail: 'Open the studio and cut out subjects immediately using deterministic canvas & OpenCV tools.',
  },
  {
    letter: 'C',
    title: 'Full resolution export',
    detail: 'Export crisp alpha PNGs, JPGs, WebPs, or grayscale masks at original resolution.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Upload',
    description: 'Drag and drop a PNG, JPEG, or WebP file, choose from your camera roll, or paste directly with Ctrl/Cmd+V.',
  },
  {
    number: '02',
    title: 'Process on your device',
    description: 'Classical CIELAB color clustering, GrabCut, watershed, magnetic lasso, and precision brushes isolate the subject in Web Workers.',
  },
  {
    number: '03',
    title: 'Download',
    description: 'Refine hair and edges, swap transparent, solid, gradient, or photo backdrops, and export or copy at full resolution.',
  },
];

const FEATURES = [
  { title: 'Transparent PNG & more', description: 'Clean alpha-channel PNGs, WebPs, JPGs, and grayscale masks ready for product listings, decks, and layered edits.' },
  { title: 'Custom backgrounds & FX', description: 'Preview and export over checkerboard transparency, solid colors, gradients, uploaded photos, blurred original, drop shadows, or sticker outlines.' },
  { title: 'Drag, drop, or paste', description: 'Drop files straight onto the canvas, open a picker with O, or paste screenshots directly from your clipboard.' },
  { title: 'Works completely offline', description: 'No model files or runtime CDN downloads required. Install as a PWA and edit backgrounds anytime, even with network disabled.' },
  { title: 'No watermark', description: 'Download clean, full-resolution exports with zero watermarks, zero upsell overlays, and zero attribution strings.' },
  { title: 'Precision mask studio', description: 'GrabCut rectangle + scribbles, livewire magnetic lasso, CIELAB magic wand, color key, edge-snapping brush, and 40-step undo/redo.' },
];

interface GuideItem {
  name: string;
  key?: string;
  what: string;
  how?: string;
}

interface GuideGroup {
  title: string;
  caption: string;
  items: GuideItem[];
}

const GUIDE_GROUPS: GuideGroup[] = [
  {
    title: 'Selection tools',
    caption: 'Phase 1 — define what should be kept. Every tool writes into the current Keep Selection using the active Combine mode.',
    items: [
      {
        name: 'Pan / Hand',
        key: 'V',
        what: 'Moves the image around the viewport without changing the mask.',
        how: 'Choose Pan, then drag the canvas. Hold Space at any time to pan temporarily, then release to return to your previous tool.',
      },
      {
        name: 'Select / Deselect brush',
        key: 'B',
        what: 'Paints directly into the Keep Selection to grow or shrink the cutout by hand.',
        how: 'Pick + Select or − Deselect, then paint over the image. Adjust Brush size, Hardness, Opacity and Stroke smoothing. Shift adds, Alt subtracts, and X swaps the two modes.',
      },
      {
        name: 'Edge-snapping brush',
        what: 'A guided brush that snaps to nearby contrast boundaries so painted selections follow real object outlines.',
        how: 'Choose + Select edge or − Deselect edge, set the Lab color tolerance, then paint near a boundary. The stroke clamps to the strongest nearby edge instead of stamping a hard circle.',
      },
      {
        name: 'Magic Wand (CIELAB)',
        key: 'W',
        what: 'Selects pixels whose color is perceptually close to the pixel you click, measured in CIELAB Delta E.',
        how: 'Click a region to add it to the Keep Selection. Raise Tolerance for a broader match or lower it for a tighter one. Keep Contiguous on for one connected region, off for every matching pixel. Shift adds, Alt subtracts.',
      },
      {
        name: 'Color Key',
        what: 'Selects every pixel close to one sampled key color. Built for green screens, blue screens and flat backdrops.',
        how: 'Click the image to sample the Key color, then tune Tolerance and Softness. Unlike the wand, Color Key is global and ignores image connectivity.',
      },
      {
        name: 'GrabCut Box (OpenCV)',
        what: 'Runs OpenCV GrabCut inside a rectangle and turns the result into a foreground mask.',
        how: 'Drag a box around the subject. Set GrabCut iterations from 2 to 6; more iterations are slower but often cleaner. The estimate becomes the Keep Selection.',
      },
      {
        name: 'FG/BG Scribbles',
        what: 'Combines keep and exclude strokes, then solves the mask with GrabCut or Watershed.',
        how: 'Choose Green = Keep or Red = Exclude, set the Scribble width, paint both foreground and background hints, then press Run GrabCut or Watershed. Clear scribbles resets the strokes.',
      },
      {
        name: 'Magnetic Lasso (Livewire)',
        what: 'Draws a path that snaps to strong contrast edges while you place anchors.',
        how: 'Click points along the subject edge. Click the green start dot or press Enter to close the loop. Backspace removes the last anchor and Esc cancels.',
      },
      {
        name: 'Freehand Lasso',
        key: 'L',
        what: 'Draws a freehand closed loop to define a selection.',
        how: 'Drag a loop around the area you want. The loop combines with the Keep Selection using the current Combine mode.',
      },
      {
        name: 'Polygon Lasso',
        key: 'P',
        what: 'Creates a selection from straight-line vertices for hard geometric shapes.',
        how: 'Click each vertex, then double-click or press Enter to close the polygon. Esc cancels the shape.',
      },
      {
        name: 'Rectangle Select',
        key: 'M',
        what: 'Selects a rectangular area.',
        how: 'Drag across the canvas to create the rectangle. Combine it with Add, Subtract or Intersect for precise region work.',
      },
      {
        name: 'Ellipse Select',
        key: 'E',
        what: 'Selects an elliptical area.',
        how: 'Drag across the canvas to create the ellipse, then combine or feather it like any other selection.',
      },
    ],
  },
  {
    title: 'Refine tools',
    caption: 'Phase 2 — correct the cutout after a mask has been applied. Refine unlocks once an erase action or Auto remove has produced a result.',
    items: [
      {
        name: 'Pan / Hand',
        key: 'V',
        what: 'Moves and inspects the refined cutout without editing it.',
        how: 'Drag to pan, or hold Space while using any other tool.',
      },
      {
        name: 'Restore brush',
        key: 'B',
        what: 'Paints the subject back into the mask where it was removed by mistake.',
        how: 'Choose Restore, then paint over the missing area. Brush size, hardness, opacity and smoothing all apply.',
      },
      {
        name: 'Erase brush',
        key: 'X',
        what: 'Paints the mask away to delete leftovers around the subject.',
        how: 'Choose Erase, then paint over the leftovers. X swaps between Restore and Erase.',
      },
      {
        name: 'Edge-snapping brush',
        what: 'Restores or erases along edges while snapping to nearby boundaries.',
        how: 'Pick + Select edge or − Deselect edge, then adjust the Lab color tolerance. Best for hair, fur and product edges.',
      },
    ],
  },
  {
    title: 'Auto remove',
    caption: 'One-click segmentation with a scored candidate mask. Settings are saved locally and re-run when changed.',
    items: [
      {
        name: 'Mode — Auto / Plain / Complex',
        what: 'Chooses how the automatic mask is computed.',
        how: 'Auto picks Plain or Complex from the image. Plain uses border color clustering and is best for studio or solid backdrops. Complex adds GrabCut and Watershed passes for busy scenes. Plain also skips the person model.',
      },
      {
        name: 'Person detection',
        what: 'For photos of people, a small on-device model runs first when the mode is Auto or Complex.',
        how: 'If the model finds a person it returns the mask immediately. If it finds nothing, or the mode is Plain, the classical engine runs instead. The model downloads once on first use.',
      },
      {
        name: 'Tolerance',
        what: 'Controls how different a pixel must be from the background before it is kept.',
        how: 'Raise it to keep more subject and fine detail; lower it to remove more background. The default of 50 is a balanced starting point.',
      },
      {
        name: 'Edge softness',
        what: 'Feathers the final alpha edge of the automatic mask.',
        how: 'Higher values give a softer, more gradual transition. Lower values give a crisper cut for hard products and graphics.',
      },
      {
        name: 'Keep largest only',
        what: 'Keeps only the biggest connected foreground component.',
        how: 'Enable for a single product. Leave it off when several separate objects belong in the cutout.',
      },
      {
        name: 'Fill holes',
        what: 'Fills enclosed transparent holes inside the subject.',
        how: 'Enable for solid products and people. Turning it off exposes the Preserve holes option.',
      },
      {
        name: 'Preserve holes',
        what: 'Keeps genuine see-through holes open, such as handles, ring interiors and gaps between arms.',
        how: 'Enable when the subject has real holes that should stay transparent instead of being filled as part of the subject.',
      },
      {
        name: 'Keep soft shadow',
        what: 'Keeps a soft contact shadow next to the subject instead of deleting it as background.',
        how: 'Enable for photos with a subtle shadow cast on the backdrop. The shadow is preserved as partial alpha.',
      },
      {
        name: 'Subject touches edge',
        what: 'Tells the engine whether the subject runs off the frame.',
        how: 'Auto detects it from border color segments. Force Yes or No when the automatic guess is wrong, which prevents border pixels from becoming background seeds.',
      },
      {
        name: 'Pick bg color',
        what: 'Samples background colors to steer the background color model.',
        how: 'Click Pick bg color, then click one or more background pixels. Each sample appears as a removable chip; Clear resets all samples.',
      },
      {
        name: 'Try another result',
        what: 'Cycles through the scored candidate masks and shows the winning point score.',
        how: 'Use Try another result (1/4) to compare alternatives. A low-confidence warning means you should fall back to GrabCut Box, scribbles or the selection tools.',
      },
    ],
  },
  {
    title: 'Selection options',
    caption: 'Shared controls that decide how each new selection combines with what is already selected.',
    items: [
      {
        name: 'Combine mode',
        what: 'Sets how a new selection merges with the Keep Selection: New (replace), Add, Subtract or Intersect.',
        how: 'Pick the combine mode before drawing. New replaces the selection; Add unions regions; Subtract cuts holes; Intersect keeps only the overlap.',
      },
      {
        name: 'Invert',
        what: 'Flips the selection so everything currently kept becomes removed and the rest becomes kept.',
        how: 'Click Invert in Selection options. Useful for cutting out the negative space around an object.',
      },
      {
        name: 'Clear selection',
        what: 'Removes the current Keep Selection without touching the image.',
        how: 'Click Clear selection. It is disabled when nothing is selected.',
      },
      {
        name: 'Feather',
        what: 'Softens the selection edge before it is applied.',
        how: 'Set Feather from 0 to 50 px. Higher values give a gradual alpha falloff at the boundary.',
      },
      {
        name: 'Expand / Contract',
        what: 'Grows or shrinks the selection by a fixed number of pixels.',
        how: 'Use the signed slider from -20 to 20 px. Negative values contract; positive values expand.',
      },
      {
        name: 'Overlay',
        what: 'Shows or hides the colored selection overlay on the canvas.',
        how: 'Toggle Overlay in the Selection options header to inspect the image without the selection tint.',
      },
    ],
  },
  {
    title: 'Refine and edge controls',
    caption: 'Applied live in the Refine phase. Non-destructive until you press Apply to mask.',
    items: [
      {
        name: 'View modes',
        what: 'Switches between Result, Split and Before/After views.',
        how: 'Use View in the Refine panel. Split and Before/After compare the original with the current cutout.',
      },
      {
        name: 'Red mask overlay',
        what: 'Tints the transparent parts red so you can see exactly what the mask removes.',
        how: 'Click Red mask overlay, then adjust the opacity slider from 10 to 85 percent.',
      },
      {
        name: 'Feather',
        what: 'Softens the refined mask edge.',
        how: 'Set Feather from 0 to 25 px, then press Apply to mask to bake it in.',
      },
      {
        name: 'Edge shift',
        what: 'Moves the alpha boundary inward or outward.',
        how: 'Use the signed slider from -15 to 15 px. Negative values pull the edge in; positive values push it out.',
      },
      {
        name: 'Edge smooth',
        what: 'Smooths jagged boundaries.',
        how: 'Set Edge smooth from 0 to 6 px. Higher values remove more stairstepping but can soften fine detail.',
      },
      {
        name: 'Color decontamination',
        what: 'Removes background color spill from semi-transparent edge pixels.',
        how: 'Enable it for green screens and colored backdrops, then bake with Apply to mask.',
      },
      {
        name: 'Refine hair and fur',
        what: 'Recovers fine wispy strands that a hard mask would cut away.',
        how: 'Enable it for people, pets and textured edges, then bake with Apply to mask.',
      },
      {
        name: 'Apply to mask / Reset',
        what: 'Bakes the live edge adjustments permanently, or returns every refine slider to zero.',
        how: 'Press Apply to mask when the preview looks right. Reset clears Feather, Edge shift, Edge smooth, decontamination and hair refinement.',
      },
    ],
  },
  {
    title: 'Backgrounds and effects',
    caption: 'Preview and export settings in the Refine phase. All compositing happens locally on a canvas.',
    items: [
      {
        name: 'Solid / Clear',
        what: 'Sets a transparent or solid background.',
        how: 'Pick the checkerboard for transparency, a preset swatch, or the Hex control for any custom color.',
      },
      {
        name: 'Gradient',
        what: 'Applies a two-color linear gradient behind the subject.',
        how: 'Choose one of the gradient presets in the Background preview panel. The angle is part of the preset.',
      },
      {
        name: 'Custom Image',
        what: 'Places your cutout over an uploaded photo.',
        how: 'Open Custom Image, upload a PNG, JPEG or WebP, then use Replace or Clear to change it.',
      },
      {
        name: 'Blur Original',
        what: 'Uses a blurred version of the original photo as the backdrop.',
        how: 'Open Blur Original and set the blur radius from 2 to 40 px.',
      },
      {
        name: 'Drop shadow',
        what: 'Adds a soft shadow behind the cutout.',
        how: 'Enable Drop shadow under Shadow and sticker outline, then set the blur radius.',
      },
      {
        name: 'Sticker outline',
        what: 'Adds a solid outline around the subject for a sticker look.',
        how: 'Enable Sticker outline, then choose the outline width from 2 to 32 px and pick a color.',
      },
      {
        name: 'Saved snapshots',
        what: 'Stores named versions of the current cutout so you can compare and restore them.',
        how: 'Press Save version snapshot, then use Restore on any thumbnail in the Saved snapshots list.',
      },
    ],
  },
  {
    title: 'Export and batch',
    caption: 'Full-resolution output with presets for stores, IDs and social media. Nothing is uploaded.',
    items: [
      {
        name: 'Format',
        what: 'Chooses PNG (alpha), JPG or WebP output.',
        how: 'Pick a format in the Export dialog. PNG keeps transparency; JPG flattens transparent areas to white; WebP supports both.',
      },
      {
        name: 'Quality',
        what: 'Sets compression quality for JPG and WebP.',
        how: 'Use the slider from 20 to 100 percent. PNG ignores this control because it is lossless.',
      },
      {
        name: 'Canvas preset and aspect ratio',
        what: 'Frames the export for a target use, such as a passport photo, product square, profile circle, sticker or social post.',
        how: 'Choose a preset from the dropdown. Workflow presets include Original, Passport 2x2, Product square, Profile circle and Sticker; Social and Store presets include 1:1, 4:5, 16:9, Instagram 1080x1350 and WhatsApp 1080x1920.',
      },
      {
        name: 'Crop to subject bounds',
        what: 'Trims empty space around the subject before export.',
        how: 'Enable Crop to subject bounds, then set Padding around subject from 0 to 160 px.',
      },
      {
        name: 'Output max dimension',
        what: 'Limits the longest exported side.',
        how: 'Choose Original, 2048 px, 1080 px or Custom. Custom accepts any longest side from 64 to 8000 px.',
      },
      {
        name: 'Download file',
        what: 'Renders and saves the composed cutout at the chosen settings.',
        how: 'Press Download file in the Export dialog. The file is created in the browser and saved normally.',
      },
      {
        name: 'Copy PNG',
        what: 'Copies the composed cutout to the clipboard as a PNG.',
        how: 'Press Copy PNG. It uses the same crop, preset and size settings as the download.',
      },
      {
        name: 'Export mask alone',
        what: 'Saves the alpha mask by itself as a grayscale PNG.',
        how: 'Press Export mask alone at the bottom of the Export dialog. White is subject, black is background.',
      },
      {
        name: 'Batch ZIP',
        what: 'Processes many images offline and packs the transparent PNGs into one ZIP.',
        how: 'Switch to Batch ZIP from the top bar, add multiple PNG, JPEG or WebP files, press Process queued, then Download ZIP. Each finished item can also be opened in the studio with Edit mask or downloaded alone.',
      },
    ],
  },
  {
    title: 'Workspace and shortcuts',
    caption: 'The chrome around the canvas. Everything runs in the browser, including undo history and autosave.',
    items: [
      {
        name: 'Undo / Redo / Reset',
        what: 'Steps through up to 40 mask edits, or restores the original image.',
        how: 'Use the top-bar buttons or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z. Reset asks for confirmation and returns to the untouched photo.',
      },
      {
        name: 'Zoom',
        what: 'Magnifies the canvas for precision work.',
        how: 'Use the top-bar minus and plus controls; click the percentage to reset to Fit.',
      },
      {
        name: 'Open',
        what: 'Loads a different image without leaving the studio.',
        how: 'Click Open in the top bar, or drag and drop a PNG, JPEG or WebP onto the canvas, or paste with Ctrl/Cmd+V.',
      },
      {
        name: 'Select and Refine steps',
        what: 'The two-phase workflow. Select builds the mask; Refine polishes and composes it.',
        how: 'Use the Select and Refine tabs in the properties panel. Refine is disabled until a mask has been applied.',
      },
      {
        name: 'Autosave and resume',
        what: 'Keeps a local session so a reload does not lose work.',
        how: 'When a saved session exists, the studio offers Resume or Discard. Autosave stays in this browser and is never uploaded.',
      },
      {
        name: 'Status bar and shortcuts',
        what: 'Shows the current phase, tool, brush size, zoom, dimensions and save state.',
        how: 'Open the Shortcuts button in the top bar for the full key list. Drag and drop, paste and Space-to-pan work everywhere in the canvas.',
      },
      {
        name: 'Keyboard shortcuts',
        what: 'Common keys: V Pan, B Brush, W Wand, L Freehand lasso, P Polygon, M Rectangle, E Ellipse, X Swap mode, [ and ] brush size.',
        how: 'Enter erases the background from the selection, Esc cancels, Space plus drag pans, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Ctrl/Cmd+V pastes an image from the clipboard.',
      },
    ],
  },
];

function GuideGroupBlock({ group, index }: { group: GuideGroup; index: number }) {
  return (
    <div className="border-b border-[#23252d]">
      <div className="flex items-start gap-4 bg-[#101117] px-4 py-4 md:px-6">
        <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-[#555966]">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold tracking-tight text-white">{group.title}</h3>
          <p className="mt-1 text-[13px] leading-[1.6] text-[#7b7f8c]">{group.caption}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {group.items.map((item) => (
          <div
            key={item.name}
            className="border-t border-[#23252d] p-4 md:p-5 md:odd:border-r md:odd:border-[#23252d]"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-[14px] font-bold tracking-tight text-white">{item.name}</h4>
              {item.key && (
                <kbd className="shrink-0 border border-[#2c2f3a] bg-[#0c0d12] px-1.5 py-0.5 font-mono text-[10px] text-[#c9ccd6]">
                  {item.key}
                </kbd>
              )}
            </div>
            <p className="mt-2 text-[13px] leading-[1.6] text-[#c9ccd6]">{item.what}</p>
            {item.how && (
              <p className="mt-2 text-[12px] leading-[1.6] text-[#7b7f8c]">
                <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#0fa36b]">
                  How
                </span>
                {item.how}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const location = useLocation();

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: APP_NAME,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (Web Browser)',
      url: SITE_URL,
      description: 'Free, private background remover that runs entirely inside your browser. No uploads, no account, no AI.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }),
    []
  );

  useHead({
    title: `${APP_NAME} — Free Private Background Remover in Your Browser`,
    description: 'Runs entirely in your browser. No uploads. No account. No AI. Remove backgrounds with classical CIELAB, GrabCut, magnetic lasso, and mask brushes.',
    path: '/',
    jsonLd,
  });

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (target) {
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [location.hash]);

  return (
    <div className={`flex min-h-dvh flex-col bg-[${COLORS.bg}] text-[${COLORS.text}] font-sans selection:bg-[${COLORS.accent}] selection:text-[${COLORS.text}]`}>
      {/* Frame Lines */}
      <div className={`fixed left-[44px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />
      <div className={`fixed right-[28px] top-0 bottom-0 w-px bg-[${COLORS.line}] hidden md:block z-40`} />

      <Navbar />
      <RightRail />

      <main className="flex-1 md:ml-[44px] md:mr-[28px]">
        {/* Hero */}
        <section id="hero" className={`relative min-h-[80vh] flex flex-col items-center justify-center text-center px-4 border-b border-[${COLORS.line}]`}>
          <Crosshair position="top-left" />
          <Crosshair position="top-right" />
          <Crosshair position="bottom-left" />
          <Crosshair position="bottom-right" />
          
          <div className="max-w-[1200px] w-full mx-auto mt-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            {/* Text Content (Left 6 cols) */}
            <div className="lg:col-span-6 text-left lg:text-right order-2 lg:order-1">
              <div className="mb-8 inline-block">
                <span className={`font-mono text-[10px] uppercase tracking-[0.16em] text-[${COLORS.textMuted}] border border-[${COLORS.line}] px-2 py-1`}>
                  V 1.0.0 · LOCAL PROCESSING
                </span>
              </div>
              <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] mb-6">
                Remove backgrounds <span className="font-serif italic text-[#0fa36b]">locally.</span>
              </h1>
              <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}] mb-10`}>
                Free, private background remover that runs entirely inside your browser. No uploads, no account, no AI.
              </p>
              <div className="flex flex-col sm:flex-row items-center lg:items-end justify-start lg:justify-end gap-3">
                <BlueprintButton variant="primary" onClick={() => window.location.href = '/studio'}>
                  OPEN STUDIO
                </BlueprintButton>
                <BlueprintButton variant="secondary" onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })}>
                  HOW IT WORKS
                </BlueprintButton>
              </div>
            </div>

            {/* Compare Slider (Right 6 cols) */}
            <div className="lg:col-span-6 order-1 lg:order-2 animate-enter">
              <div className={`border border-[${COLORS.line}] p-2 bg-[${COLORS.bgRaised}]`}>
                <CompareSlider
                  beforeSrc="/samples/before.svg"
                  afterSrc="/samples/after.svg"
                  beforeAlt="Sample product photo of a rangefinder camera with studio room background"
                  afterAlt="Same rangefinder camera with its background cleanly removed"
                  autoAnimate={true}
                />
              </div>
            </div>

          </div>
        </section>

        {/* Trust */}
        <BlueprintSection id="trust" number="01" name="GUARANTEES" descriptor="PRIVATE · LOCAL · DETERMINISTIC">
          <div className={`grid grid-cols-1 md:grid-cols-3 border-t border-[${COLORS.line}]`}>
            {TRUST_ITEMS.map((item, i) => (
              <div key={item.letter} className={`border-b border-[${COLORS.line}] md:border-r md:last:border-r-0 p-6 md:p-8 relative group hover:bg-[${COLORS.bgRaised}] transition-colors duration-150`}>
                <span className={`absolute top-4 right-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textDim}]`}>{item.letter}</span>
                <div className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-[${COLORS.accent}]" />
                  <div>
                    <h3 className="text-[22px] font-bold tracking-tight leading-[1.1] mb-3">{item.title}</h3>
                    <p className={`text-[14px] leading-[1.6] text-[${COLORS.textBody}]`}>{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </BlueprintSection>

        {/* Workflow */}
        <BlueprintSection id="workflow" number="02" name="WORKFLOW" descriptor="UPLOAD · PROCESS · EXPORT">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4">
              How it <span className="font-serif italic text-[#0fa36b]">works.</span>
            </h2>
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}]`}>
              Runs entirely in your browser. No uploads. No account. No AI. Deterministic image processing keeps every pixel under your control.
            </p>
          </div>
          <div className={`grid grid-cols-1 md:grid-cols-3 border-t border-[${COLORS.line}]`}>
            {STEPS.map((step) => (
              <div key={step.number} className={`border-b border-[${COLORS.line}] md:border-r md:last:border-r-0 p-6 md:p-8 relative`}>
                <span className={`absolute top-4 right-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textDim}]`}>{step.number}</span>
                <h3 className="text-[20px] font-bold tracking-tight leading-[1.1] mb-3">{step.title}</h3>
                <p className={`text-[14px] leading-[1.6] text-[${COLORS.textBody}]`}>{step.description}</p>
              </div>
            ))}
          </div>
        </BlueprintSection>

        {/* Features */}
        <BlueprintSection id="features" number="03" name="FEATURES" descriptor="PRECISION · OFFLINE · FULL RESOLUTION">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4">
              Built for fast, deterministic <span className="font-serif italic text-[#0fa36b]">cutouts.</span>
            </h2>
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}]`}>
              Every control you need to isolate subjects, refine edges, swap backdrops, and export crisp files offline.
            </p>
            <a
              href="#guide"
              className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[#0fa36b] hover:text-white transition-colors duration-150"
            >
              Read the full studio guide
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-t border-[${COLORS.line}]`}>
            {FEATURES.map((feature, i) => (
              <div key={feature.title} className={`border-b border-[${COLORS.line}] sm:border-r sm:last:border-r-0 lg:last:border-r-0 p-6 md:p-8 relative group hover:bg-[${COLORS.bgRaised}] transition-colors duration-150`}>
                <span className={`absolute top-4 right-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[${COLORS.textDim}]`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-[18px] font-bold tracking-tight leading-[1.1] mb-3">{feature.title}</h3>
                <p className={`text-[14px] leading-[1.6] text-[${COLORS.textBody}]`}>{feature.description}</p>
              </div>
            ))}
          </div>
        </BlueprintSection>

        {/* Guide */}
        <BlueprintSection id="guide" number="04" name="GUIDE" descriptor="TOOLS · CONTROLS · WORKFLOW">
          <div className="max-w-3xl mb-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4">
              The complete studio <span className="font-serif italic text-[#0fa36b]">guide.</span>
            </h2>
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}]`}>
              Every tool, control, background option, effect, export preset and shortcut in the studio, with a short
              explanation of what it does and how to use it. Select first, refine second, export last.
            </p>
          </div>
          <div className={`border-t border-[${COLORS.line}]`}>
            {GUIDE_GROUPS.map((group, index) => (
              <GuideGroupBlock key={group.title} group={group} index={index} />
            ))}
          </div>
        </BlueprintSection>

        {/* FAQ */}
        <BlueprintSection id="faq" number="05" name="FAQ" descriptor="PRIVACY · ALGORITHMS · LIMITS">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4">
              Frequently asked <span className="font-serif italic text-[#0fa36b]">questions.</span>
            </h2>
            <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}]`}>
              Answers on local privacy, offline support, classical algorithms, and resolution limits.
            </p>
          </div>
          <div className={`border-t border-[${COLORS.line}]`}>
            <FaqAccordion />
          </div>
        </BlueprintSection>

        {/* Final CTA band */}
        <BlueprintSection id="start" number="06" name="START" descriptor="NO ACCOUNT · NO UPLOADS">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="max-w-xl">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-[1.05] mb-4">
                Ready to remove a <span className="font-serif italic text-[#0fa36b]">background?</span>
              </h2>
              <p className={`text-[15px] md:text-[16px] leading-[1.6] text-[${COLORS.textBody}]`}>
                Open {APP_NAME} and process your first image locally in seconds — no account, no uploads, no AI.
              </p>
            </div>
            <Link
              to="/studio"
              className={`h-12 px-6 bg-[${COLORS.inverseBg}] text-[${COLORS.inverseText}] font-mono text-[11px] uppercase font-bold tracking-[0.12em] rounded-none hover:bg-[#c9ccd6] transition-colors duration-150 flex items-center justify-center gap-2 shrink-0`}
            >
              <span>OPEN STUDIO</span>
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </BlueprintSection>
      </main>

      <Footer />
    </div>
  );
}