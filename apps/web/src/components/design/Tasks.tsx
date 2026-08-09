"use client";

/* GENERATED from Tasks.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type TasksData = {
  readonly accents: readonly {
    readonly c: string;
    readonly n: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  }[];
  readonly allClear: boolean;
  readonly bySpeaker: (event: React.SyntheticEvent) => void;
  readonly byTask: (event: React.SyntheticEvent) => void;
  readonly cfpShort: React.ReactNode;
  readonly closeUser: (event: React.SyntheticEvent) => void;
  readonly groups: readonly {
    readonly chev: React.ReactNode;
    readonly hasOd: boolean;
    readonly meta: React.ReactNode;
    readonly n: React.ReactNode;
    readonly odLabel: React.ReactNode;
    readonly onTog: (event: React.SyntheticEvent) => void;
    readonly open: boolean;
    readonly rows: readonly {
      readonly bar: string;
      readonly c: React.ReactNode;
      readonly due: React.ReactNode;
      readonly dueFg: string;
      readonly ini: React.ReactNode;
      readonly n: React.ReactNode;
      readonly onDone: (event: React.SyntheticEvent) => void;
      readonly onNudge: (event: React.SyntheticEvent) => void;
      readonly sub: React.ReactNode;
    }[];
  }[];
  readonly nudgeAll: (event: React.SyntheticEvent) => void;
  readonly odCount: React.ReactNode;
  readonly popUser: boolean;
  readonly profileGo: (event: React.SyntheticEvent) => void;
  readonly signOut: (event: React.SyntheticEvent) => void;
  readonly subCount: React.ReactNode;
  readonly sumLine: React.ReactNode;
  readonly summary: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly fill: string;
    readonly frac: React.ReactNode;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly w: string;
  }[];
  readonly tDoneT: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tOdT: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tOpen: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tSpk: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly themeGlyph: React.ReactNode;
  readonly themeTitle: string;
  readonly themeWord: React.ReactNode;
  readonly toasts: readonly {
    readonly canUndo: boolean;
    readonly msg: React.ReactNode;
    readonly onUndo: (event: React.SyntheticEvent) => void;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togTheme: (event: React.SyntheticEvent) => void;
  readonly togUser: (event: React.SyntheticEvent) => void;
  readonly unreviewedCount: React.ReactNode;
  readonly vSpBg: string;
  readonly vSpFg: string;
  readonly vSpSh: string;
  readonly vSpWt: string;
  readonly vTaskBg: string;
  readonly vTaskFg: string;
  readonly vTaskSh: string;
  readonly vTaskWt: string;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Tasks({ d }: { d: TasksData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Task dashboard" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Tasks" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <div style={{height: "48px", flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{display: "flex", alignItems: "center", gap: "8px", font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}><span style={{width: "7px", height: "7px", borderRadius: "50%", background: "var(--ok,#0E7A5F)"}}></span>AI Engineer 2026</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>/ Tasks</span> <div style={{flex: "1"}}></div> <button onClick={d.nudgeAll} style={{height: "30px", padding: "0 13px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>Nudge all overdue</button> <div style={{position: "relative"}}> <button className="dch-e45ba47f" onClick={d.togUser} title="Account" aria-label="Account menu" style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", padding: "0"}}>SW</button> {d.popUser ? (<> <button onClick={d.closeUser} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "41"}}></button> <div style={{position: "absolute", top: "36px", right: "0", width: "248px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 16px 40px rgba(13,16,32,.20)", padding: "6px", zIndex: "42"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px"}}> <span style={{width: "32px", height: "32px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 11px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>SW</span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Sasha Whitfield</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>program lead · demo org</span></span> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "8px 10px 6px"}}>THEME</div> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "0 10px 10px"}}> {(d.accents ?? []).map((ac, acIndex) => (<Fragment key={acIndex}><button onClick={ac.on} title={ac.n} aria-label={ac.n} style={{width: "16px", height: "16px", borderRadius: "50%", border: "none", background: ac.c, boxShadow: ac.ring, padding: "0", flex: "none"}}></button></Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.togTheme} title={d.themeTitle} style={{display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", borderRadius: "99px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.themeGlyph} {d.themeWord}</button> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-c4989b43" onClick={d.profileGo} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textAlign: "left"}}>Your profile</button> <Link className="dch-c4989b43" href="/admin/settings" style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "7px", textDecoration: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Workspace settings</Link> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-57a5fa4b" onClick={d.signOut} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", textAlign: "left"}}>Sign out</button> </div> </>) : null} </div> </div> <div style={{height: "32px", flex: "none", display: "flex", alignItems: "center", gap: "16px", overflowX: "auto", padding: "0 20px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <Link href="/admin/submissions" style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)", textDecoration: "none"}}>SUB {d.subCount}</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link href="/review" style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)", textDecoration: "none"}}>UNREVIEWED {d.unreviewedCount}</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <span style={{font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--pd,#B96A1F)"}}>OVERDUE TASKS {d.odCount}</span><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link href="/admin/agenda" style={{font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--cn,#D8432B)", textDecoration: "none"}}>⚠ 3 CONFLICTS</Link> <div style={{flex: "1"}}></div> <span style={{font: "400 10.5px 'IBM Plex Mono',monospace", whiteSpace: "nowrap", color: "var(--i4,#99A6AD)"}}>CFP closes in {d.cfpShort}</span> </div> <div style={{flex: "1", overflowY: "auto", padding: "20px 28px 80px"}}> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 24px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.015em", color: "var(--ik,#16232B)", margin: "0"}}>Tasks</h1> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>who owes you what, latest first</span> <div style={{flex: "1"}}></div> <div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> <button onClick={d.byTask} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: d.vTaskBg, color: d.vTaskFg, font: `${d.vTaskWt} 12px 'IBM Plex Sans',sans-serif`, whiteSpace: "nowrap", boxShadow: d.vTaskSh}}>By task</button> <button onClick={d.bySpeaker} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: d.vSpBg, color: d.vSpFg, font: `${d.vSpWt} 12px 'IBM Plex Sans',sans-serif`, whiteSpace: "nowrap", boxShadow: d.vSpSh}}>By speaker</button> </div> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>{d.sumLine}</div> <div style={{display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: "12px", marginBottom: "16px"}}> <button onClick={d.tOpen.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tOpen.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tOpen.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--ifw,#E9ECF7)", color: "var(--if,#47599F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor"><rect x="1.5" y="2" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="6.3" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="10.6" width="8" height="2.4" rx="1.2"></rect></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tOpen.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tOpen.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Open items</span></span> </button> <button onClick={d.tOdT.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tOdT.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tOdT.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M7.5 4.3v3.4l2.3 1.4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tOdT.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tOdT.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Overdue</span></span> </button> <button onClick={d.tSpk.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tSpk.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tSpk.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--sw,#FFEAE6)", color: "var(--sg,#E04E4E)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="4.8" r="2.5"></circle><path d="M2.8 12.8c.6-2.5 2.4-3.9 4.7-3.9s4.1 1.4 4.7 3.9"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tSpk.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tSpk.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Speakers waiting</span></span> </button> <button onClick={d.tDoneT.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tDoneT.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tDoneT.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--okw,#E2F1EC)", color: "var(--ok,#0E7A5F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M4.8 7.8l1.8 1.8 3.6-4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tDoneT.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tDoneT.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Done this week</span></span> </button> </div> <div style={{display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px"}}> {(d.summary ?? []).map((sm, smIndex) => (<Fragment key={smIndex}> <button onClick={sm.on} style={{display: "flex", flexDirection: "column", gap: "6px", minWidth: "150px", padding: "10px 13px", borderRadius: "8px", background: sm.bg, border: `1px solid ${sm.bd}`, textAlign: "left"}}> <span style={{display: "flex", justifyContent: "space-between", gap: "10px"}}><span style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{sm.n}</span><span style={{font: "500 11px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{sm.frac}</span></span> <span style={{display: "block", height: "3px", borderRadius: "2px", background: "var(--ln,#E1E7E9)"}}><span style={{display: "block", height: "3px", borderRadius: "2px", background: sm.fill, width: sm.w}}></span></span> </button> </Fragment>))} </div> {(d.groups ?? []).map((g, gIndex) => (<Fragment key={gIndex}> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", marginBottom: "12px", overflow: "hidden"}}> <button onClick={g.onTog} style={{width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", background: "none", border: "none", textAlign: "left"}}> <span style={{font: "400 10px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>{g.chev}</span> <span style={{font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{g.n}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{g.meta}</span> <div style={{flex: "1"}}></div> {g.hasOd ? (<> <span style={{display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px", borderRadius: "4px", background: "var(--cnw,#FBE8E6)", font: "500 10.5px 'IBM Plex Mono',monospace", color: "var(--cn,#D8432B)"}}>{g.odLabel}</span> </>) : null} </button> {g.open ? (<> {(g.rows ?? []).map((r, rIndex) => (<Fragment key={rIndex}> <div style={{display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: "1px solid var(--ln,#E1E7E9)", borderLeft: `3px solid ${r.bar}`}}> <span style={{width: "24px", height: "24px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 8.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)", flex: "none"}}>{r.ini}</span> <div style={{flex: "1", minWidth: "0"}}><div style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.n} <span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>· {r.c}</span></div><div style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>{r.sub}</div></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: r.dueFg, whiteSpace: "nowrap"}}>{r.due}</span> <button onClick={r.onNudge} style={{height: "26px", padding: "0 10px", borderRadius: "999px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--pdw,#F9EDDF)", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)", whiteSpace: "nowrap"}}>Nudge</button> <button onClick={r.onDone} style={{height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap"}}>Mark complete</button> </div> </Fragment>))} </>) : null} </div> </Fragment>))} {d.allClear ? (<> <div style={{border: "1px solid var(--okl,#C2E0D5)", borderRadius: "8px", background: "var(--okw,#E2F1EC)", padding: "16px", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ok,#0E7A5F)"}}>Nothing outstanding in this view. 84 speakers, zero open tasks here.</div> </>) : null} </div> </div> <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> {t.canUndo ? (<> <button onClick={t.onUndo} style={{background: "none", border: "none", font: "600 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", padding: "0"}}>Undo</button> </>) : null} <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
