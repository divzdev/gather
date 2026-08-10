"use client";

/* GENERATED from Speakers.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type SpeakersData = {
  readonly accents: readonly {
    readonly c: string;
    readonly n: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  }[];
  readonly addNote: (event: React.SyntheticEvent) => void;
  readonly allCk: React.ReactNode;
  readonly allCkBg: string;
  readonly bulkLink: (event: React.SyntheticEvent) => void;
  readonly bulkNudge: (event: React.SyntheticEvent) => void;
  readonly bulkTask: (event: React.SyntheticEvent) => void;
  readonly cfpShort: React.ReactNode;
  readonly clearF: (event: React.SyntheticEvent) => void;
  readonly clearFilters: (event: React.SyntheticEvent) => void;
  readonly clearHover: (event: React.SyntheticEvent) => void;
  readonly clearSel: (event: React.SyntheticEvent) => void;
  readonly closeDrawer: (event: React.SyntheticEvent) => void;
  readonly closeFPop: (event: React.SyntheticEvent) => void;
  readonly closeUser: (event: React.SyntheticEvent) => void;
  readonly countLine: React.ReactNode;
  readonly dNudge: (event: React.SyntheticEvent) => void;
  readonly empty: boolean;
  readonly exportCsv: (event: React.SyntheticEvent) => void;
  readonly fBd: string;
  readonly fBg: string;
  readonly fCount: React.ReactNode;
  readonly fFg: string;
  readonly fMissOpts: readonly {
    readonly ck: React.ReactNode;
    readonly ckBg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly fPopOn: boolean;
  readonly fStatusOpts: readonly {
    readonly ck: React.ReactNode;
    readonly ckBg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly hasSel: boolean;
  readonly headerNote: React.ReactNode;
  readonly missChips: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly t: React.ReactNode;
  }[];
  readonly noteDraft: string;
  readonly o: {
    readonly c: React.ReactNode;
    readonly email: React.ReactNode;
    readonly files: readonly {
      readonly ext: React.ReactNode;
      readonly meta: React.ReactNode;
      readonly n: React.ReactNode;
      readonly v: React.ReactNode;
    }[];
    readonly ini: React.ReactNode;
    readonly missN: React.ReactNode;
    readonly n: React.ReactNode;
    readonly noFiles: boolean;
    readonly notes: readonly {
      readonly a: React.ReactNode;
      readonly t: React.ReactNode;
      readonly x: React.ReactNode;
    }[];
    readonly sessMeta: React.ReactNode;
    readonly sessT: React.ReactNode;
    readonly tasks: readonly {
      readonly bar: string;
      readonly canDo: boolean;
      readonly due: React.ReactNode;
      readonly dueFg: string;
      readonly n: React.ReactNode;
      readonly onDone: (event: React.SyntheticEvent) => void;
      readonly sub: React.ReactNode;
    }[];
  };
  readonly onNoteDraft: (event: React.SyntheticEvent) => void;
  readonly onQ: (event: React.SyntheticEvent) => void;
  readonly open: boolean;
  readonly popUser: boolean;
  readonly profileGo: (event: React.SyntheticEvent) => void;
  readonly q: string;
  readonly rowH: string;
  readonly rows: readonly {
    readonly b1: string;
    readonly b2: string;
    readonly b3: string;
    readonly b4: string;
    readonly b5: string;
    readonly b6: string;
    readonly bg: string;
    readonly c: React.ReactNode;
    readonly ck: React.ReactNode;
    readonly ckBd: string;
    readonly ckBg: string;
    readonly clean: boolean;
    readonly frac: React.ReactNode;
    readonly ini: React.ReactNode;
    readonly miss: readonly {
      readonly t: React.ReactNode;
    }[];
    readonly n: React.ReactNode;
    readonly onChk: (event: React.SyntheticEvent) => void;
    readonly onEnter: (event: React.SyntheticEvent) => void;
    readonly onOpen: (event: React.SyntheticEvent) => void;
    readonly ring: string;
    readonly seen: React.ReactNode;
    readonly seenFg: string;
    readonly sess: React.ReactNode;
    readonly st: React.ReactNode;
    readonly stBg: string;
    readonly stFg: string;
  }[];
  readonly selAll: (event: React.SyntheticEvent) => void;
  readonly selN: React.ReactNode;
  readonly signOut: (event: React.SyntheticEvent) => void;
  readonly soCompany: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soMissing: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soName: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soSess: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly subCount: React.ReactNode;
  readonly sumLine: React.ReactNode;
  readonly tAllS: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tDoneS: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tMiss: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tOdLabel: React.ReactNode;
  readonly tOdS: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tabFiles: boolean;
  readonly tabNotes: boolean;
  readonly tabSessions: boolean;
  readonly tabTasks: boolean;
  readonly tabs: readonly {
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ul: string;
    readonly wt: string;
  }[];
  readonly themeGlyph: React.ReactNode;
  readonly themeTitle: string;
  readonly themeWord: React.ReactNode;
  readonly toasts: readonly {
    readonly canUndo: boolean;
    readonly msg: React.ReactNode;
    readonly onUndo: (event: React.SyntheticEvent) => void;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togFPop: (event: React.SyntheticEvent) => void;
  readonly togTheme: (event: React.SyntheticEvent) => void;
  readonly togUser: (event: React.SyntheticEvent) => void;
  readonly unreviewedCount: React.ReactNode;
  readonly views: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly c: React.ReactNode;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-98b74b3e:hover{background:var(--sw,#FFEAE6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}
.dch-f129dbea:hover{color:var(--ik,#16232B)}`;

export function Speakers({ d }: { d: SpeakersData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Speakers" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Speakers" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <div style={{height: "48px", flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{display: "flex", alignItems: "center", gap: "8px", font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}><span style={{width: "7px", height: "7px", borderRadius: "50%", background: "var(--ok,#0E7A5F)"}}></span>AI Engineer 2026</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>/ Speakers</span> <div style={{flex: "1"}}></div> <div style={{position: "relative"}}> <button className="dch-e45ba47f" onClick={d.togUser} title="Account" aria-label="Account menu" style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", padding: "0"}}>SW</button> {d.popUser ? (<> <button onClick={d.closeUser} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "41"}}></button> <div style={{position: "absolute", top: "36px", right: "0", width: "248px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 16px 40px rgba(13,16,32,.20)", padding: "6px", zIndex: "42"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px"}}> <span style={{width: "32px", height: "32px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 11px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>SW</span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Sasha Whitfield</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>program lead · demo org</span></span> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "8px 10px 6px"}}>THEME</div> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "0 10px 10px"}}> {(d.accents ?? []).map((ac, acIndex) => (<Fragment key={acIndex}><button onClick={ac.on} title={ac.n} aria-label={ac.n} style={{width: "16px", height: "16px", borderRadius: "50%", border: "none", background: ac.c, boxShadow: ac.ring, padding: "0", flex: "none"}}></button></Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.togTheme} title={d.themeTitle} style={{display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", borderRadius: "99px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.themeGlyph} {d.themeWord}</button> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-c4989b43" onClick={d.profileGo} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textAlign: "left"}}>Your profile</button> <Link className="dch-c4989b43" href="/admin/settings" style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "7px", textDecoration: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Workspace settings</Link> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-57a5fa4b" onClick={d.signOut} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", textAlign: "left"}}>Sign out</button> </div> </>) : null} </div> </div> <div style={{height: "32px", flex: "none", display: "flex", alignItems: "center", gap: "16px", overflowX: "auto", padding: "0 20px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <Link href="/admin/submissions" style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)", textDecoration: "none"}}>SUB {d.subCount}</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link href="/review" style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)", textDecoration: "none"}}>UNREVIEWED {d.unreviewedCount}</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link href="/admin/tasks" style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--pd,#B96A1F)", textDecoration: "none"}}>OVERDUE TASKS 12</Link><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <Link href="/admin/agenda" style={{font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--cn,#D8432B)", textDecoration: "none"}}>⚠ 3 CONFLICTS</Link> <div style={{flex: "1"}}></div> <span style={{font: "400 10.5px 'IBM Plex Mono',monospace", whiteSpace: "nowrap", color: "var(--i4,#99A6AD)"}}>CFP closes in {d.cfpShort}</span> </div> <div style={{flex: "1", overflowY: "auto", position: "relative", padding: "20px 28px 80px"}}> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 24px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.015em", color: "var(--ik,#16232B)", margin: "0"}}>Speakers</h1> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.headerNote}</span> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>{d.sumLine}</div> <div style={{display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: "12px", marginBottom: "16px"}}> <button onClick={d.tAllS.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tAllS.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tAllS.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--ifw,#E9ECF7)", color: "var(--if,#47599F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="4.8" r="2.5"></circle><path d="M2.8 12.8c.6-2.5 2.4-3.9 4.7-3.9s4.1 1.4 4.7 3.9"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tAllS.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tAllS.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>On the roster</span></span> </button> <button onClick={d.tMiss.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tMiss.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tMiss.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--sw,#FFEAE6)", color: "var(--sg,#E04E4E)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"></circle></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tMiss.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tMiss.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Missing something</span></span> </button> <button onClick={d.tOdS.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tOdS.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tOdS.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M7.5 4.3v3.4l2.3 1.4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tOdS.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tOdS.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>{d.tOdLabel}</span></span> </button> <button onClick={d.tDoneS.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tDoneS.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tDoneS.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--okw,#E2F1EC)", color: "var(--ok,#0E7A5F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M4.8 7.8l1.8 1.8 3.6-4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tDoneS.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tDoneS.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Complete</span></span> </button> </div> <div style={{display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "10px"}}> <input aria-label="Filter by name or company. Press /" value={d.q} onChange={d.onQ} placeholder="Filter by name or company. Press /" style={{height: "32px", width: "260px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}} /> <div style={{position: "relative"}}> <button className="dch-c4989b43" onClick={d.togFPop} style={{display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", borderRadius: "999px", border: `1px solid ${d.fBd}`, background: d.fBg, font: "500 12px 'IBM Plex Sans',sans-serif", color: d.fFg}}><svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" style={{flex: "none"}}><path d="M1.5 2.5h12l-4.6 5.4v4.2l-2.8 1.4V7.9L1.5 2.5z"></path></svg>Filter{d.fCount}</button> {d.fPopOn ? (<> <button onClick={d.closeFPop} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "21"}}></button> <div style={{position: "absolute", top: "38px", left: "0", width: "238px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 12px 32px rgba(13,16,32,.18)", padding: "6px", zIndex: "22"}}> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "7px 10px 3px"}}>STATUS</div> {(d.fStatusOpts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <button className="dch-c4989b43" onClick={t.on} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "6px 10px", borderRadius: "6px", background: "none", border: "none", textAlign: "left"}}><span style={{width: "13px", height: "13px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: t.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", flex: "none"}}>{t.ck}</span><span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.n}</span></button> </Fragment>))} <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "5px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "7px 10px 3px"}}>MISSING ITEM</div> {(d.fMissOpts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <button className="dch-c4989b43" onClick={t.on} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "6px 10px", borderRadius: "6px", background: "none", border: "none", textAlign: "left"}}><span style={{width: "13px", height: "13px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: t.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", flex: "none"}}>{t.ck}</span><span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.n}</span></button> </Fragment>))} <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "5px 6px"}}></div> <button className="dch-98b74b3e" onClick={d.clearF} style={{width: "100%", padding: "7px 10px", borderRadius: "6px", border: "none", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", textAlign: "left"}}>Clear filters</button> </div> </>) : null} </div> {(d.views ?? []).map((v, vIndex) => (<Fragment key={vIndex}> <button onClick={v.on} style={{height: "32px", padding: "0 11px", borderRadius: "999px", background: v.bg, border: `1px solid ${v.bd}`, font: "500 12px 'IBM Plex Sans',sans-serif", color: v.fg, whiteSpace: "nowrap"}}>{v.n} <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", opacity: ".7"}}>{v.c}</span></button> </Fragment>))} <div style={{width: "1px", height: "20px", background: "var(--ln,#E1E7E9)"}}></div> {(d.missChips ?? []).map((mc, mcIndex) => (<Fragment key={mcIndex}> <button onClick={mc.on} style={{display: "inline-flex", alignItems: "center", gap: "5px", height: "26px", padding: "0 10px", borderRadius: "99px", background: mc.bg, border: `1px solid ${mc.bd}`, font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)", whiteSpace: "nowrap"}}>{mc.t}</button> </Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.exportCsv} style={{height: "32px", padding: "0 12px", borderRadius: "999px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Export CSV</button> </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)"}}> <div style={{display: "grid", gridTemplateColumns: "36px minmax(180px,1.2fr) 110px 60px 150px minmax(160px,1fr) 90px 92px", gap: "8px", alignItems: "center", padding: "0 12px", height: "34px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <button onClick={d.selAll} aria-label="Select all" style={{width: "14px", height: "14px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: d.allCkBg, display: "flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", padding: "0"}}>{d.allCk}</button> <button className="dch-f129dbea" onClick={d.soName.on} title="Sort by speaker" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soName.fg}}>SPEAKER<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soName.gc, letterSpacing: "0"}}>{d.soName.g}</span></button> <button className="dch-f129dbea" onClick={d.soCompany.on} title="Sort by company" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soCompany.fg}}>COMPANY<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soCompany.gc, letterSpacing: "0"}}>{d.soCompany.g}</span></button> <button className="dch-f129dbea" onClick={d.soSess.on} title="Sort by sess" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soSess.fg}}>SESS<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soSess.gc, letterSpacing: "0"}}>{d.soSess.g}</span></button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>TASKS</span> <button className="dch-f129dbea" onClick={d.soMissing.on} title="Sort by missing" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soMissing.fg}}>MISSING<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soMissing.gc, letterSpacing: "0"}}>{d.soMissing.g}</span></button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>PORTAL</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>STATUS</span> </div> {(d.rows ?? []).map((r, rIndex) => (<Fragment key={rIndex}> <div onClick={r.onOpen} onMouseEnter={r.onEnter} onMouseLeave={d.clearHover} style={{display: "grid", gridTemplateColumns: "36px minmax(180px,1.2fr) 110px 60px 150px minmax(160px,1fr) 90px 92px", gap: "8px", alignItems: "center", padding: "0 12px", height: d.rowH, borderBottom: "1px solid var(--ln,#E1E7E9)", cursor: "pointer", background: r.bg, boxShadow: r.ring}}> <button onClick={r.onChk} aria-label="Select row" style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${r.ckBd}`, background: r.ckBg, display: "flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", padding: "0"}}>{r.ck}</button> <span style={{display: "flex", alignItems: "center", gap: "8px", minWidth: "0"}}><span style={{width: "22px", height: "22px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 8.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)", flex: "none"}}>{r.ini}</span><span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.n}</span></span> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.c}</span> <span style={{font: "400 12px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{r.sess}</span> <span style={{display: "flex", alignItems: "center", gap: "6px"}}><span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{r.frac}</span><span style={{display: "inline-flex", gap: "2px"}}><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b1}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b2}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b3}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b4}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b5}}></span><span style={{width: "5px", height: "3px", borderRadius: "1px", background: r.b6}}></span></span></span> <span style={{display: "flex", gap: "4px", flexWrap: "wrap", minWidth: "0", overflow: "hidden"}}> {(r.miss ?? []).map((m, mIndex) => (<Fragment key={mIndex}> <span style={{padding: "1px 7px", borderRadius: "4px", background: "var(--pdw,#F9EDDF)", border: "1px solid var(--pdl,#EFD3B6)", font: "500 10px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)", whiteSpace: "nowrap"}}>{m.t}</span> </Fragment>))} {r.clean ? (<> <span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--ok,#0E7A5F)"}}>✓ complete</span> </>) : null} </span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: r.seenFg}}>{r.seen}</span> <span style={{justifySelf: "start", display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: r.stFg, background: r.stBg}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: r.stFg}}></span>{r.st}</span> </div> </Fragment>))} {d.empty ? (<> <div style={{padding: "40px 24px", textAlign: "center"}}> <div style={{font: "600 14px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "4px"}}>No speakers match these filters</div> <button onClick={d.clearFilters} style={{background: "none", border: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", textDecoration: "underline"}}>Clear filters</button> </div> </>) : null} <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px"}}> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.countLine}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>j / k to move · x selects · Enter opens</span> </div> </div> {d.hasSel ? (<> <div style={{position: "sticky", bottom: "16px", display: "flex", justifyContent: "center", marginTop: "16px", zIndex: "25"}}> <div style={{display: "flex", alignItems: "center", gap: "8px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", padding: "8px 10px", boxShadow: "0 12px 32px rgba(16,19,25,.16)"}}> <span style={{font: "500 12px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)", padding: "0 6px"}}>{d.selN} selected</span> <div style={{width: "1px", height: "18px", background: "var(--ln,#E1E7E9)"}}></div> <button onClick={d.bulkNudge} style={{height: "28px", padding: "0 11px", borderRadius: "999px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--pdw,#F9EDDF)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)"}}>Nudge</button> <button onClick={d.bulkLink} style={{height: "28px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Send portal link</button> <button onClick={d.bulkTask} style={{height: "28px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Assign task</button> <button onClick={d.exportCsv} style={{height: "28px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Export selected</button> <button onClick={d.clearSel} aria-label="Clear selection" style={{width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "none", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>✕</button> </div> </div> </>) : null} </div> </div> {d.open ? (<> <button onClick={d.closeDrawer} aria-label="Close" style={{position: "fixed", inset: "0", background: "rgba(13,16,32,.35)", border: "none", zIndex: "60", cursor: "default"}}></button> <div style={{position: "fixed", top: "0", right: "0", bottom: "0", width: "min(640px,94vw)", background: "var(--cd,#FFFFFF)", borderLeft: "1px solid var(--ln,#E1E7E9)", boxShadow: "0 12px 32px rgba(16,19,25,.24)", zIndex: "61", display: "flex", flexDirection: "column"}}> <div style={{padding: "18px 24px 0", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <div style={{display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px"}}> <span style={{width: "44px", height: "44px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 13px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)"}}>{d.o.ini}</span> <div style={{flex: "1", minWidth: "0"}}> <div style={{font: "600 17px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.o.n}</div> <div style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>{d.o.c} · {d.o.email}</div> </div> <Link href="/portal" style={{display: "inline-flex", alignItems: "center", height: "30px", padding: "0 12px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textDecoration: "none", whiteSpace: "nowrap"}}>Open portal as speaker</Link> <button onClick={d.closeDrawer} aria-label="Close" style={{width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "none", font: "500 14px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>✕</button> </div> <div style={{display: "flex", gap: "2px"}}> {(d.tabs ?? []).map((tb, tbIndex) => (<Fragment key={tbIndex}> <button onClick={tb.on} style={{height: "34px", padding: "0 13px", border: "none", background: "none", font: `${tb.wt} 12.5px 'IBM Plex Sans',sans-serif`, color: tb.fg, borderBottom: `2px solid ${tb.ul}`}}>{tb.n}</button> </Fragment>))} </div> </div> <div style={{flex: "1", overflowY: "auto", padding: "20px 24px"}}> {d.tabTasks ? (<> {(d.o.tasks ?? []).map((tk, tkIndex) => (<Fragment key={tkIndex}> <div style={{display: "flex", alignItems: "center", gap: "12px", border: "1px solid var(--ln,#E1E7E9)", borderLeft: `3px solid ${tk.bar}`, borderRadius: "8px", padding: "11px 14px", marginBottom: "8px"}}> <div style={{flex: "1"}}><div style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{tk.n}</div><div style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>{tk.sub}</div></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: tk.dueFg}}>{tk.due}</span> {tk.canDo ? (<> <button onClick={tk.onDone} style={{height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Mark complete</button> </>) : null} </div> </Fragment>))} </>) : null} {d.tabSessions ? (<> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderLeft: "3px solid #3E8896", borderRadius: "8px", padding: "12px 14px", marginBottom: "8px"}}> <div style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "3px"}}>{d.o.sessT}</div> <div style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{d.o.sessMeta}</div> <Link href="/admin/agenda" style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", textDecoration: "none", display: "inline-block", marginTop: "8px"}}>See it on the agenda →</Link> </div> </>) : null} {d.tabFiles ? (<> {(d.o.files ?? []).map((f, fIndex) => (<Fragment key={fIndex}> <div style={{display: "flex", alignItems: "center", gap: "12px", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "11px 14px", marginBottom: "8px"}}> <span style={{width: "28px", height: "28px", borderRadius: "6px", background: "var(--sk,#EDF1F2)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "500 9px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{f.ext}</span> <div style={{flex: "1"}}><div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{f.n}</div><div style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{f.meta}</div></div> <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--sk,#EDF1F2)", borderRadius: "99px", padding: "1px 7px", color: "var(--i3,#6B7B84)"}}>{f.v}</span> </div> </Fragment>))} {d.o.noFiles ? (<> <div style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>Nothing uploaded yet. Their portal has the drop zone.</div> </>) : null} </>) : null} {d.tabNotes ? (<> <div style={{background: "var(--pdw,#F9EDDF)", border: "1px solid var(--pdl,#EFD3B6)", borderRadius: "8px", padding: "12px 14px"}}> <div style={{font: "500 10.5px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)", marginBottom: "8px"}}>Internal. Never speaker-visible.</div> {(d.o.notes ?? []).map((nn, nnIndex) => (<Fragment key={nnIndex}> <div style={{marginBottom: "8px"}}><span style={{font: "600 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{nn.a}</span><span style={{font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{nn.t}</span><div style={{font: "400 12.5px/18px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{nn.x}</div></div> </Fragment>))} <div style={{display: "flex", gap: "6px"}}> <input aria-label="Add a note…" value={d.noteDraft} onChange={d.onNoteDraft} placeholder="Add a note…" style={{flex: "1", height: "28px", padding: "0 9px", borderRadius: "6px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--cd,#FFFFFF)", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}} /> <button onClick={d.addNote} style={{height: "28px", padding: "0 10px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 11.5px 'IBM Plex Sans',sans-serif"}}>Add note</button> </div> </div> </>) : null} </div> <div style={{flex: "none", display: "flex", alignItems: "center", gap: "8px", padding: "12px 24px", borderTop: "1px solid var(--ln,#E1E7E9)"}}> <button onClick={d.dNudge} style={{height: "30px", padding: "0 13px", borderRadius: "6px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--pdw,#F9EDDF)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)"}}>Nudge about {d.o.missN} missing items</button> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>j / k moves through the list</span> </div> </div> </>) : null} <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> {t.canUndo ? (<> <button onClick={t.onUndo} style={{background: "none", border: "none", font: "600 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", padding: "0"}}>Undo</button> </>) : null} <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
