"use client";

/** The signed-in account, shared under the `["me"]` key the whole console uses
 *  — one request, many readers. Extracted once three screens had grown their
 *  own inline copy of this query plus the owner/admin check.
 */

import { useQuery } from "@tanstack/react-query";

import { authed } from "@/lib/session";

export type Me = {
  name: string;
  email: string;
  role: string;
  org_name: string | null;
  email_verified: boolean;
  density_pref: string;
};

export function useMe(): { me: Me | undefined; isManager: boolean } {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<Me>("/auth/me"),
    staleTime: 5 * 60_000,
  });
  // "Manager" = the roles allowed to touch billing-adjacent settings; the API
  // enforces it regardless, this only decides what is worth drawing.
  return { me, isManager: me?.role === "owner" || me?.role === "admin" };
}
