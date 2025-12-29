import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  title: "LCA Wage Search",
  description: "Search and explore U.S. Department of Labor H-1B LCA disclosure wage data.",
};

function HeaderNav() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand" href="/">
          LCA Wage Search
        </Link>

        <nav className="nav">
          <Link className="nav-link" href="/">
            Search
          </Link>
          <Link className="nav-link" href="/methodology">
            Methodology
          </Link>
          <Link className="nav-link" href="/about">
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span className="muted">
          Public disclosure data. Not legal advice.
        </span>
        <div className="footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <HeaderNav />
        <main className="container main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
