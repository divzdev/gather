"use client";

/** Staff sign-in, on the design in `GatherDesign/Auth.dc.html`.
 *
 *  Written by hand rather than generated from that prototype. The prototype
 *  binds twelve values, all of them presentational — it has no seam for a field
 *  value, a per-field error, a busy state or a submit — so running it through
 *  `dc2tsx` would produce a beautiful screen that cannot sign anybody in. The
 *  markup and the palette are the prototype's; the behaviour is here.
 *
 *  Three ways in, and they are not interchangeable:
 *    · password        — staff only, no reset, which is why the link below exists
 *    · emailed link    — staff *or* speaker; the server decides which, and
 *                        clicking it is also how an address gets confirmed
 *    · GitHub          — absent unless this install has a client id configured
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { setEventId, setSpeakerToken, setToken } from "@/lib/session";

import {
  BrandPanel,
  Divider,
  GithubGlyph,
  HAIRLINE,
  INK,
  Label,
  Mark,
  Notice,
  Primary,
  Quiet,
  display,
  fieldStyle,
  monoFont,
} from "./chrome";

type Mode = "login" | "register";
type BadField = "name" | "email" | "password" | null;

/** The same rules the API enforces, not a looser subset: a field the browser
 *  accepts and the server rejects is the worst of both. Returns *which* field
 *  failed, so one message marks one input. */
function firstProblem(fields: { name: string; email: string; password: string }): {
  field: Exclude<BadField, null>;
  message: string;
} | null {
  if (fields.name.trim() === "") return { field: "name", message: "Your name is needed." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) {
    return { field: "email", message: "That email address does not look right." };
  }
  if (fields.password.length < 12) {
    return { field: "password", message: "Use a passphrase of at least 12 characters." };
  }
  return null;
}

/** What GitHub sent us back with, translated. These arrive as a query parameter
 *  on the redirect, so the screen has to be able to say what happened. */
const OAUTH_PROBLEMS: Record<string, string> = {
  oauth_state: "That GitHub sign-in took too long, or was already used. Start it again.",
  oauth_failed: "GitHub could not complete the sign-in. Try again, or use your password.",
};

/** `useSearchParams` opts a route out of static prerendering unless it sits
 *  inside a Suspense boundary — `next build` fails on /login without this, which
 *  lint and tsc never see because neither runs a build. */
export default function LoginRoute() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}

