import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Workflow home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Workflow</span>
        </Link>
        <Link className="topbar-resources" href="/resources">Resources</Link>
      </header>
      {children}
    </div>
  );
}
