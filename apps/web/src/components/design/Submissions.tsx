"use client";

/* WAS generated from Submissions.dc.html — NOW HAND-MAINTAINED. Do not re-run
 * tools/dc2tsx.py on this screen: the prototype is stale and regenerating drops
 * five props that exist only here (conflictCount, overdueCount, publicHref,
 * pager, statusTabs), taking server-side pagination, the status tabs and the
 * filtered export with them. See docs/DECISIONS.md. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";
import { DecisionBar, NotesPanel } from "@/components/console/SubmissionPanels";
import type { Note, Outcome } from "@/components/console/SubmissionPanels";

export type SubmissionsData = {
  readonly onAddNote: (body: string) => Promise<unknown>;
  readonly notesBusy: boolean;
  readonly onDecide: (outcome: Outcome, reason: string) => Promise<unknown>;
  readonly decisionBusy: boolean;
  readonly overdueCount: React.ReactNode;
  readonly conflictCount: React.ReactNode;
  /** the event's own public page. The prototype hard-coded the demo's slug. */
  readonly publicHref: string;
  readonly allCk: React.ReactNode;
  readonly allCkBg: string;
  readonly banner: boolean;
  readonly bannerGo: (event: React.SyntheticEvent) => void;
  readonly bannerX: (event: React.SyntheticEvent) => void;
  readonly bulkAcc: (event: React.SyntheticEvent) => void;
  readonly bulkAssign: (event: React.SyntheticEvent) => void;
  readonly bulkRej: (event: React.SyntheticEvent) => void;
  readonly bulkWait: (event: React.SyntheticEvent) => void;
  readonly cfpDays: React.ReactNode;
  readonly cfpShort: React.ReactNode;
  readonly chips: readonly {
    readonly on: (event: React.SyntheticEvent) => void;
    readonly t: React.ReactNode;
  }[];
  readonly clearFilters: (event: React.SyntheticEvent) => void;
  readonly clearHover: (event: React.SyntheticEvent) => void;
  readonly clearSel: (event: React.SyntheticEvent) => void;
  readonly closeDrawer: (event: React.SyntheticEvent) => void;
  readonly closePop: (event: React.SyntheticEvent) => void;
  readonly countLine: React.ReactNode;
  readonly pager: React.ReactNode;
  readonly statusTabs: React.ReactNode;
  readonly decidedCount: React.ReactNode;
  readonly densTitle: string;
  readonly empty: boolean;
  readonly exportCsv: (event: React.SyntheticEvent) => void;
  readonly exportXlsx: (event: React.SyntheticEvent) => void;
  readonly firstRun: boolean;
  readonly focusSearch: (event: React.SyntheticEvent) => void;
  readonly hasChips: boolean;
  readonly hasSel: boolean;
  readonly hsAll: (event: React.SyntheticEvent) => void;
  readonly hsDecided: (event: React.SyntheticEvent) => void;
  readonly hsUnrev: (event: React.SyntheticEvent) => void;
  readonly keys: readonly {
    readonly d: React.ReactNode;
    readonly k: React.ReactNode;
  }[];
  readonly o: {
    readonly ab: React.ReactNode;
    readonly accBd: string;
    readonly accBg: string;
    readonly accFg: string;
    readonly acts: readonly {
      readonly x: React.ReactNode;
    }[];
    readonly crits: readonly {
      readonly n: React.ReactNode;
      readonly v: React.ReactNode;
      readonly w: string;
    }[];
    readonly dt: React.ReactNode;
    readonly fmt: React.ReactNode;
    readonly id: React.ReactNode;
    readonly lvl: React.ReactNode;
    readonly notes: readonly Note[];
    /** null until somebody decides. Drives the pressed state on the bar. */
    readonly decision: Outcome | null;
    readonly rejBd: string;
    readonly rejBg: string;
    readonly rejFg: string;
    readonly rev: React.ReactNode;
    readonly revs: readonly {
      readonly c: React.ReactNode;
      readonly n: React.ReactNode;
      readonly s: React.ReactNode;
    }[];
    readonly spList: readonly {
      readonly c: React.ReactNode;
      readonly ini: React.ReactNode;
      readonly n: React.ReactNode;
    }[];
    readonly st: React.ReactNode;
    readonly stBg: string;
    readonly stFg: string;
    readonly t: React.ReactNode;
    readonly tr: React.ReactNode;
    readonly trCol: string;
    readonly waitBd: string;
    readonly waitBg: string;
    readonly waitFg: string;
  };
  readonly onCoord: (event: React.SyntheticEvent) => void;
  readonly onQ: (event: React.SyntheticEvent) => void;
  readonly open: boolean;
  readonly pendingCount: React.ReactNode;
  readonly popHelp: boolean;
  readonly popStatus: boolean;
  readonly popTrack: boolean;
  readonly q: string;
  readonly rowH: string;
  readonly rows: readonly {
    readonly bg: string;
    readonly ck: React.ReactNode;
    readonly ckBd: string;
    readonly ckBg: string;
    readonly dt: React.ReactNode;
    readonly fmt: React.ReactNode;
    readonly id: React.ReactNode;
    readonly ini: React.ReactNode;
    readonly onAcc: (event: React.SyntheticEvent) => void;
    readonly onChk: (event: React.SyntheticEvent) => void;
    readonly onEnter: (event: React.SyntheticEvent) => void;
    readonly onOpen: (event: React.SyntheticEvent) => void;
    readonly onOpenBtn: (event: React.SyntheticEvent) => void;
    readonly onRej: (event: React.SyntheticEvent) => void;
    readonly op: string;
    readonly rev: React.ReactNode;
    readonly ring: string;
    readonly s1: string;
    readonly s2: string;
    readonly s3: string;
    readonly s4: string;
    readonly s5: string;
    readonly sc: React.ReactNode;
    readonly showQ: boolean;
    readonly spName: React.ReactNode;
    readonly spSub: React.ReactNode;
    readonly st: React.ReactNode;
    readonly stBg: string;
    readonly stFg: string;
    readonly t: React.ReactNode;
    readonly tr: React.ReactNode;
    readonly trCol: string;
  }[];
  readonly selAll: (event: React.SyntheticEvent) => void;
  readonly selN: React.ReactNode;
  readonly showTable: boolean;
  readonly soDate: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soScore: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soTitle: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly statusCountLabel: React.ReactNode;
  readonly statusOpts: readonly {
    readonly ck: React.ReactNode;
    readonly ckBg: string;
    readonly dot: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly subCount: React.ReactNode;
  readonly toasts: readonly {
    readonly canUndo: boolean;
    readonly msg: React.ReactNode;
    readonly onUndo: (event: React.SyntheticEvent) => void;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togDensity: (event: React.SyntheticEvent) => void;
  readonly togHelp: (event: React.SyntheticEvent) => void;
  readonly togStatus: (event: React.SyntheticEvent) => void;
  readonly togTrack: (event: React.SyntheticEvent) => void;
  readonly trackCountLabel: React.ReactNode;
  readonly trackOpts: readonly {
    readonly ck: React.ReactNode;
    readonly ckBg: string;
    readonly col: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly unreviewedCount: React.ReactNode;
  readonly vAcc: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly vNeed: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly vReady: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}
.dch-f129dbea:hover{color:var(--ik,#16232B)}`;

export function Submissions({ d }: { d: SubmissionsData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Submissions console" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Submissions" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <ConsoleHeader /> <div style={{height: "var(--control-h-sm, 36px)", flex: "none", display: "flex", alignItems: "center", gap: "16px", overflowX: "auto", padding: "0 20px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <button className="dch-f129dbea" onClick={d.hsAll} style={{background: "none", border: "none", display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 2px", font: "500 10.5px \'IBM Plex Mono\',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)"}}>SUB {d.subCount}</button><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <button className="dch-f129dbea" onClick={d.hsUnrev} style={{background: "none", border: "none", display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 2px", font: "500 10.5px \'IBM Plex Mono\',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)"}}>UNREVIEWED {d.unreviewedCount}</button><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <button className="dch-f129dbea" onClick={d.hsDecided} style={{background: "none", border: "none", display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 2px", font: "500 10.5px \'IBM Plex Mono\',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)"}}>DECIDED {d.decidedCount}</button><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link className="dch-f129dbea" href="/admin/tasks" style={{textDecoration: "none", background: "none", border: "none", display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 2px", font: "500 10.5px \'IBM Plex Mono\',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--pd,#B96A1F)"}}>OVERDUE TASKS {d.overdueCount}</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link className="dch-f129dbea" href="/admin/agenda" style={{display: "inline-flex", alignItems: "center", minHeight: "var(--control-h-sm, 36px)", textDecoration: "none", background: "none", border: "none", padding: "0 2px", font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--cn,#D8432B)"}}>⚠ {d.conflictCount} CONFLICTS</Link> <div style={{flex: "1"}}></div> <span style={{font: "400 10.5px 'IBM Plex Mono',monospace", whiteSpace: "nowrap", color: "var(--i4,#99A6AD)"}}>CFP closes in {d.cfpShort}</span> </div> <div style={{flex: "1", overflowY: "auto", position: "relative", padding: "20px 28px 80px"}}> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 30px/1.15 'IBM Plex Sans',sans-serif", letterSpacing: "-0.02em", color: "var(--ik,#16232B)", margin: "0"}}>Submissions</h1> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.countLine}</span>  <div style={{display: "flex", alignItems: "center", gap: "8px", flex: "none", alignSelf: "center", marginLeft: "auto"}}><button className="dch-c4989b43" onClick={d.togDensity} title={d.densTitle} style={{display: "flex", alignItems: "center", justifyContent: "center", width: "var(--control-h-sm, 36px)", height: "var(--control-h-sm, 36px)", borderRadius: "6px", background: "none", border: "none", color: "var(--i2,#3E4E58)"}}><svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor"><rect x="1.5" y="2.2" width="12" height="1.8" rx="0.9"></rect><rect x="1.5" y="6.6" width="12" height="1.8" rx="0.9"></rect><rect x="1.5" y="11" width="12" height="1.8" rx="0.9"></rect></svg></button> <div style={{position: "relative", display: "flex"}}><button className="dch-c4989b43" onClick={d.togHelp} title="Keyboard shortcuts (?)" style={{display: "flex", alignItems: "center", justifyContent: "center", width: "var(--control-h-sm, 36px)", height: "var(--control-h-sm, 36px)", borderRadius: "6px", background: "none", border: "none", font: "600 13px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)"}}>?</button> {d.popHelp ? (<> <button onClick={d.closePop} style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "31"}} aria-label="Close"></button> <div style={{position: "absolute", top: "38px", right: "0", width: "262px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", padding: "12px 14px", zIndex: "32"}}> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>KEYBOARD</div> {(d.keys ?? []).map((k, kIndex) => (<Fragment key={kIndex}> <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0"}}><span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{k.d}</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", border: "1px solid var(--ls,#C8D2D5)", borderRadius: "4px", padding: "1px 6px", color: "var(--i3,#6B7B84)"}}>{k.k}</span></div> </Fragment>))} </div> </>) : null}</div></div> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>{d.unreviewedCount} unreviewed across the program · {d.pendingCount} decisions queued to send · CFP closes in {d.cfpDays} days</div> <div style={{display: "grid", gridTemplateColumns: "repeat(3,minmax(190px,1fr))", gap: "12px", marginBottom: "16px"}}> <button onClick={d.vNeed.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.vNeed.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.vNeed.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "var(--control-h-sm, 36px)", height: "var(--control-h-sm, 36px)", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"></circle></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.vNeed.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.vNeed.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Awaiting reviews</span></span> </button> <button onClick={d.vReady.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.vReady.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.vReady.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "var(--control-h-sm, 36px)", height: "var(--control-h-sm, 36px)", borderRadius: "9px", background: "var(--sw,#FFEAE6)", color: "var(--sg,#E04E4E)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="12" height="12" rx="3"></rect><path d="M4.6 7.8l2 2 3.8-4.2"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.vReady.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.vReady.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Ready to decide</span></span> </button> <button onClick={d.vAcc.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.vAcc.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.vAcc.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "var(--control-h-sm, 36px)", height: "var(--control-h-sm, 36px)", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M4.8 7.8l1.8 1.8 3.6-4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.vAcc.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.vAcc.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Decided, not sent</span></span> </button> </div> {d.statusTabs} {d.banner ? (<> <div style={{display: "flex", alignItems: "center", gap: "12px", background: "var(--pdw,#F9EDDF)", border: "1px solid var(--pdl,#EFD3B6)", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px"}}> <span style={{width: "7px", height: "7px", borderRadius: "50%", background: "var(--pd,#B96A1F)", flex: "none"}}></span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", flex: "1"}}><span style={{fontWeight: "600", color: "var(--pd,#B96A1F)"}}>{d.pendingCount} decisions are set but not sent.</span> Emails only go out from Messages. Sending is always a separate, explicit step.</span> <button onClick={d.bannerGo} style={{height: "36px", padding: "0 10px", borderRadius: "6px", background: "none", border: "1px solid var(--pdl,#EFD3B6)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)"}}>Review and send</button> <button onClick={d.bannerX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "2px"}}>✕</button> </div> </>) : null} <div style={{display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "10px", position: "relative", zIndex: "20"}}> <input aria-label="Filter by title, speaker, or code. Press /" value={d.q} onChange={d.onQ} placeholder="Filter by title, speaker, or code. Press /" style={{height: "40px", width: "280px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "var(--sg, #E04E4E)"}} /> <div style={{position: "relative"}}> <button className="dch-c4989b43" onClick={d.togTrack} style={{height: "36px", padding: "0 11px", borderRadius: "999px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}><span style={{display: "inline-flex", alignItems: "center", gap: "6px"}}><svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" style={{flex: "none"}}><path d="M1.5 2.5h12l-4.6 5.4v4.2l-2.8 1.4V7.9L1.5 2.5z"></path></svg>Track {d.trackCountLabel} ▾</span></button> {d.popTrack ? (<> <button onClick={d.closePop} style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "21"}} aria-label="Close"></button> <div style={{position: "absolute", top: "36px", left: "0", width: "210px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", padding: "6px", zIndex: "22"}}> {(d.trackOpts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <button className="dch-c4989b43" onClick={t.on} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "7px 9px", borderRadius: "6px", background: "none", border: "none", textAlign: "left"}}><span style={{width: "12px", height: "12px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: t.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)"}}>{t.ck}</span><span style={{width: "8px", height: "8px", borderRadius: "2px", background: t.col}}></span><span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.n}</span></button> </Fragment>))} </div> </>) : null} </div> <div style={{position: "relative"}}> <button className="dch-c4989b43" onClick={d.togStatus} style={{height: "36px", padding: "0 11px", borderRadius: "999px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}><span style={{display: "inline-flex", alignItems: "center", gap: "6px"}}><svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" style={{flex: "none"}}><path d="M1.5 2.5h12l-4.6 5.4v4.2l-2.8 1.4V7.9L1.5 2.5z"></path></svg>Status {d.statusCountLabel} ▾</span></button> {d.popStatus ? (<> <button onClick={d.closePop} style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "21"}} aria-label="Close"></button> <div style={{position: "absolute", top: "36px", left: "0", width: "190px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", padding: "6px", zIndex: "22"}}> {(d.statusOpts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <button className="dch-c4989b43" onClick={t.on} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "7px 9px", borderRadius: "6px", background: "none", border: "none", textAlign: "left"}}><span style={{width: "12px", height: "12px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: t.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)"}}>{t.ck}</span><span style={{width: "6px", height: "6px", borderRadius: "50%", background: t.dot}}></span><span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.n}</span></button> </Fragment>))} </div> </>) : null} </div> <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.exportCsv} style={{height: "36px", padding: "0 12px", borderRadius: "999px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Export CSV</button> <button className="dch-c4989b43" onClick={d.exportXlsx} style={{height: "36px", padding: "0 12px", borderRadius: "999px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Export XLSX</button> </div> {d.hasChips ? (<> <div style={{display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "10px"}}> {(d.chips ?? []).map((c, cIndex) => (<Fragment key={cIndex}> <button onClick={c.on} style={{display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 9px", borderRadius: "99px", background: "var(--sw,#FFEAE6)", border: "1px solid var(--sl,#FFC9C0)", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)"}}>{c.t} ✕</button> </Fragment>))} <button onClick={d.clearFilters} style={{background: "none", border: "none", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", textDecoration: "underline"}}>Clear all</button> </div> </>) : null} {d.firstRun ? (<> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", background: "var(--cd,#FFFFFF)", padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center"}}> <svg width="26" height="26" viewBox="0 0 15 15" fill="var(--i3,#6B7B84)"><rect x="1.5" y="2" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="6.3" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="10.6" width="8" height="2.4" rx="1.2"></rect></svg> <div style={{font: "600 16px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", margin: "14px 0 4px"}}>No submissions yet</div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "18px"}}>When your call for papers is open, proposals land here.</div> <Link href={d.publicHref as never} style={{display: "inline-flex", alignItems: "center", height: "36px", padding: "0 16px", borderRadius: "999px", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "500 13px 'IBM Plex Sans',sans-serif", textDecoration: "none"}}>Open the call for papers</Link> </div> </>) : null} {d.showTable ? (<> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", overflow: "visible"}}> <div style={{display: "grid", gridTemplateColumns: "36px 54px minmax(200px,1fr) 176px 132px 108px 76px 44px 104px 60px", gap: "8px", alignItems: "center", padding: "0 12px", height: "38px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <button onClick={d.selAll} aria-label="Select all" style={{width: "24px", height: "24px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: d.allCkBg, display: "flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", padding: "0"}}>{d.allCk}</button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>CODE</span> <button className="dch-f129dbea" onClick={d.soTitle.on} title="Sort by title" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", minHeight: "36px", padding: "0 2px", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soTitle.fg}}>TITLE<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soTitle.gc, letterSpacing: "0"}}>{d.soTitle.g}</span></button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>SPEAKER</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>TRACK</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>FORMAT</span> <button className="dch-f129dbea" onClick={d.soScore.on} title="Sort by score" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", minHeight: "36px", padding: "0 2px", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soScore.fg}}>SCORE<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soScore.gc, letterSpacing: "0"}}>{d.soScore.g}</span></button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>REV</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>STATUS</span> <button className="dch-f129dbea" onClick={d.soDate.on} title="Sort by date" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", minHeight: "36px", padding: "0 2px", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soDate.fg}}>DATE<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soDate.gc, letterSpacing: "0"}}>{d.soDate.g}</span></button> </div> {(d.rows ?? []).map((r, rIndex) => (<Fragment key={rIndex}> <div onClick={r.onOpen} onMouseEnter={r.onEnter} onMouseLeave={d.clearHover} style={{display: "grid", gridTemplateColumns: "36px 54px minmax(200px,1fr) 176px 132px 108px 76px 44px 104px 60px", gap: "8px", alignItems: "center", padding: "0 12px", height: d.rowH, borderBottom: "1px solid var(--ln,#E1E7E9)", cursor: "pointer", position: "relative", background: r.bg, boxShadow: r.ring, opacity: r.op}}> <button onClick={r.onChk} aria-label="Select row" style={{width: "24px", height: "24px", borderRadius: "4px", border: `1px solid ${r.ckBd}`, background: r.ckBg, display: "flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", padding: "0"}}>{r.ck}</button> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{r.id}</span> <span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px"}}>{r.t}</span> <span style={{display: "flex", alignItems: "center", gap: "8px", minWidth: "0"}}><span style={{width: "20px", height: "20px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 8px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)", flex: "none"}}>{r.ini}</span><span style={{minWidth: "0"}}><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.spName}</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.spSub}</span></span></span> <span style={{justifySelf: "start", maxWidth: "100%", boxSizing: "border-box", padding: "3px 9px", borderLeft: `3px solid ${r.trCol}`, borderRadius: "5px", background: "var(--sk,#EDF1F2)", font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.tr}</span> <span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0}}>{r.fmt}</span> <span style={{display: "flex", alignItems: "center", gap: "6px"}}><span style={{font: "500 12px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)", fontVariantNumeric: "tabular-nums", minWidth: "24px"}}>{r.sc}</span><span style={{display: "inline-flex", gap: "2px"}}><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.s1}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.s2}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.s3}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.s4}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.s5}}></span></span></span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{r.rev}</span> <span style={{justifySelf: "start", display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: r.stFg, background: r.stBg}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: r.stFg}}></span>{r.st}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{r.dt}</span> {r.showQ ? (<> <span style={{position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "4px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "6px", padding: "3px", boxShadow: "0 2px 6px rgba(16,19,25,.08)"}}> <button onClick={r.onAcc} title="Accept (a)" aria-label="Accept" style={{height: "36px", minWidth: "30px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--okl,#C2E0D5)", background: "var(--okw,#E2F1EC)", color: "var(--ok,#0E7A5F)", font: "600 11.5px 'IBM Plex Sans',sans-serif", display: "inline-flex", alignItems: "center", gap: "5px"}}>✓ Accept</button> <button onClick={r.onRej} title="Reject (r)" aria-label="Reject" style={{height: "36px", minWidth: "30px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--cnl,#F3C7C2)", background: "var(--cnw,#FBE8E6)", color: "var(--cn,#D8432B)", font: "600 11.5px 'IBM Plex Sans',sans-serif", display: "inline-flex", alignItems: "center", gap: "5px"}}>✕ Reject</button> <button onClick={r.onOpenBtn} title="Open (Enter)" style={{width: "24px", height: "24px", borderRadius: "4px", border: "none", background: "var(--sk,#EDF1F2)", color: "var(--i2,#3E4E58)", font: "600 11px 'IBM Plex Sans',sans-serif"}}>→</button> </span> </>) : null} </div> </Fragment>))} {d.empty ? (<> <div style={{padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center"}}> <div style={{font: "600 14px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "4px"}}>No submissions match these filters</div> <button onClick={d.clearFilters} style={{background: "none", border: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", textDecoration: "underline"}}>Clear filters</button> </div> </>) : null} <div style={{padding: "0 12px"}}>{d.pager}</div> <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px"}}> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.countLine}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>j / k to move · x to select · Enter opens</span> </div> </div> </>) : null} {d.hasSel ? (<> <div style={{position: "sticky", bottom: "16px", display: "flex", justifyContent: "center", marginTop: "16px", zIndex: "25"}}> <div style={{display: "flex", alignItems: "center", gap: "8px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "8px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)"}}> <span style={{font: "500 12px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)", padding: "0 6px"}}>{d.selN} selected</span> <div style={{width: "1px", height: "18px", background: "var(--ln,#E1E7E9)"}}></div> <button onClick={d.bulkAcc} style={{height: "36px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--okl,#C2E0D5)", background: "var(--okw,#E2F1EC)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ok,#0E7A5F)"}}>Accept</button> <button onClick={d.bulkWait} style={{height: "36px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--pdw,#F9EDDF)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)"}}>Waitlist</button> <button onClick={d.bulkRej} style={{height: "36px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--cnl,#F3C7C2)", background: "var(--cnw,#FBE8E6)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)"}}>Reject</button> <button onClick={d.bulkAssign} style={{height: "36px", padding: "0 11px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Assign reviewers</button> <button onClick={d.exportCsv} style={{height: "36px", padding: "0 11px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Export selected</button> <button onClick={d.clearSel} aria-label="Clear selection" style={{width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "none", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>✕</button> </div> </div> </>) : null} </div> </div> {d.open ? (<> <button onClick={d.closeDrawer} aria-label="Close" style={{position: "fixed", inset: "0", background: "rgba(20,17,12,.32)", border: "none", zIndex: "60", cursor: "default"}}></button> <div style={{position: "fixed", top: "0", right: "0", bottom: "0", width: "min(720px,94vw)", background: "var(--cd,#FFFFFF)", borderLeft: "1px solid var(--ln,#E1E7E9)", boxShadow: "0 12px 32px rgba(16,19,25,.24)", zIndex: "61", display: "flex", flexDirection: "column"}}> <div style={{padding: "18px 24px 14px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px"}}> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{d.o.id}</span> <span style={{display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: d.o.stFg, background: d.o.stBg}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: d.o.stFg}}></span>{d.o.st}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>submitted {d.o.dt}</span> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>j / k for next</span> <button className="dch-c4989b43" onClick={d.closeDrawer} aria-label="Close" style={{width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "none", font: "500 14px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>✕</button> </div> <div style={{font: "600 19px/25px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.01em", color: "var(--ik,#16232B)", marginBottom: "8px"}}>{d.o.t}</div> <div style={{display: "flex", alignItems: "center", gap: "8px"}}> <span style={{padding: "2px 8px", borderLeft: `3px solid ${d.o.trCol}`, borderRadius: "4px", background: "var(--sk,#EDF1F2)", font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.o.tr}</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{d.o.fmt}</span> <span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>· {d.o.lvl}</span> </div> </div> <div style={{flex: "1", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 250px", gap: "26px", padding: "20px 24px"}}> <div> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>ABSTRACT</div> <p style={{font: "400 13.5px/21px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", margin: "0 0 20px", whiteSpace: "pre-line"}}>{d.o.ab}</p> <NotesPanel notes={d.o.notes} onAdd={d.onAddNote} busy={d.notesBusy} /> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>ACTIVITY</div> {(d.o.acts ?? []).map((a, aIndex) => (<Fragment key={aIndex}> <div style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", padding: "3px 0"}}>{a.x}</div> </Fragment>))} </div> <div> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>SPEAKERS</div> {(d.o.spList ?? []).map((s, sIndex) => (<Fragment key={sIndex}> <div style={{display: "flex", alignItems: "center", gap: "9px", marginBottom: "10px"}}><span style={{width: "26px", height: "26px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)"}}>{s.ini}</span><span><span style={{display: "block", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{s.n}</span><span style={{display: "block", font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>{s.c}</span></span></div> </Fragment>))} <label htmlFor="submissions-coordinator" style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", margin: "16px 0 6px"}}>COORDINATOR</label><select id="submissions-coordinator" onChange={d.onCoord} style={{width: "100%", height: "40px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", color: "var(--ik,#16232B)", font: "400 12.5px 'IBM Plex Sans',sans-serif", padding: "0 8px"}}> <option>Unassigned</option><option>S. Whitfield</option><option>R. Tanaka</option><option>M. Osei</option> </select> <div style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", margin: "18px 0 8px"}}>REVIEWS · {d.o.rev}</div> {(d.o.crits ?? []).map((c, cIndex) => (<Fragment key={cIndex}> <div style={{marginBottom: "8px"}}><div style={{display: "flex", justifyContent: "space-between", marginBottom: "3px"}}><span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{c.n}</span><span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{c.v}</span></div><div style={{height: "3px", borderRadius: "2px", background: "var(--ln,#E1E7E9)"}}><div style={{height: "3px", borderRadius: "2px", background: "var(--i2,#3E4E58)", width: c.w}}></div></div></div> </Fragment>))} {(d.o.revs ?? []).map((rv, rvIndex) => (<Fragment key={rvIndex}> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", marginTop: "8px"}}><div style={{display: "flex", justifyContent: "space-between", marginBottom: "3px"}}><span style={{font: "600 11.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{rv.n}</span><span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{rv.s}</span></div><div style={{font: "400 11.5px/17px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>{rv.c}</div></div> </Fragment>))} </div> </div> <DecisionBar current={d.o.decision} onDecide={d.onDecide} busy={d.decisionBusy} /> </div> </>) : null} <div style={{position: "fixed", right: "20px", bottom: "20px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--sg,#E04E4E)", borderLeft: "4px solid var(--sg,#E04E4E)", borderRadius: "10px", padding: "12px 14px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "420px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> {t.canUndo ? (<> <button onClick={t.onUndo} style={{display: "inline-flex", alignItems: "center", minHeight: "var(--control-h-sm, 36px)", background: "none", border: "none", font: "600 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", padding: "0 4px"}}>Undo</button> </>) : null} <button onClick={t.onX} aria-label="Dismiss" style={{display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "var(--control-h-sm, 36px)", minHeight: "var(--control-h-sm, 36px)", background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
