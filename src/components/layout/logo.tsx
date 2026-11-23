export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className ?? "h-6 w-6"}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="4" className="fill-brand-600" />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="5.5"
        className="stroke-brand-500"
        strokeWidth="1.6"
        transform="rotate(-25 16 16)"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="5.5"
        className="stroke-brand-400"
        strokeWidth="1.6"
        transform="rotate(35 16 16)"
      />
    </svg>
  );
}
