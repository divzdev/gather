import { API_BASE_URL } from "@/lib/api";

type ReadyResponse = {
  status: string;
  checks: Record<string, string>;
};

/**
 * Scaffold page. It exists to prove the shell is wired: tokens render, fonts
 * load, and the browser can reach the API. Delete it once /admin lands.
 */
async function readApiStatus(): Promise<ReadyResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/ready`, { cache: "no-store" });
    return (await response.json()) as ReadyResponse;
  } catch {
    // The API not running is the expected case during frontend-only work.
    return null;
  }
}

export default async function Page() {
  const status = await readApiStatus();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-condensed text-eyebrow uppercase tracking-wide text-ink-3">
        Scaffold
      </p>
      <h1 className="mt-2 font-display text-display-md text-ink">Gather</h1>
      <p className="mt-3 text-body text-ink-2">
        Speaker and session management. The shell is up; screens are next.
      </p>

      <section className="mt-10 rounded-md border border-line bg-card p-5">
        <h2 className="text-title-md text-ink">API connection</h2>

        {status === null ? (
          <p className="mt-3 text-body-sm text-pending">
            No response from {API_BASE_URL}. Start it with{" "}
            <code className="font-mono text-mono-sm">make api</code>.
          </p>
        ) : (
          <dl className="mt-3 space-y-2">
            {Object.entries(status.checks).map(([name, value]) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <dt className="text-body-sm text-ink-2">{name}</dt>
                <dd
                  className={`tabular font-mono text-mono-sm ${
                    value === "ok" ? "text-clear" : "text-conflict"
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}
