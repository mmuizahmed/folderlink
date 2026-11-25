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

export function IconSearch() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function IconShield() {
  return (
    <Svg>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function IconTerminal() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h5" />
    </Svg>
  );
}

export function IconRefresh() {
  return (
    <Svg>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3v4h-4" />
    </Svg>
  );
}

export function IconDownload() {
  return (
    <Svg>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 21h16" />
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

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true" {...props}>
      <path
        fill="#F2F4F7"
        d="M6 2h32a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5H16v11h8a4 4 0 0 1 4 4v8a8 8 0 0 1-8 8H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"
      />
      <path
        fill="#22C55E"
        d="M36 22h18a5 5 0 0 1 5 5v27a5 5 0 0 1-5 5H26a4 4 0 0 1-4-4l10-24a5 5 0 0 1 4-5z"
      />
    </svg>
  );
}

export function Mark({ suffix }: { suffix?: ReactNode }) {
  return (
    <span className="mark">
      <LogoMark />
      <span className="word">FolderLink</span>
      {suffix}
    </span>
  );
}
