import type { ReactNode, SVGProps } from "react";

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconGrid() {
  return (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function IconLaptop(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg width="22" height="22" strokeWidth="1.6" {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M1.5 19.5h21" />
    </Svg>
  );
}

export function IconFolder() {
  return (
    <Svg>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </Svg>
  );
}

export function IconApps() {
  return (
    <Svg>
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
      <circle cx="12" cy="12" r="4" />
    </Svg>
  );
}

export function IconActivity() {
  return (
    <Svg>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Svg>
  );
}

export function IconSettings() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
    </Svg>
  );
}

export function Mark({ suffix }: { suffix?: ReactNode }) {
  return (
    <span className="mark">
      <span className="prompt">&gt;_</span>
      bridge
      {suffix}
    </span>
  );
}
