"use client";

/* GENERATED from Review.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type ReviewData = {
  readonly youName: React.ReactNode;
  readonly youRole: React.ReactNode;
  readonly youOrg: React.ReactNode;
  readonly youInitials: React.ReactNode;
  readonly accents: readonly {
    readonly c: string;
    readonly n: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  }[];
  readonly aiChev: React.ReactNode;
  readonly aiOpen: boolean;
  readonly blindLabel: React.ReactNode;
  readonly closeUser: (event: React.SyntheticEvent) => void;
  readonly closesLine: React.ReactNode;
  readonly comment: string;
  readonly crits: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly hint: React.ReactNode;
    readonly lc: string;
    readonly n: React.ReactNode;
    readonly onFocus: (event: React.SyntheticEvent) => void;
    readonly opts: readonly {
      readonly bd: string;
      readonly bg: string;
      readonly fg: string;
      readonly n: React.ReactNode;
      readonly on: (event: React.SyntheticEvent) => void;
      readonly wt: string;
    }[];
  }[];
  readonly done: boolean;
  readonly doneLine: React.ReactNode;
  readonly flag: (event: React.SyntheticEvent) => void;
  readonly it: {
    readonly a1: React.ReactNode;
    readonly a1r: React.ReactNode;
    readonly a2: React.ReactNode;
    readonly a2r: React.ReactNode;
    readonly ab: React.ReactNode;
    readonly before: React.ReactNode;
    readonly col: string;
    readonly fmt: React.ReactNode;
    readonly id: React.ReactNode;
    readonly lvl: React.ReactNode;
    readonly t: React.ReactNode;
    readonly tools: React.ReactNode;
    readonly tr: React.ReactNode;
  };
  readonly next: (event: React.SyntheticEvent) => void;
  readonly onComment: (event: React.SyntheticEvent) => void;
  readonly popUser: boolean;
  readonly pos: React.ReactNode;
  readonly prev: (event: React.SyntheticEvent) => void;
  readonly profileGo: (event: React.SyntheticEvent) => void;
  readonly progW: string;
  readonly progress: React.ReactNode;
  readonly restart: (event: React.SyntheticEvent) => void;
  readonly saveLabel: React.ReactNode;
  readonly saveNext: (event: React.SyntheticEvent) => void;
  readonly signOut: (event: React.SyntheticEvent) => void;
  readonly skip: (event: React.SyntheticEvent) => void;
  readonly speakerLine: React.ReactNode;
  readonly themeGlyph: React.ReactNode;
  readonly themeTitle: string;
  readonly themeWord: React.ReactNode;
  readonly toasts: readonly {
    readonly msg: React.ReactNode;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togAi: (event: React.SyntheticEvent) => void;
  readonly togTheme: (event: React.SyntheticEvent) => void;
  readonly togUser: (event: React.SyntheticEvent) => void;
  readonly working: boolean;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Review({ d }: { d: ReviewData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Review screen" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Review" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <div style={{height: "48px", flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <Link href="/admin" style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", textDecoration: "none"}}>‹ Overview</Link> <span style={{font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Review · Round 1</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.pos}</span> <div style={{flex: "1"}}></div> <span style={{display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 10px", borderRadius: "5px", background: "var(--ifw,#E9ECF7)", border: "1px solid var(--ifl,#C6CDEA)", font: "500 10.5px 'IBM Plex Mono',monospace", color: "var(--if,#47599F)", whiteSpace: "nowrap"}}>{d.blindLabel}</span> <div style={{position: "relative"}}> <button className="dch-e45ba47f" onClick={d.togUser} title="Account" aria-label="Account menu" style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", padding: "0"}}>{d.youInitials}</button> {d.popUser ? (<> <button onClick={d.closeUser} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "41"}}></button> <div style={{position: "absolute", top: "36px", right: "0", width: "248px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 16px 40px rgba(13,16,32,.20)", padding: "6px", zIndex: "42"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px"}}> <span style={{width: "32px", height: "32px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 11px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>{d.youInitials}</span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.youName}</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.youRole} · {d.youOrg}</span></span> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "8px 10px 6px"}}>THEME</div> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "0 10px 10px"}}> {(d.accents ?? []).map((ac, acIndex) => (<Fragment key={acIndex}><button onClick={ac.on} title={ac.n} aria-label={ac.n} style={{width: "16px", height: "16px", borderRadius: "50%", border: "none", background: ac.c, boxShadow: ac.ring, padding: "0", flex: "none"}}></button></Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.togTheme} title={d.themeTitle} style={{display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", borderRadius: "99px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.themeGlyph} {d.themeWord}</button> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-c4989b43" onClick={d.profileGo} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textAlign: "left"}}>Your profile</button> <Link className="dch-c4989b43" href="/admin/settings" style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "7px", textDecoration: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Workspace settings</Link> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-57a5fa4b" onClick={d.signOut} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", textAlign: "left"}}>Sign out</button> </div> </>) : null} </div> </div> <div style={{height: "36px", flex: "none", display: "flex", alignItems: "center", gap: "14px", padding: "0 20px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{d.progress}</span> <div style={{width: "180px", height: "3px", borderRadius: "2px", background: "var(--ln,#E1E7E9)"}}><div style={{width: d.progW, height: "3px", borderRadius: "2px", background: "var(--sg,#E04E4E)"}}></div></div> <span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>{d.closesLine}</span> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>1–5 scores · Tab moves criteria · ⌘⏎ saves · j / k navigates</span> </div> {d.working ? (<> <div style={{flex: "1", overflowY: "auto", display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: "0"}}> <div style={{padding: "24px 28px", borderRight: "1px solid var(--ln,#E1E7E9)", minWidth: "0"}}> <div style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)", marginBottom: "6px"}}>{d.it.id}</div> <h1 style={{font: "600 21px/28px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.01em", color: "var(--ik,#16232B)", margin: "0 0 10px"}}>{d.it.t}</h1> <div style={{display: "flex", alignItems: "center", gap: "8px", marginBottom: "22px"}}> <span style={{padding: "2px 8px", borderLeft: `3px solid ${d.it.col}`, borderRadius: "4px", background: "var(--sk,#EDF1F2)", font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.it.tr}</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{d.it.fmt}</span> <span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>· {d.it.lvl}</span> </div> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>ABSTRACT</div> <p style={{font: "400 14px/22px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", margin: "0 0 22px", maxWidth: "640px", whiteSpace: "pre-line"}}>{d.it.ab}</p> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>FROM THE FORM</div> <div style={{display: "grid", gridTemplateColumns: "150px 1fr", gap: "6px 14px", maxWidth: "640px"}}> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Audience level</span><span style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.it.lvl}</span> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Tools mentioned</span><span style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.it.tools}</span> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Given before</span><span style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.it.before}</span> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Speaker</span><span style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", fontStyle: "italic"}}>{d.speakerLine}</span> </div> </div> <div style={{padding: "22px 22px 32px", background: "var(--cd,#FFFFFF)", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto"}}> {(d.crits ?? []).map((cr, crIndex) => (<Fragment key={crIndex}> <div onClick={cr.onFocus} style={{border: `1px solid ${cr.bd}`, borderRadius: "8px", padding: "12px 14px", cursor: "pointer", background: cr.bg}}> <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "9px"}}> <span style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: cr.lc}}>{cr.n} <span style={{color: "var(--cn,#D8432B)"}}>*</span></span> <span style={{font: "400 10px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{cr.hint}</span> </div> <div style={{display: "flex", gap: "6px"}}> {(cr.opts ?? []).map((o, oIndex) => (<Fragment key={oIndex}> <button onClick={o.on} style={{width: "34px", height: "32px", borderRadius: "6px", border: `1px solid ${o.bd}`, background: o.bg, color: o.fg, font: `${o.wt} 13px 'IBM Plex Mono',monospace`}}>{o.n}</button> </Fragment>))} </div> </div> </Fragment>))} <div> <label htmlFor="review-comment" style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i3,#6B7B84)", marginBottom: "7px"}}>COMMENT</label><textarea id="review-comment" value={d.comment} onChange={d.onComment} rows={3} placeholder="Visible to organizers, never to the speaker" style={{width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px/18px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", resize: "vertical", outlineColor: "#E04E4E"}}></textarea> </div> <div style={{border: "1px solid var(--sl,#FFC9C0)", borderRadius: "8px", overflow: "hidden"}}> <button onClick={d.togAi} style={{width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 13px", background: "var(--sw,#FFEAE6)", border: "none", textAlign: "left"}}> <span style={{font: "500 11px 'IBM Plex Mono',monospace", color: "var(--sg,#E04E4E)"}}>✦ SUGGESTED SCORES</span> <span style={{flex: "1"}}></span> <span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)"}}>{d.aiChev}</span> </button> {d.aiOpen ? (<> <div style={{padding: "11px 13px", background: "var(--sw,#FFEAE6)", borderTop: "1px solid var(--sl,#FFC9C0)"}}> <div style={{display: "flex", justifyContent: "space-between", marginBottom: "4px"}}><span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Relevance <span style={{font: "500 12px 'IBM Plex Mono',monospace"}}>{d.it.a1}</span></span></div> <div style={{font: "400 11.5px/16px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "8px"}}>{d.it.a1r}</div> <div style={{display: "flex", justifyContent: "space-between", marginBottom: "4px"}}><span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Originality <span style={{font: "500 12px 'IBM Plex Mono',monospace"}}>{d.it.a2}</span></span></div> <div style={{font: "400 11.5px/16px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "8px"}}>{d.it.a2r}</div> <div style={{font: "400 10.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>Never pre-fills your scores. Never counts toward the average.</div> </div> </>) : null} </div> <div style={{display: "flex", gap: "8px", alignItems: "center", marginTop: "auto"}}> <button onClick={d.saveNext} style={{flex: "1", height: "36px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 13px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>{d.saveLabel} <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", opacity: ".7"}}>⌘⏎</span></button> <button onClick={d.skip} style={{height: "36px", padding: "0 13px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Skip</button> <button onClick={d.flag} style={{height: "36px", padding: "0 13px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Flag</button> </div> <div style={{display: "flex", justifyContent: "space-between"}}> <button onClick={d.prev} style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", padding: "0"}}>‹ Previous (k)</button> <button onClick={d.next} style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", padding: "0"}}>Next (j) ›</button> </div> </div> </div> </>) : null} {d.done ? (<> <div style={{flex: "1", display: "flex", alignItems: "center", justifyContent: "center"}}> <div style={{textAlign: "center", maxWidth: "380px"}}> <div style={{width: "44px", height: "44px", borderRadius: "50%", background: "var(--okw,#E2F1EC)", border: "1px solid var(--okl,#C2E0D5)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 18px 'IBM Plex Sans',sans-serif", color: "var(--ok,#0E7A5F)", marginBottom: "14px"}}>✓</div> <div style={{font: "600 18px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "6px"}}>Round 1 complete</div> <div style={{font: "400 13.5px/20px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "18px"}}>{d.doneLine} Your scores are saved and the round owner can see your progress.</div> <div style={{display: "flex", justifyContent: "center", gap: "10px"}}> <Link href="/admin" style={{display: "inline-flex", alignItems: "center", height: "34px", padding: "0 16px", borderRadius: "999px", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 13px 'IBM Plex Sans',sans-serif", textDecoration: "none"}}>Back to overview</Link> <button onClick={d.restart} style={{height: "34px", padding: "0 14px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Start over</button> </div> </div> </div> </>) : null} </div> <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "420px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
