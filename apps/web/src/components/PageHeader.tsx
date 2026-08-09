/** Page header used across console list pages: 24px title plus a friendly
 *  one-line summary carrying concrete counts. */
export function PageHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <div style={{ padding: "20px 28px 0", marginBottom: 16 }}>
      <h1 style={{ font: "600 24px var(--font-plex-sans), sans-serif", color: "var(--ik)", margin: 0 }}>
        {title}
      </h1>
      <p style={{ font: "400 13px var(--font-plex-sans), sans-serif", color: "var(--i3)", margin: "6px 0 0" }}>
        {summary}
      </p>
    </div>
  );
}
