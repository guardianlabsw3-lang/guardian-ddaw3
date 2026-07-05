const NAVY = '#0e1c3d';
const GOLD = '#e7b84e';

/**
 * PayOrder W3 brand mark: navy rounded badge with a gold padlock whose body carries a stylized
 * "@". Kept in sync with the static favicon assets in `app/` (icon.svg, favicon.ico,
 * apple-icon.png) — update both together when the mark changes.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="14"
        fill={NAVY}
        stroke="rgba(238, 241, 248, 0.16)"
        strokeWidth="2"
      />
      <path
        d="M24 30v-6.5a8 8 0 0 1 16 0V30"
        fill="none"
        stroke={GOLD}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <rect x="18" y="29" width="28" height="21.5" rx="5.5" fill={GOLD} />
      <g stroke={NAVY} strokeWidth="2.3" fill="none" strokeLinecap="round">
        <circle cx="32" cy="39.75" r="3.1" />
        <path d="M35.2 36.9v5.7" />
        <path d="M35.35 45.45 A 6.5 6.5 0 1 1 38.5 40.9" />
      </g>
    </svg>
  );
}

/**
 * Horizontal brand lockup: mark + "PayOrder W3" wordmark (product name, not translated).
 * `suffix` appends extra wordmark text (e.g. "Guardian" on the home page title).
 */
export function BrandLogo({
  size = 30,
  suffix,
  className,
}: {
  size?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={className ? `brand ${className}` : 'brand'}>
      <BrandMark size={size} className="brand-mark" />
      <span className="brand-name">
        PayOrder <span className="brand-accent">W3</span>
        {suffix ? ` ${suffix}` : null}
      </span>
    </span>
  );
}
