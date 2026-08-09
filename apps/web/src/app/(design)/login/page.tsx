"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Auth, type AuthData } from "@/components/design/Auth";
import { ApiError, apiFetch } from "@/lib/api";
import { setEventId, setToken } from "@/lib/session";

type Mode = "login" | "register";

/** Staff sign-in. Speakers never reach this screen — they get a magic link and
 *  land in the portal, which is why the link option here sends one rather than
 *  offering a password reset. */
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

    ssoGoogle: () => unavailable("Google sign-in"),
    ssoGithub: () => unavailable("GitHub sign-in"),
  };

  return <Auth d={screen} />;
}
