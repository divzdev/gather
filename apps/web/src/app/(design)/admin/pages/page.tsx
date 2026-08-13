"use client";

/** Resource and wiki pages for the speaker portal.
 *
 *  The API has shipped list/create/update/delete since the first migration, the
 *  portal renders them on its Resources tab, and the rail has said "Forms &
 *  pages" since the IA cleanup — but nothing in the console ever called any of
 *  it. The only thing in the product that made a `Page` was the seeder, so this
 *  read as a finished feature on the demo event and did not exist on anyone
 *  else's.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { Rail } from "@/components/console/Rail";
import { SectionTabs } from "@/components/console/SectionTabs";
import { PAGE_ICON, PageHead } from "@/components/ui";
import { authed, getEventId } from "@/lib/session";

import { BLANK, PageEditor, VISIBILITY, type PageDraft, type Visibility } from "./editor";

type PageRow = {
  id: string;
  title: string;
  slug: string;
  blocks: PageDraft["blocks"];
  visibility: Visibility;
  is_pinned_in_portal: boolean;
  sort_order: number;
};

const TONE: Record<Visibility, { fg: string; bg: string; bd: string }> = {
  draft: { fg: "var(--i2,#3E4E58)", bg: "var(--sk,#EDF1F2)", bd: "var(--ln,#E1E7E9)" },
  speakers_only: { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)", bd: "var(--okl,#C2E0D5)" },
  public: { fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)", bd: "var(--ifl,#C6CDEA)" },
};

const pill = (tone: "primary" | "quiet"): React.CSSProperties => ({
  minHeight: 36,
  padding: "0 16px",
  borderRadius: 999,
  cursor: "pointer",
  font: "600 12.5px 'IBM Plex Sans',sans-serif",
  border: tone === "primary" ? "none" : "1px solid var(--ls,#C8D2D5)",
  background: tone === "primary" ? "var(--bt,#FF6B6B)" : "transparent",
  color: tone === "primary" ? "var(--bf,#331313)" : "var(--i2,#3E4E58)",
});

const card: React.CSSProperties = {
  border: "1px solid var(--ln,#E1E7E9)",
  background: "var(--cd,#FFFFFF)",
  borderRadius: 14,
  padding: 22,
  boxShadow: "0 1px 2px rgba(13,16,32,.04)",
};

export default function PagesScreen() {
  const eventId = typeof window === "undefined" ? null : getEventId();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<{ id: string | null; draft: PageDraft } | null>(null);
  const [problem, setProblem] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<PageRow | null>(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["pages", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<PageRow[]>(`/events/${eventId}/pages`),
  });

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["pages", eventId] });
    setEditing(null);
    setProblem("");
  };

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: PageDraft }) =>
      authed<PageRow>(id === null ? `/events/${eventId}/pages` : `/events/${eventId}/pages/${id}`, {
        method: id === null ? "POST" : "PATCH",
        body: draft,
      }),
    onSuccess: done,
    onError: (error: Error) => setProblem(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => authed(`/events/${eventId}/pages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(null);
      done();
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const submit = () => {
    if (editing === null) return;
    if (editing.draft.title.trim() === "") {
      setProblem("A page needs a title — it is what a speaker sees in the list.");
      return;
    }
    save.mutate(editing);
  };

  const rows = [...(data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title),
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "var(--pp,#F4F6F7)",
        color: "var(--ik,#16232B)",
      }}
    >
      <Rail active="Forms" style={{ height: "100%", minHeight: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <ConsoleHeader />
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          <div style={{ padding: "20px 28px 80px" }}>
            <PageHead
              icon={PAGE_ICON.pages}
              crumbs={["Setup", "Pages"]}
              title="Pages"
              summary="Guides, run-of-show notes and anything else a speaker needs. They appear on the Resources tab of the portal."
            />
            <SectionTabs />

            {editing !== null ? (
              <section style={{ ...card, maxWidth: 820 }}>
                <h2
                  style={{
                    font: "600 15px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                    margin: "0 0 18px",
                  }}
                >
                  {editing.id === null ? "New page" : "Edit page"}
                </h2>

                <PageEditor
                  draft={editing.draft}
                  onChange={(draft) => setEditing({ ...editing, draft })}
                />

                {problem !== "" && (
                  <p
                    role="alert"
                    style={{
                      font: "400 13px 'IBM Plex Sans',sans-serif",
                      color: "var(--cn,#D8432B)",
                      margin: "16px 0 0",
                    }}
                  >
                    {problem}
                  </p>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={save.isPending}
                    style={{ ...pill("primary"), opacity: save.isPending ? 0.7 : 1 }}
                  >
                    {save.isPending ? "Saving…" : "Save page"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setProblem("");
                    }}
                    style={pill("quiet")}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div style={{ display: "flex", marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setProblem("");
                      setEditing({ id: null, draft: { ...BLANK } });
                    }}
                    style={pill("primary")}
                  >
                    New page
                  </button>
                </div>

                {isError ? (
                  <section style={{ ...card, maxWidth: 820 }}>
                    <p
                      role="alert"
                      style={{
                        font: "400 13.5px 'IBM Plex Sans',sans-serif",
                        color: "var(--cn,#D8432B)",
                        margin: "0 0 12px",
                      }}
                    >
                      The pages could not be loaded.
                    </p>
                    <button type="button" onClick={() => void refetch()} style={pill("quiet")}>
                      Try again
                    </button>
                  </section>
                ) : isPending ? (
                  <p
                    style={{
                      font: "400 13.5px 'IBM Plex Sans',sans-serif",
                      color: "var(--i3,#6B7B84)",
                    }}
                  >
                    Loading pages…
                  </p>
                ) : rows.length === 0 ? (
                  <section style={{ ...card, maxWidth: 820 }}>
                    <h2
                      style={{
                        font: "600 15px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        margin: "0 0 6px",
                      }}
                    >
                      No pages yet
                    </h2>
                    <p
                      style={{
                        font: "400 13.5px/1.6 'IBM Plex Sans',sans-serif",
                        color: "var(--i3,#6B7B84)",
                        margin: 0,
                        maxWidth: "62ch",
                      }}
                    >
                      Most conferences start with three: how to get to the venue, what the A/V setup
                      is, and what happens on the day. A page stays a draft until you say otherwise,
                      so nothing reaches a speaker before you are ready.
                    </p>
                  </section>
                ) : (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "grid",
                      gap: 10,
                      maxWidth: 820,
                    }}
                  >
                    {rows.map((row) => {
                      const tone = TONE[row.visibility];
                      const named = VISIBILITY.find((entry) => entry.key === row.visibility);
                      return (
                        <li
                          key={row.id}
                          style={{
                            ...card,
                            padding: "14px 18px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              font: "500 14px 'IBM Plex Sans',sans-serif",
                              color: "var(--ik,#16232B)",
                            }}
                          >
                            {row.title}
                          </span>
                          <span
                            style={{
                              padding: "3px 9px",
                              borderRadius: 999,
                              font: "500 11px 'IBM Plex Sans',sans-serif",
                              background: tone.bg,
                              color: tone.fg,
                              border: `1px solid ${tone.bd}`,
                            }}
                          >
                            {named?.label ?? row.visibility}
                          </span>
                          {row.is_pinned_in_portal && (
                            <span
                              title="Shown first, under a START HERE label."
                              style={{
                                font: "500 10.5px 'IBM Plex Mono',monospace",
                                letterSpacing: "0.08em",
                                color: "var(--sg,#E04E4E)",
                              }}
                            >
                              PINNED
                            </span>
                          )}
                          <span
                            className="tabular"
                            style={{
                              marginLeft: "auto",
                              font: "400 12.5px 'IBM Plex Sans',sans-serif",
                              color: "var(--i3,#6B7B84)",
                            }}
                          >
                            {row.blocks.length} block{row.blocks.length === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            aria-label={`Edit ${row.title}`}
                            onClick={() => {
                              setProblem("");
                              setEditing({
                                id: row.id,
                                draft: {
                                  title: row.title,
                                  blocks: row.blocks,
                                  visibility: row.visibility,
                                  is_pinned_in_portal: row.is_pinned_in_portal,
                                  sort_order: row.sort_order,
                                },
                              });
                            }}
                            style={pill("quiet")}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${row.title}`}
                            onClick={() => setConfirmDelete(row)}
                            style={{ ...pill("quiet"), color: "var(--cn,#D8432B)" }}
                          >
                            Delete
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDelete !== null && (
        <DeleteConfirm
          title={confirmDelete.title}
          published={confirmDelete.visibility !== "draft"}
          pending={remove.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => remove.mutate(confirmDelete.id)}
        />
      )}
    </div>
  );
}

/** Deleting says what goes, and whether anyone was reading it. */
function DeleteConfirm({
  title,
  published,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  published: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,16,32,.42)",
        display: "grid",
        placeItems: "center",
        zIndex: 140,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="page-delete-title"
        onClick={(event) => event.stopPropagation()}
        style={{ ...card, width: 440, maxWidth: "100%", display: "grid", gap: 14 }}
      >
        <p
          id="page-delete-title"
          style={{
            font: "600 15px 'IBM Plex Sans',sans-serif",
            color: "var(--ik,#16232B)",
            margin: 0,
          }}
        >
          Delete “{title}”?
        </p>
        <p
          style={{
            font: "400 13px/1.6 'IBM Plex Sans',sans-serif",
            color: published ? "var(--cn,#D8432B)" : "var(--i3,#6B7B84)",
            margin: 0,
          }}
        >
          {published
            ? "Speakers can read this page right now. Deleting removes it from the portal immediately, and this cannot be undone."
            : "This page is a draft, so nobody has seen it. This cannot be undone."}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={pill("quiet")} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            style={{
              ...pill("quiet"),
              color: "var(--cn,#D8432B)",
              borderColor: "var(--cn,#D8432B)",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Deleting…" : "Delete page"}
          </button>
        </div>
      </div>
    </div>
  );
}
