interface MeterProps {
  label: string;
  value: number;
  max: number;
  /** Formatted value text, e.g. "17.8 / 23.0 kg". */
  valueText: string;
}

/** Horizontal usage bar. Turns red when `value` exceeds `max`. */
export function Meter({ label, value, max, valueText }: MeterProps) {
  const over = value > max;
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs text-stone-600">
        <span>{label}</span>
        <span className={over ? "font-semibold text-red-700" : undefined}>{valueText}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="mt-1 h-2 overflow-hidden rounded-full bg-stone-200"
      >
        <div
          className={`h-full rounded-full ${over ? "bg-red-600" : "bg-brand-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
