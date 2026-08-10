"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
}): string | null {
  if (fields.name.trim() === "") return "Your name is needed.";
  if (fields.organisation.trim() === "") return "An event or organisation name is needed.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) {
    return "That email address does not look right.";
  }
  if (fields.password.length < 12) return "Use a passphrase of at least 12 characters.";
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
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
      router.push(role === "reviewer" ? "/review" : "/admin");
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
      router.push("/admin");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not sign in. Try again.",
      );
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
      setError(problem);
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
      router.push("/admin");
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
      return;
    }
    // Always 204, whether or not the address exists — the response must not
    // reveal who has an account.
    await apiFetch("/auth/magic-link", { method: "POST", body: { email } });
    setSent({
      title: "Check your email",
      body: `If ${email} belongs to a speaker on this event, a sign-in link is on its way. It works once and expires in 30 minutes.`,
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

    title: mode === "login" ? "Sign in to Gather" : "Create your workspace",
    subtitle:
      mode === "login"
        ? "The console for your speaker programme."
        : "Your organisation, your first event, and you as its owner.",
    cta: busy
      ? mode === "login"
        ? "Signing in…"
        : "Creating…"
      : mode === "login"
        ? "Sign in"
        : "Create workspace",

    email,
    onEmail: (event: React.SyntheticEvent) =>
      setEmail((event.target as HTMLInputElement).value),
    emailBd: error === "" ? "var(--ls,#C8D2D5)" : "var(--cn,#D8432B)",

    pw: password,
    onPw: (event: React.SyntheticEvent) =>
      setPassword((event.target as HTMLInputElement).value),
    pwBd: error === "" ? "var(--ls,#C8D2D5)" : "var(--cn,#D8432B)",
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
    forgot: () => void sendMagicLink(),
    resetFlow: () => setSent(null),

    switchMode: () => {
      setError("");
      setMode((current) => (current === "login" ? "register" : "login"));
    },
    switchLabel: mode === "login" ? "No account yet?" : "Already have an account?",
    switchCta: mode === "login" ? "Create one" : "Sign in",

    hasDemo: (demoAccounts ?? []).length > 0,
    demos: (demoAccounts ?? []).map((account) => ({
      n: account.role.replace(/^./, (letter) => letter.toUpperCase()),
      title: `Sign in as ${account.label}`,
      on: () => void demoSignIn(account.role),
    })),

    ssoGoogle: () => unavailable("Google sign-in"),
    ssoGithub: () => unavailable("GitHub sign-in"),
  };

  return <Auth d={screen} />;
}
