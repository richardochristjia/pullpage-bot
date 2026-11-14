"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "New run", match: (p: string) => p === "/" || p.startsWith("/runs") },
  { href: "/library", label: "Library", match: (p: string) => p.startsWith("/library") },
  { href: "/links", label: "Links", match: (p: string) => p.startsWith("/links") },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="nav">
      <div className="nav-in">
        <Link className="brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} />
          <span>pullpage-bot</span>
        </Link>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
            <Link key={t.href} className="tab" href={t.href} aria-current={t.match(path) ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
