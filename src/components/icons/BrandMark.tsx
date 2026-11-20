import type { SVGProps } from 'react';

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="cutout-mark-grad" x1="3" y1="3" x2="25" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="24" height="24" rx="7" fill="#121923" stroke="#223042" strokeWidth="1.5" />
      <rect
        x="6.5"
        y="6.5"
        width="15"
        height="15"
        rx="3"
        stroke="url(#cutout-mark-grad)"
        strokeWidth="1.75"
        strokeDasharray="3.2 2.2"
      />
      <circle cx="14" cy="14" r="4.2" fill="url(#cutout-mark-grad)" />
    </svg>
  );
}
