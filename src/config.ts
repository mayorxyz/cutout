export const APP_NAME = 'Cutout';

export const SITE_URL = 'https://cutout.app';

export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_SIDE_PX = 8000;
export const DOWNSCALE_TARGET_PX = 4096;
export const MOBILE_FALLBACK_PX = 2048;
export const WORKING_MAX_SIDE_PX = 2048;

export const MAX_HISTORY_STEPS = 40;
export const MAX_HISTORY_BYTES = 96 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type AutoRemoveMode = 'auto' | 'plain' | 'complex';
export type SubjectEdgeContact = 'auto' | 'yes' | 'no';

export interface AutoRemoveSettings {
  mode: AutoRemoveMode;
  tolerance: number; // 0 - 100 (default 50)
  edgeSoftness: number; // 0 - 100 (default 40)
  keepLargestObject: boolean; // default false (keeps main components per Step 5)
  fillHoles: boolean; // default true
  preserveHoles: boolean; // default false
  subjectTouchesEdge: SubjectEdgeContact; // default 'auto'
  keepSoftShadow: boolean; // default false
  pickedBgColors: Array<[number, number, number]>;
}

export const DEFAULT_AUTO_SETTINGS: AutoRemoveSettings = {
  mode: 'auto',
  tolerance: 50,
  edgeSoftness: 40,
  keepLargestObject: false,
  fillHoles: true,
  preserveHoles: false,
  subjectTouchesEdge: 'auto',
  keepSoftShadow: false,
  pickedBgColors: [],
};

export type BackgroundOption =
  | { type: 'transparent' }
  | { type: 'color'; value: string; label?: string }
  | { type: 'gradient'; from: string; to: string; angle: number; label?: string }
  | { type: 'image'; dataUrl: string; label?: string }
  | { type: 'blur-original'; blurPx: number };

export const PRESET_COLORS: Array<{ value: string; label: string }> = [
  { value: '#ffffff', label: 'White' },
  { value: '#000000', label: 'Black' },
  { value: '#0b0f14', label: 'Obsidian' },
  { value: '#1e293b', label: 'Slate' },
  { value: '#ef4444', label: 'Crimson' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#3b82f6', label: 'Cobalt' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#ec4899', label: 'Rose' },
];

export const GRADIENT_PRESETS: Array<{
  from: string;
  to: string;
  angle: number;
  label: string;
}> = [
  { from: '#3b82f6', to: '#8b5cf6', angle: 135, label: 'Cobalt Violet' },
  { from: '#0f172a', to: '#1e293b', angle: 180, label: 'Deep Slate' },
  { from: '#f97316', to: '#ec4899', angle: 135, label: 'Sunset' },
  { from: '#10b981', to: '#06b6d4', angle: 135, label: 'Mint Teal' },
  { from: '#f8fafc', to: '#cbd5e1', angle: 180, label: 'Studio Light' },
  { from: '#18181b', to: '#3f3f46', angle: 135, label: 'Charcoal' },
];

export type ToolId =
  | 'pan'
  | 'select-brush'
  | 'restore'
  | 'erase'
  | 'edge-brush'
  | 'grabcut-rect'
  | 'scribble'
  | 'magnetic-lasso'
  | 'magic-wand'
  | 'color-key'
  | 'bg-eyedropper'
  | 'lasso'
  | 'polygon-lasso'
  | 'rect'
  | 'ellipse';

export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

export type ClickActionMode = 'remove' | 'keep';

export type ScribblePolarity = 'fg' | 'bg';

export interface RefineSettings {
  featherPx: number;
  shiftPx: number;
  smoothRadius: number;
  decontaminate: boolean;
  hairMatting: boolean;
}

export interface OutputEffectSettings {
  shadowEnabled: boolean;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  shadowColor: string;
  outlineEnabled: boolean;
  outlineWidth: number;
  outlineColor: string;
}

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export type AspectPresetId =
  | 'original'
  | '1:1'
  | '4:5'
  | '16:9'
  | 'passport'
  | 'product'
  | 'profile-circle'
  | 'sticker'
  | 'whatsapp'
  | 'instagram';

export interface AspectPresetInfo {
  id: AspectPresetId;
  label: string;
  ratio?: [number, number];
  defaultSize?: [number, number];
  paddingRatio?: number;
  circleCrop?: boolean;
  category: 'Workflow' | 'Social & Store';
}

export const ASPECT_PRESETS: AspectPresetInfo[] = [
  { id: 'original', label: 'Original size', category: 'Workflow' },
  {
    id: 'passport',
    label: 'Passport photo (2×2 in)',
    ratio: [1, 1],
    defaultSize: [600, 600],
    paddingRatio: 0.08,
    category: 'Workflow',
  },
  {
    id: 'product',
    label: 'Product photo (Square)',
    ratio: [1, 1],
    defaultSize: [1200, 1200],
    paddingRatio: 0.12,
    category: 'Workflow',
  },
  {
    id: 'profile-circle',
    label: 'Profile picture (Circle)',
    ratio: [1, 1],
    defaultSize: [800, 800],
    paddingRatio: 0.08,
    circleCrop: true,
    category: 'Workflow',
  },
  {
    id: 'sticker',
    label: 'Sticker cutout',
    ratio: [1, 1],
    defaultSize: [1024, 1024],
    paddingRatio: 0.08,
    category: 'Workflow',
  },
  { id: '1:1', label: '1:1 Square', ratio: [1, 1], category: 'Social & Store' },
  { id: '4:5', label: '4:5 Portrait', ratio: [4, 5], category: 'Social & Store' },
  { id: '16:9', label: '16:9 Landscape', ratio: [16, 9], category: 'Social & Store' },
  {
    id: 'instagram',
    label: 'Instagram Post (1080×1350)',
    ratio: [4, 5],
    defaultSize: [1080, 1350],
    category: 'Social & Store',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Status (1080×1920)',
    ratio: [9, 16],
    defaultSize: [1080, 1920],
    category: 'Social & Store',
  },
];

export const STORAGE_KEY_BG = 'cutout:last-background:v2';
export const STORAGE_KEY_AUTO = 'cutout:auto-settings:v2';
