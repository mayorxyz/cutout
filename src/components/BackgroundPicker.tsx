import { useRef, useState } from 'react';
import { BackgroundOption, GRADIENT_PRESETS, PRESET_COLORS } from '../config';
import { UploadIcon } from './icons';

interface BackgroundPickerProps {
  value: BackgroundOption;
  onChange: (option: BackgroundOption) => void;
}

type BgTab = 'solid' | 'gradient' | 'image' | 'blur';

export function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
  const [activeTab, setActiveTab] = useState<BgTab>(() => {
    if (value.type === 'gradient') return 'gradient';
    if (value.type === 'image') return 'image';
    if (value.type === 'blur-original') return 'blur';
    return 'solid';
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleBgImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange({ type: 'image', dataUrl: reader.result, label: file.name });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-2 gap-0.5 rounded-lg bg-[#0c0d12] p-0.5"
        role="tablist"
        aria-label="Background type"
      >
        {(
          [
            { id: 'solid', label: 'Solid / Clear' },
            { id: 'gradient', label: 'Gradient' },
            { id: 'image', label: 'Custom Image' },
            { id: 'blur', label: 'Blur Original' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === 'blur' && value.type !== 'blur-original') {
                onChange({ type: 'blur-original', blurPx: 14 });
              }
            }}
            className={`min-h-8 min-w-0 rounded-md px-1.5 font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.12em] transition-colors duration-150 text-center break-words ${
              activeTab === tab.id
                ? 'bg-white text-[#0c0d12]'
                : 'bg-transparent text-[#7b7f8c] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'solid' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Solid background colors">
          <button
            type="button"
            aria-pressed={value.type === 'transparent'}
            aria-label="Transparent background"
            title="Transparent"
            onClick={() => onChange({ type: 'transparent' })}
            className={`checkerboard h-8 w-8 shrink-0 rounded-lg border transition-transform duration-150 hover:scale-105 ${
              value.type === 'transparent' ? 'border-accent ring-2 ring-accent/50' : 'border-border'
            }`}
          />

          {PRESET_COLORS.map((preset) => {
            const isSelected =
              value.type === 'color' && value.value.toLowerCase() === preset.value.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${preset.label} background`}
                title={preset.label}
                onClick={() => onChange({ type: 'color', value: preset.value, label: preset.label })}
                className={`h-8 w-8 shrink-0 rounded-lg border transition-transform duration-150 hover:scale-105 ${
                  isSelected ? 'border-accent ring-2 ring-accent/50' : 'border-border'
                }`}
                style={{ backgroundColor: preset.value }}
              />
            );
          })}

          <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink hover:bg-panel">
            <span
              className="h-3.5 w-3.5 rounded border border-border"
              style={{ backgroundColor: value.type === 'color' ? value.value : '#3b82f6' }}
            />
            <span>Hex</span>
            <input
              type="color"
              aria-label="Custom background color picker"
              value={value.type === 'color' ? value.value : '#3b82f6'}
              onChange={(event) => onChange({ type: 'color', value: event.target.value })}
              className="sr-only"
            />
          </label>
        </div>
      )}

      {activeTab === 'gradient' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gradient backgrounds">
          {GRADIENT_PRESETS.map((grad) => {
            const isSelected =
              value.type === 'gradient' && value.from === grad.from && value.to === grad.to;
            return (
              <button
                key={grad.label}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${grad.label} gradient background`}
                title={grad.label}
                onClick={() =>
                  onChange({
                    type: 'gradient',
                    from: grad.from,
                    to: grad.to,
                    angle: grad.angle,
                    label: grad.label,
                  })
                }
                className={`h-8 w-11 shrink-0 rounded-lg border transition-transform duration-150 hover:scale-105 ${
                  isSelected ? 'border-accent ring-2 ring-accent/50' : 'border-border'
                }`}
                style={{
                  backgroundImage: `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})`,
                }}
              />
            );
          })}
        </div>
      )}

      {activeTab === 'image' && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleBgImageChange}
            className="sr-only"
            aria-label="Upload custom background image"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel"
          >
            <UploadIcon className="h-3.5 w-3.5" />
            <span>{value.type === 'image' ? 'Replace background image' : 'Upload background image'}</span>
          </button>
          {value.type === 'image' && (
            <button
              type="button"
              onClick={() => onChange({ type: 'transparent' })}
              className="text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {activeTab === 'blur' && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="bg-blur-slider" className="text-xs text-muted whitespace-nowrap">
              Blur radius
            </label>
            <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-ink">
              {value.type === 'blur-original' ? value.blurPx : 14} px
            </span>
          </div>
          <input
            id="bg-blur-slider"
            type="range"
            min={2}
            max={40}
            value={value.type === 'blur-original' ? value.blurPx : 14}
            onChange={(event) =>
              onChange({ type: 'blur-original', blurPx: Number(event.target.value) })
            }
            className="range-control mt-1 w-full cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}