function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  /** Where the visitor was heading before the console bounced them here. Only
   *  in-app paths are honoured, so a crafted ?next= cannot redirect off-site. */
  const requested = params.get("next");
  const next =
    requested !== null && requested.startsWith("/") && !requested.startsWith("//")
      ? (requested as Parameters<typeof router.push>[0])
      : null;

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(OAUTH_PROBLEMS[params.get("error") ?? ""] ?? "");
  const [badField, setBadField] = useState<BadField>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const fieldRef: Record<Exclude<BadField, null>, React.RefObject<HTMLInputElement | null>> = {
    name: nameField,
    email: emailField,
    password: passwordField,
  };

  /** Both of these describe the deployment, not the visitor, and both are
   *  absent on a build that has not configured them — an empty demo list and
   *  `github: false` are the correct rendering, not a failure. */
  const { data: demoAccounts } = useQuery({
    queryKey: ["demo-accounts"],
    retry: false,
    queryFn: () =>
      apiFetch<{ role: string; label: string; email: string }[]>("/auth/demo-accounts").catch(
        () => [],
      ),
  });
  const { data: providers } = useQuery({
    queryKey: ["auth-providers"],
    retry: false,
    staleTime: Infinity,
    queryFn: () =>
      apiFetch<{ github: boolean }>("/auth/providers").catch(() => ({ github: false })),
  });

  const isLogin = mode === "login";
  // A field-level error that only reddens the border leaves a keyboard or
  // screen-reader user to hunt for what failed. Sending focus to the field
  // itself — not just naming it in the error text — is what actually gets
  // them there.
  const fail = (message: string, field: BadField = null) => {
    setError(message);
    setBadField(field);
    if (field !== null) fieldRef[field].current?.focus();
  };

  /** Every staff path ends the same way: stash the token, pick up an event so
   *  the console has something to render, and go. */
  const enterConsole = async (accessToken: string, fallback: "/admin" | "/review") => {
    setToken(accessToken);
    const events = await apiFetch<{ id: string }[]>("/events", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const first = events[0];
    if (first !== undefined) setEventId(first.id);
    router.push(next ?? fallback);
  };

  const run = async (work: () => Promise<void>, whenItFails: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setBadField(null);
    try {
      await work();
    } catch (caught) {
      fail(caught instanceof ApiError ? caught.message : whenItFails);
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { access_token } = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      await enterConsole(access_token, "/admin");
    }, "Could not sign in. Try again.");

  const createAccount = () => {
    const problem = firstProblem({ name, email, password });
    if (problem !== null) {
      fail(problem.message, problem.field);
      return;
    }
    void run(async () => {
      const created = await apiFetch<{ access_token: string; email_verified: boolean }>(
        "/auth/register",
        { method: "POST", body: { name, organisation: "", email, password } },
      );
      // Nothing is said here about confirming, deliberately: this screen is
      // about to be replaced by the console. The banner that names the two
      // locked actions lives there, where it stays until the link is clicked.
      await enterConsole(created.access_token, "/admin");
    }, "Could not create the account. Try again.");
  };

  const sendMagicLink = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      fail(
        email.trim() === "" ? "Enter your email first." : "That email address does not look right.",
        "email",
      );
      return;
    }
    void run(async () => {
      // Always 204, whether or not the address exists — the response must not
      // reveal who has an account. Rate limiting can still refuse, and the
      // person has to be told when it does.
      await apiFetch("/auth/magic-link", { method: "POST", body: { email } });
      setLinkSentTo(email);
    }, "Could not send the link. Try again shortly.");
  };

  const demoSignIn = (role: string) =>
    void run(async () => {
      const issued = await apiFetch<{ access_token: string; kind: string }>("/auth/demo-login", {
        method: "POST",
        body: { role },
      });
      if (issued.kind === "speaker") {
        setSpeakerToken(issued.access_token);
        router.push("/portal");
        return;
      }
      await enterConsole(issued.access_token, role === "reviewer" ? "/review" : "/admin");
    }, "That demo account is not seeded yet.");

  const startGithub = () => {
    // A real navigation, not `router.push`. This path is not a Next page — it is
    // the rewrite to the API, which answers 307 to github.com. Client-side
    // routing would look for a route that does not exist and never leave.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/v1/auth/github/start${next === null ? "" : `?next=${encodeURIComponent(next)}`}`;
  };

  return (
    <div
      className="grid min-h-screen lg:grid-cols-2"
      style={{
        background: INK.page,
        color: INK.text,
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <BrandPanel />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          padding: "26px clamp(22px,4vw,56px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/"
            className="flex lg:hidden"
            style={{ alignItems: "center", gap: 9, textDecoration: "none", color: INK.text }}
          >
            <Mark size={22} />
            <span style={{ ...display("16px"), letterSpacing: "-.02em" }}>Gather</span>
          </Link>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: INK.muted, fontWeight: 600 }}>
            {isLogin ? "New here?" : "Already set up?"}
          </span>
          <button
            type="button"
            onClick={() => {
              setMode(isLogin ? "register" : "login");
              setError("");
              setBadField(null);
              setLinkSentTo(null);
            }}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: INK.text,
              background: "none",
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 980,
              minHeight: 36,
              padding: "7px 16px",
              cursor: "pointer",
            }}
          >
            {isLogin ? "Create an account" : "Sign in"}
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isLogin) void signIn();
            else createAccount();
          }}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            maxWidth: 392,
            width: "100%",
            margin: "0 auto",
            padding: "44px 0",
          }}
        >
          <h1 style={{ ...display("clamp(1.9rem,3vw,2.5rem)"), margin: "0 0 10px" }}>
            {isLogin ? "Welcome back." : "Create your account."}
          </h1>
          <p style={{ fontSize: 14.5, color: INK.muted, fontWeight: 500, margin: "0 0 30px" }}>
            {isLogin ? "Sign in to your event console." : "Free forever. Your data stays yours."}
          </p>

          <DemoLogins accounts={demoAccounts ?? []} onPick={demoSignIn} busy={busy} />

          {providers?.github === true ? (
            <>
              <Quiet onClick={startGithub}>
                <GithubGlyph />
                Continue with GitHub
              </Quiet>
              <Divider label="OR" />
            </>
          ) : null}

          {isLogin ? null : (
            <>
              <Label htmlFor="af-name">Full name</Label>
              <input
                id="af-name"
                ref={nameField}
                type="text"
                value={name}
                autoComplete="name"
                placeholder="Marta Villalobos"
                onChange={(event) => setName(event.target.value)}
                style={{ ...fieldStyle(badField === "name"), marginBottom: 18 }}
              />
            </>
          )}

          <Label htmlFor="af-email">Email</Label>
          <input
            id="af-email"
            ref={emailField}
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@conference.org"
            onChange={(event) => setEmail(event.target.value)}
            style={{ ...fieldStyle(badField === "email"), marginBottom: 18 }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              margin: "0 0 8px",
            }}
          >
            <Label htmlFor="af-pw">Password</Label>
            {isLogin ? (
              <button
                type="button"
                onClick={sendMagicLink}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: INK.muted,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                Forgot password?
              </button>
            ) : null}
          </div>
          <div style={{ position: "relative", marginBottom: 18 }}>
            <input
              id="af-pw"
              ref={passwordField}
              type={reveal ? "text" : "password"}
              value={password}
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={reveal ? "correct horse battery staple" : "••••••••••••"}
              onChange={(event) => setPassword(event.target.value)}
              style={{ ...fieldStyle(badField === "password"), padding: "13px 74px 13px 15px" }}
            />
            <button
              type="button"
              onClick={() => setReveal((shown) => !shown)}
              style={{
                position: "absolute",
                right: 9,
                top: "50%",
                transform: "translateY(-50%)",
                background: "#1F1F24",
                border: "none",
                color: INK.muted,
                font: `700 10px/1 ${monoFont}`,
                letterSpacing: ".12em",
                padding: "9px 12px",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {reveal ? "HIDE" : "SHOW"}
            </button>
          </div>
          {isLogin ? null : (
            <div
              style={{ fontSize: 12, color: INK.faint, fontWeight: 600, margin: "-10px 0 18px" }}
            >
              At least 12 characters.
            </div>
          )}

          {error === "" ? null : (
            <div
              role="alert"
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "#F0766A",
                margin: "0 0 16px",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <Primary busy={busy}>
            {busy
              ? isLogin
                ? "Signing in…"
                : "Creating…"
              : isLogin
                ? "Sign in"
                : "Create account"}
          </Primary>

          {isLogin ? (
            <div style={{ marginTop: 12 }}>
              {linkSentTo === null ? (
                <Quiet onClick={sendMagicLink}>Email me a magic link instead</Quiet>
              ) : (
                <Notice>
                  <span style={{ minWidth: 0 }}>
                    Link sent to {linkSentTo}. It works once, for 30 minutes, and signs in staff and
                    speakers alike.
                  </span>
                  <button
                    type="button"
                    onClick={sendMagicLink}
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      color: INK.muted,
                      font: `700 11px ${monoFont}`,
                      letterSpacing: ".08em",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    RESEND
                  </button>
                </Notice>
              )}
            </div>
          ) : (
            <p
              style={{
                fontSize: 12,
                color: INK.faint,
                fontWeight: 600,
                margin: "16px 0 0",
                lineHeight: 1.6,
                textAlign: "center",
              }}
            >
              Your account, your data, your server. Nothing leaves this install.
            </p>
          )}
        </form>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            fontFamily: monoFont,
            fontSize: 11,
            color: INK.faint,
          }}
        >
          <span>Self-hosted. Your data stays yours.</span>
          <span>MIT licensed</span>
        </div>
      </div>
    </div>
  );
}

