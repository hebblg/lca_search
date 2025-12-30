// components/SiteHeader.tsx
import Link from "next/link";

export default function SiteHeader() {
  return (
    <header
      style={{
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        background: "white",
      }}
    >
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", fontWeight: 800 }}>
          H-1B LCA Wages
        </Link>

        <nav style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Link href="/" style={navLink}>Search</Link>
          <Link href="/salary" style={navLink}>States</Link>
          <Link href="/methodology" style={navLink}>Methodology</Link>
          <Link href="/about" style={navLink}>About</Link>
          <Link href="/privacy" style={navLink}>Privacy</Link>
        </nav>
      </div>
    </header>
  );
}

const navLink: React.CSSProperties = {
  textDecoration: "none",
  opacity: 0.9,
};
