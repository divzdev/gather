"use client";

/* GENERATED from Agenda.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type AgendaData = {
  readonly accents: readonly {
    readonly c: string;
    readonly n: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  }[];
  readonly acceptAll: (event: React.SyntheticEvent) => void;
  readonly agentOn: boolean;
  readonly aiQ: string;
  readonly aiText: React.ReactNode;
  readonly blocks: readonly {
    readonly h: string;
    readonly label: React.ReactNode;
    readonly left: string;
    readonly top: string;
    readonly w: string;
  }[];
  readonly cDay: string;
  readonly cDur: string;
  readonly cNo: string;
  readonly cRoom: string;
  readonly cSp: string;
  readonly cStart: string;
  readonly cT: string;
  readonly cWarn: React.ReactNode;
  readonly cWarnOn: boolean;
  readonly cWhen: React.ReactNode;
  readonly cards: readonly {
    readonly bd: string;
    readonly col: string;
    readonly h: string;
    readonly left: string;
    readonly onClick: (event: React.SyntheticEvent) => void;
    readonly onDown: (event: React.SyntheticEvent) => void;
    readonly op: string;
    readonly sh: string;
    readonly sp: React.ReactNode;
    readonly spDisp: string;
    readonly t: React.ReactNode;
    readonly time: React.ReactNode;
    readonly top: string;
    readonly w: string;
  }[];
  readonly chips: readonly {
    readonly onX: (event: React.SyntheticEvent) => void;
    readonly t: React.ReactNode;
  }[];
  readonly ck: React.ReactNode;
  readonly ckBd: string;
  readonly ckBg: string;
  readonly closeConf: (event: React.SyntheticEvent) => void;
  readonly closePub: (event: React.SyntheticEvent) => void;
  readonly closeUser: (event: React.SyntheticEvent) => void;
  readonly compAdd: (event: React.SyntheticEvent) => void;
  readonly compOn: boolean;
  readonly compX: (event: React.SyntheticEvent) => void;
  readonly confItems: readonly {
    readonly kind: React.ReactNode;
    readonly label: React.ReactNode;
    readonly onGoto: (event: React.SyntheticEvent) => void;
    readonly onIgnore: (event: React.SyntheticEvent) => void;
  }[];
  readonly confLabel: React.ReactNode;
  readonly confOn: boolean;
  readonly days: readonly {
    readonly bg: string;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly sh: string;
    readonly wt: string;
  }[];
  readonly dirty: React.ReactNode;
  readonly discard: (event: React.SyntheticEvent) => void;
  readonly doPub: (event: React.SyntheticEvent) => void;
  readonly drop: {
    readonly bd: string;
    readonly bg: string;
    readonly h: string;
    readonly labFg: string;
    readonly labTop: string;
    readonly label: React.ReactNode;
    readonly left: string;
    readonly top: string;
    readonly w: string;
  };
  readonly dropOn: boolean;
  readonly ghostCards: readonly {
    readonly h: string;
    readonly left: string;
    readonly onAcc: (event: React.SyntheticEvent) => void;
    readonly onRej: (event: React.SyntheticEvent) => void;
    readonly t: React.ReactNode;
    readonly time: React.ReactNode;
    readonly top: string;
    readonly w: string;
  }[];
  readonly gridDbl: (event: React.SyntheticEvent) => void;
  readonly hasChips: boolean;
  readonly hasConf: boolean;
  readonly hours: readonly {
    readonly label: React.ReactNode;
    readonly top: string;
  }[];
  readonly newSess: (event: React.SyntheticEvent) => void;
  readonly noConf: boolean;
  readonly noConfItems: boolean;
  readonly onAiQ: (event: React.SyntheticEvent) => void;
  readonly onCDay: (event: React.SyntheticEvent) => void;
  readonly onCDur: (event: React.SyntheticEvent) => void;
  readonly onCNo: (event: React.SyntheticEvent) => void;
  readonly onCRoom: (event: React.SyntheticEvent) => void;
  readonly onCSp: (event: React.SyntheticEvent) => void;
  readonly onCStart: (event: React.SyntheticEvent) => void;
  readonly onCT: (event: React.SyntheticEvent) => void;
  readonly onQ: (event: React.SyntheticEvent) => void;
  readonly openConf: (event: React.SyntheticEvent) => void;
  readonly openPub: (event: React.SyntheticEvent) => void;
  readonly popUser: boolean;
  readonly profileGo: (event: React.SyntheticEvent) => void;
  readonly pub: boolean;
  readonly pubBg: string;
  readonly pubFg: string;
  readonly pubLabel: React.ReactNode;
  readonly q: string;
  readonly ran: boolean;
  readonly ribbons: readonly {
    readonly h: string;
    readonly left: string;
    readonly top: string;
    readonly w: string;
  }[];
  readonly roomCols: readonly {
    readonly n: React.ReactNode;
  }[];
  readonly roomCount: string;
  readonly roomRules: readonly {
    readonly left: string;
  }[];
  readonly runAi: (event: React.SyntheticEvent) => void;
  readonly signOut: (event: React.SyntheticEvent) => void;
  readonly startOpts: readonly {
    readonly l: React.ReactNode;
    readonly v: string;
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
  readonly togCk: (event: React.SyntheticEvent) => void;
  readonly togTheme: (event: React.SyntheticEvent) => void;
  readonly togUser: (event: React.SyntheticEvent) => void;
  readonly trOpts: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly col: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly wt: string;
  }[];
  readonly tray: readonly {
    readonly col: string;
    readonly meta: React.ReactNode;
    readonly onDown: (event: React.SyntheticEvent) => void;
    readonly op: string;
    readonly t: React.ReactNode;
  }[];
  readonly trayEmpty: boolean;
  readonly trayN: React.ReactNode;
  readonly viewToast: (event: React.SyntheticEvent) => void;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-afadde2a:hover{border:1px solid var(--ls,#C8D2D5);border-left:3px solid {{ u.col }}}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Agenda({ d }: { d: AgendaData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Agenda builder" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Agenda" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <div style={{height: "48px", flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{display: "flex", alignItems: "center", gap: "8px", font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}><span style={{width: "7px", height: "7px", borderRadius: "50%", background: "var(--ok,#0E7A5F)"}}></span>AI Engineer 2026</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>/ Agenda · draft</span> <div style={{flex: "1"}}></div> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>drag to place · double-click adds · Delete unschedules · ⌘Z undo</span> <div style={{position: "relative"}}> <button className="dch-e45ba47f" onClick={d.togUser} title="Account" aria-label="Account menu" style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", padding: "0"}}>SW</button> {d.popUser ? (<> <button onClick={d.closeUser} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "41"}}></button> <div style={{position: "absolute", top: "36px", right: "0", width: "248px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 16px 40px rgba(13,16,32,.20)", padding: "6px", zIndex: "42"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px"}}> <span style={{width: "32px", height: "32px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 11px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>SW</span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Sasha Whitfield</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>program lead · demo org</span></span> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "8px 10px 6px"}}>THEME</div> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "0 10px 10px"}}> {(d.accents ?? []).map((ac, acIndex) => (<Fragment key={acIndex}><button onClick={ac.on} title={ac.n} aria-label={ac.n} style={{width: "16px", height: "16px", borderRadius: "50%", border: "none", background: ac.c, boxShadow: ac.ring, padding: "0", flex: "none"}}></button></Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.togTheme} title={d.themeTitle} style={{display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", borderRadius: "99px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.themeGlyph} {d.themeWord}</button> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-c4989b43" onClick={d.profileGo} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textAlign: "left"}}>Your profile</button> <Link className="dch-c4989b43" href="/admin/settings" style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "7px", textDecoration: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Workspace settings</Link> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-57a5fa4b" onClick={d.signOut} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", textAlign: "left"}}>Sign out</button> </div> </>) : null} </div> </div> <div style={{minHeight: "44px", flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "5px 14px", boxSizing: "border-box", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> {(d.days ?? []).map((d, dIndex) => (<Fragment key={dIndex}> <button onClick={d.on} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: d.bg, color: d.fg, font: `${d.wt} 12px 'IBM Plex Sans',sans-serif`, boxShadow: d.sh, whiteSpace: "nowrap"}}>{d.n}</button> </Fragment>))} </div> <div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> <button style={{height: "26px", padding: "0 11px", borderRadius: "999px", border: "none", background: "var(--cd,#FFFFFF)", color: "var(--ik,#16232B)", font: "600 12px 'IBM Plex Sans',sans-serif", boxShadow: "0 1px 2px rgba(16,19,25,.08)"}}>Grid</button> <button onClick={d.viewToast} style={{height: "26px", padding: "0 11px", borderRadius: "999px", border: "none", background: "none", color: "var(--i3,#6B7B84)", font: "500 12px 'IBM Plex Sans',sans-serif"}}>Track</button> <button onClick={d.viewToast} style={{height: "26px", padding: "0 11px", borderRadius: "999px", border: "none", background: "none", color: "var(--i3,#6B7B84)", font: "500 12px 'IBM Plex Sans',sans-serif"}}>List</button> <button onClick={d.viewToast} style={{height: "26px", padding: "0 11px", borderRadius: "999px", border: "none", background: "none", color: "var(--i3,#6B7B84)", font: "500 12px 'IBM Plex Sans',sans-serif"}}>Week</button> </div> <div style={{flex: "1"}}></div> {d.hasConf ? (<> <button onClick={d.openConf} style={{display: "inline-flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 11px", borderRadius: "6px", background: "var(--cnw,#FBE8E6)", border: "1px solid var(--cnl,#F3C7C2)", font: "600 11.5px 'IBM Plex Mono',monospace", color: "var(--cn,#D8432B)", whiteSpace: "nowrap"}}>⚠ {d.confLabel}</button> </>) : null} {d.noConf ? (<> <span style={{display: "inline-flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 11px", borderRadius: "6px", background: "var(--okw,#E2F1EC)", border: "1px solid var(--okl,#C2E0D5)", font: "600 11.5px 'IBM Plex Mono',monospace", color: "var(--ok,#0E7A5F)"}}>NO CONFLICTS</span> </>) : null} <button className="dch-c4989b43" onClick={d.newSess} style={{display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 13px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", color: "var(--ik,#16232B)", font: "500 12.5px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>+ New session</button> <button onClick={d.openPub} style={{display: "inline-flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 14px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12.5px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>Publish schedule <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "rgba(255,255,255,.22)", borderRadius: "99px", padding: "1px 6px"}}>{d.dirty}</span></button> </div> <div style={{flex: "1", display: "flex", minHeight: "0"}}> <div style={{width: "240px", flex: "none", borderRight: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)", display: "flex", flexDirection: "column", minHeight: "0"}}> <div style={{padding: "12px 14px 8px", display: "flex", alignItems: "baseline", gap: "8px"}}><span style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>UNSCHEDULED</span><span style={{font: "500 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.trayN}</span></div> <div style={{padding: "0 12px 10px"}}><input value={d.q} onChange={d.onQ} placeholder="Search the tray" style={{width: "100%", boxSizing: "border-box", height: "28px", padding: "0 9px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}} /></div> <div style={{flex: "1", overflowY: "auto", padding: "0 12px 16px", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.tray ?? []).map((u, uIndex) => (<Fragment key={uIndex}> <div className="dch-afadde2a" onMouseDown={u.onDown} style={{border: "1px solid var(--ln,#E1E7E9)", borderLeft: `3px solid ${u.col}`, borderRadius: "6px", background: "var(--cd,#FFFFFF)", padding: "9px 11px", cursor: "grab", opacity: u.op}}> <div style={{font: "500 12px/16px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{u.t}</div> <div style={{font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", marginTop: "3px"}}>{u.meta}</div> </div> </Fragment>))} {d.trayEmpty ? (<> <div style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "8px 2px"}}>Everything is placed. Drag a session here to unschedule it.</div> </>) : null} </div> </div> <div style={{flex: "1", overflow: "auto", minWidth: "0", background: "var(--pp,#F4F6F7)"}}> <div style={{position: "sticky", top: "0", zIndex: "6", display: "grid", gridTemplateColumns: `56px repeat(${d.roomCount},1fr)`, background: "var(--cd,#FFFFFF)", borderBottom: "1px solid var(--ln,#E1E7E9)", minWidth: "700px", boxSizing: "border-box"}}> <div style={{height: "32px"}}></div> {(d.roomCols ?? []).map((rc, rcIndex) => (<Fragment key={rcIndex}> <div style={{height: "32px", display: "flex", alignItems: "center", padding: "0 10px", font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i3,#6B7B84)", borderLeft: "1px solid var(--ln,#E1E7E9)"}}>{rc.n}</div> </Fragment>))} </div> <div data-agenda-grid="" onDoubleClick={d.gridDbl} style={{position: "relative", height: "720px", minWidth: "700px", boxSizing: "border-box", backgroundImage: "repeating-linear-gradient(to bottom,var(--ls,#C8D2D5) 0 1px,transparent 1px 90px),repeating-linear-gradient(to bottom,var(--ln,#E1E7E9) 0 1px,transparent 1px 45px)"}}> {(d.hours ?? []).map((h, hIndex) => (<Fragment key={hIndex}> <div style={{position: "absolute", left: "0", width: "56px", top: h.top, paddingTop: "3px", textAlign: "center", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{h.label}</div> </Fragment>))} <div style={{position: "absolute", top: "0", bottom: "0", left: "56px", width: "1px", background: "var(--ln,#E1E7E9)"}}></div> {(d.roomRules ?? []).map((rr, rrIndex) => (<Fragment key={rrIndex}> <div style={{position: "absolute", top: "0", bottom: "0", left: rr.left, width: "1px", background: "var(--ln,#E1E7E9)"}}></div> </Fragment>))} {(d.blocks ?? []).map((bk, bkIndex) => (<Fragment key={bkIndex}> <div style={{position: "absolute", left: bk.left, right: "0", width: bk.w, top: bk.top, height: bk.h, background: "var(--sk,#EDF1F2)", borderTop: "1px solid var(--ln,#E1E7E9)", borderBottom: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)"}}>{bk.label}</div> </Fragment>))} {(d.ribbons ?? []).map((rb, rbIndex) => (<Fragment key={rbIndex}> <div style={{position: "absolute", left: rb.left, width: rb.w, top: rb.top, height: rb.h, background: "repeating-linear-gradient(-45deg,rgba(216,67,43,.13) 0 6px,rgba(216,67,43,.04) 6px 12px)", borderTop: "2px solid var(--cn,#D8432B)", borderBottom: "2px solid var(--cn,#D8432B)", pointerEvents: "none", zIndex: "1"}}></div> </Fragment>))} {(d.cards ?? []).map((c, cIndex) => (<Fragment key={cIndex}> <div onMouseDown={c.onDown} onClick={c.onClick} style={{position: "absolute", left: c.left, width: c.w, top: c.top, height: c.h, borderRadius: "8px", background: "var(--cd,#FFFFFF)", border: c.bd, borderLeft: `3px solid ${c.col}`, boxShadow: c.sh, padding: "5px 9px", cursor: "grab", overflow: "hidden", boxSizing: "border-box", opacity: c.op, zIndex: "2"}}> <div style={{font: "400 10px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>{c.time}</div> <div style={{font: "500 12px/15px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{c.t}</div> <div style={{display: c.spDisp, font: "400 10.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", whiteSpace: "nowrap"}}>{c.sp}</div> </div> </Fragment>))} {(d.ghostCards ?? []).map((g, gIndex) => (<Fragment key={gIndex}> <div style={{position: "absolute", left: g.left, width: g.w, top: g.top, height: g.h, borderRadius: "6px", border: "1.5px dashed var(--sg,#E04E4E)", background: "var(--sw,#FFEAE6)", padding: "5px 9px", boxSizing: "border-box", overflow: "hidden", zIndex: "4"}}> <div style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: "var(--sg,#E04E4E)", whiteSpace: "nowrap"}}>✦ {g.time}</div> <div style={{font: "500 11.5px/14px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{g.t}</div> <div style={{display: "flex", gap: "5px", marginTop: "4px"}}> <button onClick={g.onAcc} style={{height: "20px", padding: "0 9px", borderRadius: "4px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 10.5px 'IBM Plex Sans',sans-serif"}}>Accept</button> <button onClick={g.onRej} style={{height: "20px", padding: "0 9px", borderRadius: "4px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", color: "var(--i2,#3E4E58)", font: "500 10.5px 'IBM Plex Sans',sans-serif"}}>Reject</button> </div> </div> </Fragment>))} {d.dropOn ? (<> <div style={{position: "absolute", left: d.drop.left, width: d.drop.w, top: d.drop.top, height: d.drop.h, borderRadius: "6px", background: d.drop.bg, border: `1.5px dashed ${d.drop.bd}`, boxSizing: "border-box", pointerEvents: "none", zIndex: "5"}}></div> <div style={{position: "absolute", left: d.drop.left, top: d.drop.labTop, padding: "2px 8px", borderRadius: "4px", background: "var(--cd,#FFFFFF)", border: `1px solid ${d.drop.bd}`, font: "500 10px 'IBM Plex Mono',monospace", color: d.drop.labFg, whiteSpace: "nowrap", pointerEvents: "none", zIndex: "5", boxShadow: "0 2px 6px rgba(16,19,25,.12)"}}>{d.drop.label}</div> </>) : null} </div> </div> <div style={{width: "280px", flex: "none", borderLeft: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)", display: "flex", flexDirection: "column", minHeight: "0"}}> {d.agentOn ? (<> <div style={{padding: "14px 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", gap: "8px"}}><span style={{font: "500 12px 'IBM Plex Mono',monospace", color: "var(--sg,#E04E4E)"}}>✦</span><span style={{font: "600 12px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i2,#3E4E58)"}}>SCHEDULE AGENT</span></div> <div style={{padding: "14px 16px", overflowY: "auto", flex: "1"}}> <textarea value={d.aiQ} onChange={d.onAiQ} rows={4} placeholder="Keep Petrova's two sessions on different days. Put beginner content in the morning. Leave 16:00 free on day 2." style={{width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px/18px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", resize: "vertical", outlineColor: "#E04E4E"}}></textarea> {d.hasChips ? (<> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", margin: "12px 0 6px"}}>UNDERSTOOD AS</div> <div style={{display: "flex", flexWrap: "wrap", gap: "5px"}}> {(d.chips ?? []).map((ch, chIndex) => (<Fragment key={chIndex}> <button onClick={ch.onX} title="Remove this constraint" style={{display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 9px", borderRadius: "99px", background: "var(--sw,#FFEAE6)", border: "1px solid var(--sl,#FFC9C0)", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", textAlign: "left"}}>{ch.t} ✕</button> </Fragment>))} </div> </>) : null} <button onClick={d.runAi} style={{marginTop: "12px", width: "100%", height: "32px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12.5px 'IBM Plex Sans',sans-serif"}}>Draft the empty slots</button> {d.ran ? (<> <div style={{marginTop: "14px", border: "1px solid var(--sl,#FFC9C0)", background: "var(--sw,#FFEAE6)", borderRadius: "8px", padding: "12px 13px"}}> <div style={{font: "500 11px 'IBM Plex Mono',monospace", color: "var(--sg,#E04E4E)", marginBottom: "7px"}}>✦ PROPOSED · 3 PLACEMENTS</div> <div style={{font: "400 12px/18px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "pre-line"}}>{d.aiText}</div> <div style={{display: "flex", gap: "7px", marginTop: "11px"}}> <button onClick={d.acceptAll} style={{height: "28px", padding: "0 12px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12px 'IBM Plex Sans',sans-serif"}}>Accept all</button> <button onClick={d.discard} style={{height: "28px", padding: "0 12px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", color: "var(--i2,#3E4E58)", font: "500 12px 'IBM Plex Sans',sans-serif"}}>Discard</button> </div> </div> <div style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", marginTop: "9px"}}>Ghost cards on the grid accept one by one. Accepting is a single undo.</div> </>) : null} </div> </>) : null} {d.confOn ? (<> <div style={{padding: "14px 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", gap: "8px"}}> <span style={{font: "600 12px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--cn,#D8432B)", flex: "1"}}>CONFLICT INSPECTOR</span> <button onClick={d.closeConf} style={{background: "none", border: "none", font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>✕</button> </div> <div style={{padding: "12px 16px", overflowY: "auto", flex: "1", display: "flex", flexDirection: "column", gap: "10px"}}> {(d.confItems ?? []).map((cf, cfIndex) => (<Fragment key={cfIndex}> <div style={{border: "1px solid var(--cnl,#F3C7C2)", borderRadius: "8px", padding: "11px 12px", background: "var(--cd,#FFFFFF)"}}> <div style={{font: "500 11px 'IBM Plex Mono',monospace", color: "var(--cn,#D8432B)", marginBottom: "4px"}}>{cf.kind}</div> <div style={{font: "400 12.5px/18px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{cf.label}</div> <div style={{display: "flex", gap: "6px", marginTop: "9px"}}> <button onClick={cf.onGoto} style={{height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Select</button> <button onClick={cf.onIgnore} style={{height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Ignore</button> </div> </div> </Fragment>))} {d.noConfItems ? (<> <div style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ok,#0E7A5F)"}}>Nothing broken. Every placement is clean.</div> </>) : null} </div> </>) : null} </div> </div> </div> {d.pub ? (<> <button onClick={d.closePub} aria-label="Close" style={{position: "fixed", inset: "0", background: "rgba(13,16,32,.4)", border: "none", zIndex: "70", cursor: "default"}}></button> <div style={{position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "440px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "10px", boxShadow: "0 12px 32px rgba(16,19,25,.24)", zIndex: "71", padding: "20px 22px"}}> <div style={{font: "600 16px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "8px"}}>Publish schedule</div> <div style={{font: "400 13px/19px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "14px"}}>This publishes <span style={{font: "500 12px 'IBM Plex Mono',monospace"}}>{d.dirty}</span> unpublished changes to the public schedule, the embeds, and Accelevents. 7 speakers have changed times and receive an updated calendar invite.</div> <button onClick={d.togCk} style={{display: "flex", alignItems: "center", gap: "9px", background: "none", border: "none", padding: "0", marginBottom: "16px", textAlign: "left"}}> <span style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${d.ckBd}`, background: d.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", flex: "none"}}>{d.ck}</span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>I have reviewed the change list and the notification recipients</span> </button> <div style={{display: "flex", justifyContent: "space-between"}}> <button onClick={d.closePub} style={{height: "32px", padding: "0 13px", borderRadius: "6px", border: "none", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>Cancel</button> <button onClick={d.doPub} style={{height: "32px", padding: "0 15px", borderRadius: "6px", border: "none", background: d.pubBg, color: d.pubFg, font: "600 12.5px 'IBM Plex Sans',sans-serif"}}>{d.pubLabel}</button> </div> </div> </>) : null} {d.compOn ? (<> <button onClick={d.compX} aria-label="Close" style={{position: "fixed", inset: "0", background: "rgba(20,17,12,.32)", border: "none", zIndex: "70", cursor: "default"}}></button> <div style={{position: "fixed", top: "0", right: "0", bottom: "0", width: "min(600px,94vw)", background: "var(--cd,#FFFFFF)", borderLeft: "1px solid var(--ln,#E1E7E9)", boxShadow: "0 12px 32px rgba(16,19,25,.24)", zIndex: "71", display: "flex", flexDirection: "column"}}> <div style={{padding: "18px 24px 14px", borderBottom: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", gap: "10px"}}> <span style={{font: "600 19px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.01em", color: "var(--ik,#16232B)", flex: "1"}}>New session</span> <span style={{font: "500 10px 'IBM Plex Mono',monospace", letterSpacing: "0.06em", color: "var(--i4,#99A6AD)"}}>DRAFT · NOT PUBLISHED</span> <button className="dch-c4989b43" onClick={d.compX} aria-label="Close" style={{width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "none", font: "500 14px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>✕</button> </div> <div style={{flex: "1", overflowY: "auto", padding: "20px 24px"}}> <div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Title</div> <input value={d.cT} onChange={d.onCT} placeholder="e.g. Serving LLMs on spot fleets" style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 12px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E", marginBottom: "14px"}} /> <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px"}}> <div><div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Speaker</div><input value={d.cSp} onChange={d.onCSp} placeholder="Name, or TBC" style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}} /></div> <div><div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Day</div><select value={d.cDay} onChange={d.onCDay} style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}}><option value="1">Day 1 · Mon 12 Oct</option><option value="2">Day 2 · Tue 13 Oct</option><option value="3">Day 3 · Wed 14 Oct</option></select></div> </div> <div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Track</div> <div style={{display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "5px"}}> {(d.trOpts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <button className="dch-c4989b43" onClick={t.on} style={{display: "inline-flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 11px", borderRadius: "999px", border: `1px solid ${t.bd}`, background: t.bg, font: `${t.wt} 12px 'IBM Plex Sans',sans-serif`, color: "var(--ik,#16232B)"}}><span style={{width: "9px", height: "9px", borderRadius: "3px", background: t.col, flex: "none"}}></span>{t.n}</button> </Fragment>))} </div> <div style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", marginBottom: "14px"}}>The track sets the card color on the agenda and the public schedule.</div> <div style={{display: "grid", gridTemplateColumns: "1.2fr 1fr 1.2fr", gap: "12px", marginBottom: "14px"}}> <div><div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Room</div><select value={d.cRoom} onChange={d.onCRoom} style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}}><option value="0">Main stage</option><option value="1">Room 2</option><option value="2">Room 3</option><option value="3">Workshop lab</option></select></div> <div><div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Starts</div><select value={d.cStart} onChange={d.onCStart} style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}}>{(d.startOpts ?? []).map((so, soIndex) => (<Fragment key={soIndex}><option value={so.v}>{so.l}</option></Fragment>))}</select></div> <div><div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Length</div><select value={d.cDur} onChange={d.onCDur} style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E"}}><option value="10">10 min · lightning</option><option value="15">15 min</option><option value="30">30 min · talk</option><option value="45">45 min · keynote</option><option value="60">60 min · panel</option><option value="90">90 min · workshop</option></select></div> </div> <div style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Notes for the run of show</div> <textarea value={d.cNo} onChange={d.onCNo} rows={3} placeholder="AV needs, intro notes, anything the day-of team should know" style={{width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px/18px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", resize: "vertical", outlineColor: "#E04E4E"}}></textarea> {d.cWarnOn ? (<> <div style={{display: "flex", alignItems: "flex-start", gap: "8px", background: "var(--cnw,#FBE8E6)", border: "1px solid var(--cnl,#F3C7C2)", borderRadius: "8px", padding: "9px 12px", marginTop: "12px"}}> <span style={{font: "600 11px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)"}}>⚠</span> <span style={{font: "400 11.5px/16px 'IBM Plex Mono',monospace", color: "var(--cn,#D8432B)"}}>{d.cWarn} · you can still add it</span> </div> </>) : null} </div> <div style={{flex: "none", display: "flex", alignItems: "center", gap: "8px", padding: "12px 24px", borderTop: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", flex: "1", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{d.cWhen}</span> <button className="dch-c4989b43" onClick={d.compX} style={{height: "36px", padding: "0 15px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Cancel</button> <button onClick={d.compAdd} style={{height: "36px", padding: "0 18px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 13px 'IBM Plex Sans',sans-serif"}}>Add to agenda</button> </div> </div> </>) : null} <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> {t.canUndo ? (<> <button onClick={t.onUndo} style={{background: "none", border: "none", font: "600 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)", padding: "0"}}>Undo</button> </>) : null} <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