/** One-click sign-in for the seeded demo accounts.
 *
 *  App behaviour, not design chrome — every end-to-end test signs in with these
 *  and the demo build is graded on them being findable — so they live here and
 *  cannot disappear when the prototype is redrawn. Absent on a real deployment:
 *  the endpoint listing them 404s unless DEMO_MODE is on, so the array is empty
 *  and this renders nothing.
 */
function DemoLogins({
  accounts,
  onPick,
  busy,
}: {
  accounts: readonly { role: string; label: string }[];
  onPick: (role: string) => void;
  busy: boolean;
}) {
  if (accounts.length === 0) return null;

  return (
    <div
      style={{
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 14,
        padding: 16,
        marginBottom: 22,
        background: INK.field,
      }}
    >
      <div
        style={{
          font: `700 10px ${monoFont}`,
          letterSpacing: ".14em",
          color: INK.coral,
          marginBottom: 10,
        }}
      >
        DEMO DATA · NO PASSWORD NEEDED
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {accounts.map((account) => (
          <button
            key={account.role}
            type="button"
            disabled={busy}
            onClick={() => onPick(account.role)}
            title={`Sign in as ${account.label}`}
            style={{
              minHeight: 38,
              padding: "0 16px",
              borderRadius: 999,
              border: `1px solid ${HAIRLINE}`,
              background: "transparent",
              font: "600 12.5px var(--font-manrope), sans-serif",
              color: INK.text,
              whiteSpace: "nowrap",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {account.role.replace(/^./, (letter) => letter.toUpperCase())}
          </button>
        ))}
      </div>
    </div>
  );
}
