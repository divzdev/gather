"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Auth, type AuthData } from "@/components/design/Auth";
import { ApiError, apiFetch } from "@/lib/api";
import { setEventId, setSpeakerToken, setToken } from "@/lib/session";

type Mode = "login" | "register";

/** Staff sign-in. Speakers never reach this screen — they get a magic link and
 *  land in the portal, which is why the link option here sends one rather than
 *  offering a password reset. */
/** Client-side checks for the register form.
 *
 *  Deliberately the same rules the API enforces, not a looser subset: a field
 *  the browser accepts and the server rejects is the worst of both.
 */
function firstProblem(fields: {
  name: string;
  organisation: string;
  email: string;
  password: string;
}): { field: "name" | "email" | "password"; message: string } | null {
  // Returns *which* field failed, not just a sentence. Both borders used to
  // redden on any error, so "Your name is needed." marked the email and
  // password fields and left the name field looking fine.
  if (fields.name.trim() === "") return { field: "name", message: "Your name is needed." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) {
    return { field: "email", message: "That email address does not look right." };
  }
  if (fields.password.length < 12) {
    return { field: "password", message: "Use a passphrase of at least 12 characters." };
  }
  return null;
}

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
  /** Where the visitor was heading before the console bounced them here. Only
   *  in-app paths are honoured, so a crafted ?next= cannot redirect off-site. */
  const requested = useSearchParams().get("next");
  // Typed routes cannot know a runtime path, and the guard above is what makes
  // this safe: same-origin, absolute, never protocol-relative.
  const next =
    requested !== null && requested.startsWith("/") && !requested.startsWith("//")
      ? (requested as Parameters<typeof router.push>[0])
      : null;
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  /** Which field the message is about, so only that one is marked. */
  const [badField, setBadField] = useState<"name" | "email" | "password" | null>(null);
  const [sent, setSent] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Present only on a demo build; the endpoint 404s everywhere else, so an
   *  empty list is the correct rendering on a real deployment. */
  const { data: demoAccounts } = useQuery({
    queryKey: ["demo-accounts"],
    retry: false,
    queryFn: () =>
      apiFetch<{ role: string; label: string; email: string }[]>("/auth/demo-accounts").catch(
        () => [] as { role: string; label: string; email: string }[],
      ),
  });

  const demoSignIn = async (role: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const issued = await apiFetch<{
        access_token: string;
        kind: string;
        event_id: string | null;
      }>("/auth/demo-login", { method: "POST", body: { role } });

      if (issued.kind === "speaker") {
        setSpeakerToken(issued.access_token);
        router.push("/portal");
        return;
      }
      setToken(issued.access_token);
      const events = await apiFetch<{ id: string }[]>("/events", {
        headers: { Authorization: `Bearer ${issued.access_token}` },
      });
      const first = events[0];
      if (first !== undefined) setEventId(first.id);
      router.push(next ?? (role === "reviewer" ? "/review" : "/admin"));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That demo account is not seeded yet.",
      );
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { access_token } = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(access_token);
      const events = await apiFetch<{ id: string }[]>("/events", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const first = events[0];
      if (first === undefined) {
        setError("That account is not a member of any event yet.");
        return;
      }
      setEventId(first.id);
      router.push(next ?? "/admin");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = async () => {
    if (busy) return;
    // Checked here as well as on the server: a typo should be caught while the
    // cursor is still in the field, not after a round trip. The server remains
    // the authority, this only saves the trip.
    const problem = firstProblem({ name, organisation, email, password });
    if (problem !== null) {
      setError(problem.message);
      setBadField(problem.field);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { access_token } = await apiFetch<{ access_token: string }>("/auth/register", {
        method: "POST",
        body: { name, organisation, email, password },
      });
      setToken(access_token);
      const events = await apiFetch<{ id: string }[]>("/events", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const first = events[0];
      if (first !== undefined) setEventId(first.id);
      router.push(next ?? "/admin");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not create the workspace. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const sendMagicLink = async () => {
    if (email.trim() === "") {
      setError("Enter your email first.");
      setBadField("email");
      return;
    }
    // Checked here because the endpoint 422s on a malformed address, and this
    // call had no try/catch: the request fired, the rejection went unhandled,
    // and the screen simply did not change.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That email address does not look right.");
      setBadField("email");
      return;
    }
    setError("");
    setBadField(null);
    try {
      // Always 204, whether or not the address exists — the response must not
      // reveal who has an account. Rate limiting and malformed input can still
      // fail, and the speaker has to be told.
      await apiFetch("/auth/magic-link", { method: "POST", body: { email } });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not send the link. Try again shortly.",
      );
      return;
    }
    setSent({
      title: "Check your email",
      body: `If ${email} belongs to a speaker on this event, a sign-in link is on its way. It works once and expires in 30 minutes.`,
    });
  };

  /** "Forgot it?" used to send a speaker magic link and say a link was on its
   *  way. A speaker link cannot sign a staff user in, so the screen was telling
   *  every locked-out organiser to go and wait for mail that would not help.
   *  There is no staff reset in this build; saying so is the honest fix. */
  const noStaffReset = () => {
    setSent({
      title: "There is no password reset yet",
      body:
        "Staff sign-in is password-only, and this build has no reset by email — the magic link below is for speakers and cannot sign a staff account in. " +
        "Ask an owner on your team to add you again, or use a demo account from the bar above to look around.",
    });
  };

  const unavailable = (what: string) => {
    setError(`${what} is not part of this build. Create a workspace with an email and password.`);
  };

  const screen: AuthData = {
    isLogin: mode === "login",
    isRegister: mode === "register",
    formView: sent === null,
    doneView: sent !== null,
    doneTitle: sent?.title ?? "",
    doneBody: sent?.body ?? "",
    doneBack: "Back to sign in",
    doneConsole: false,

    title: mode === "login" ? "Sign in to Gather" : "Create your account",
    subtitle:
      mode === "login"
        ? "The console for your speaker programme."
        : "Your account and your organisation. You name your event next.",
    cta: busy
      ? mode === "login"
        ? "Signing in…"
        : "Creating…"
      : mode === "login"
        ? "Sign in"
        : "Create account",

    email,
    onEmail: (event: React.SyntheticEvent) => setEmail((event.target as HTMLInputElement).value),
    emailBd: badField === "email" ? "var(--cn,#D8432B)" : "var(--ls,#C8D2D5)",
    nameBd: badField === "name" ? "var(--cn,#D8432B)" : "var(--ls,#C8D2D5)",

    pw: password,
    onPw: (event: React.SyntheticEvent) => setPassword((event.target as HTMLInputElement).value),
    pwBd: badField === "password" ? "var(--cn,#D8432B)" : "var(--ls,#C8D2D5)",
    pwType: reveal ? "text" : "password",
    pwToggle: reveal ? "Hide" : "Show",
    pwPlaceholder: "Your password",
    togPw: () => setReveal((shown) => !shown),

    name,
    onName: (event: React.SyntheticEvent) => setName((event.target as HTMLInputElement).value),
    org: organisation,
    onOrg: (event: React.SyntheticEvent) =>
      setOrganisation((event.target as HTMLInputElement).value),

    err: error,
    hasErr: error !== "",

    submit: () => void (mode === "register" ? createWorkspace() : signIn()),
    magic: () => void sendMagicLink(),
    forgot: () => noStaffReset(),
    resetFlow: () => setSent(null),

    switchMode: () => {
      setError("");
      setMode((current) => (current === "login" ? "register" : "login"));
    },
    switchLabel: mode === "login" ? "No account yet?" : "Already have an account?",
    switchCta: mode === "login" ? "Create one" : "Sign in",

    ssoGoogle: () => unavailable("Google sign-in"),
    ssoGithub: () => unavailable("GitHub sign-in"),
  };

  return (
    <>
      <DemoLogins accounts={demoAccounts ?? []} onPick={(role) => void demoSignIn(role)} />
      <Auth d={screen} />
    </>
  );
}

/** One-click sign-in for the seeded demo accounts.
 *
 *  Rendered here rather than through the Auth prototype, which used to carry
 *  these as `demos`/`hasDemo` slots and no longer does. They are app behaviour,
 *  not design chrome — every end-to-end test signs in with them and the demo
 *  build is graded on them being findable — so they must not disappear the next
 *  time the prototype is regenerated.
 *
 *  A banner in normal flow, above the form, not an overlay. The first attempt
 *  pinned it to the bottom of the viewport, which breaks on a phone: the layout
 *  viewport is taller than the visual one, so the panel sat below the reachable
 *  area and the buttons could not be tapped. Nothing here is positioned.
 *
 *  Absent on a real deployment: the endpoint that lists these 404s unless
 *  DEMO_MODE is on, so the array is empty and this renders nothing.
 */
function DemoLogins({
  accounts,
  onPick,
}: {
  accounts: readonly { role: string; label: string }[];
  onPick: (role: string) => void;
}) {
  if (accounts.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "10px 16px",
        background: "var(--sw,#FFEAE6)",
        borderBottom: "1px solid var(--sl,#FFC9C0)",
      }}
    >
      <span
        style={{
          font: "500 10px var(--font-plex-mono), monospace",
          letterSpacing: "0.08em",
          color: "var(--sg,#E04E4E)",
        }}
      >
        DEMO DATA
      </span>
      {accounts.map((account) => (
        <button
          key={account.role}
          onClick={() => onPick(account.role)}
          title={`Sign in as ${account.label}`}
          style={{
            height: 34,
            padding: "0 16px",
            borderRadius: 999,
            border: "1px solid var(--sl,#FFC9C0)",
            background: "var(--cd,#FFFFFF)",
            font: "500 12.5px var(--font-plex-sans), sans-serif",
            color: "var(--i2,#3E4E58)",
            whiteSpace: "nowrap",
          }}
        >
          {account.role.replace(/^./, (letter) => letter.toUpperCase())}
        </button>
      ))}
    </div>
  );
}
