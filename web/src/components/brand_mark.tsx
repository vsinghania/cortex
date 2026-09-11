type Props = { size?: 'sm' | 'md' | 'lg' };

export function BrandMark({ size = 'md' }: Props) {
  return (
    <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          d="M15.6 8.4a5.1 5.1 0 1 0 0 7.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="17" cy="12" r="1.7" fill="currentColor" />
      </svg>
    </span>
  );
}
