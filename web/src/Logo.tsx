/** Three stacked slabs: a VM holding containers. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="logo">
      <rect x="2" y="2" width="16" height="16" rx="4" fill="currentColor" />
      <rect x="5.5" y="5.5" width="9" height="2.2" rx="1" fill="var(--logo-ink)" />
      <rect x="5.5" y="8.9" width="9" height="2.2" rx="1" fill="var(--logo-ink)" opacity="0.75" />
      <rect x="5.5" y="12.3" width="5.5" height="2.2" rx="1" fill="var(--logo-ink)" opacity="0.5" />
    </svg>
  );
}
