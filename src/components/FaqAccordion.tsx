import { useState } from 'react';
import { ChevronDownIcon } from './icons';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'free',
    question: 'Is it free?',
    answer:
      'Yes. Cutout runs entirely in your browser with no account, no daily limits, no subscriptions, and no watermarks.',
  },
  {
    id: 'uploads',
    question: 'Are images uploaded or sent to an AI service?',
    answer:
      'Never. There are no uploads, no servers, and no AI or neural networks. Every calculation uses deterministic classical image-processing algorithms running locally inside Web Workers on your device.',
  },
  {
    id: 'offline',
    question: 'Does it require downloading models on first use?',
    answer:
      'No. There are zero AI model downloads. Once the app loads (including the locally bundled OpenCV.js WebAssembly engine for GrabCut and Watershed), it works completely offline.',
  },
  {
    id: 'formats',
    question: 'What formats are supported?',
    answer:
      'You can open PNG, JPEG, and WebP images. Animated WebP files automatically use their first frame, and you can export as transparent PNG, JPG, WebP, or a grayscale alpha mask PNG.',
  },
  {
    id: 'size',
    question: 'What is the maximum file size and resolution?',
    answer:
      'Files up to 20 MB and 8,000 px on the longest side are supported directly. Interactive editing runs up to 2,048 px for smooth 60 fps brush strokes, then upscales your mask bilinearly onto the full-resolution original on export.',
  },
  {
    id: 'tips',
    question: 'How do I get the cleanest cutout on complex photos?',
    answer:
      'Auto mode works best on plain or studio backgrounds using CIELAB border color sampling. For busy or complex photos, draw a box around your subject with GrabCut, add green (keep) and red (remove) scribbles, trace edges with the Magnetic Lasso, and touch up fine detail with Restore/Erase brushes and Refine hair & fur.',
  },
];

export function FaqAccordion() {
  const [openId, setOpenId] = useState<string | null>(FAQ_ITEMS[0].id);

  const toggleItem = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-panel">
      {FAQ_ITEMS.map((item) => {
        const isOpen = openId === item.id;
        const buttonId = `faq-btn-${item.id}`;
        const panelId = `faq-panel-${item.id}`;

        return (
          <div key={item.id}>
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleItem(item.id)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-base font-medium text-ink transition-colors duration-150 hover:bg-surface/60"
              >
                <span>{item.question}</span>
                <ChevronDownIcon
                  className={`h-5 w-5 shrink-0 text-muted transition-transform duration-150 ${
                    isOpen ? 'rotate-180 text-ink' : ''
                  }`}
                />
              </button>
            </h3>
            {isOpen && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="px-6 pb-5 text-sm leading-relaxed text-muted"
              >
                {item.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
