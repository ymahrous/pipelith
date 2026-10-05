/**
 * The Pipelith mark: four instructions stepping through a pipeline, one stage
 * apart, set as a single solid block. The last one (amber) is the instruction
 * being checked. Same drawing as src/app/icon.svg.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#123f3e" />
      <g fill="#9cbdb5">
        <rect x="4.5" y="4.5" width="13" height="5" rx="1" />
        <rect x="7.8" y="10.5" width="13" height="5" rx="1" />
        <rect x="11.2" y="16.5" width="13" height="5" rx="1" />
      </g>
      <rect x="14.5" y="22.5" width="13" height="5" rx="1" fill="#e3a21a" />
    </svg>
  );
}
