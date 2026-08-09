import Link from "next/link";

import { ThemePill } from "@/components/ThemePill";

/** Temporary index while screens are ported. Replaced by the marketing landing. */
export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ font: "600 36px var(--font-bricolage), sans-serif", margin: 0 }}>Gather</h1>
        <ThemePill />
      </div>
      <p style={{ color: "var(--i2)", marginTop: 8 }}>
        Speaker and session management. Screens are being ported from the design set.
      </p>
      <nav style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/login" style={{ color: "var(--sg)" }}>
          Sign in
        </Link>
      </nav>
    </main>
  );
}
