"use client";

/* GENERATED from Embeds.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type PublishingData = {
  /** the event's own public page. The prototype hard-coded the demo's slug. */
  readonly publicHref: string;
  /** Hand-bound slot. This design is the embed builder end to end; snapshot
   *  history had nowhere to render, and rendering it outside the shell put it
   *  past a 100vh scroll container where nobody could reach it. */
  readonly aside: React.ReactNode;
  readonly codeText: React.ReactNode;
  readonly copyCode: (event: React.SyntheticEvent) => void;
  readonly dD: {
    readonly bg: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly dM: {
    readonly bg: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly day: string;
  readonly devDesk: (event: React.SyntheticEvent) => void;
  readonly devMob: (event: React.SyntheticEvent) => void;
  readonly isSchedule: boolean;
  readonly isSpeakers: boolean;
  readonly onDay: (event: React.SyntheticEvent) => void;
  readonly pvCard: string;
  readonly pvCols: string;
  readonly pvCount: React.ReactNode;
  readonly pvInk: string;
  readonly pvLn: string;
  readonly pvMut: string;
  readonly pvPage: string;
  readonly pvRows: readonly {
    readonly col: string;
    readonly room: React.ReactNode;
    readonly sp: React.ReactNode;
    readonly t: React.ReactNode;
    readonly time: React.ReactNode;
  }[];
  readonly pvSpeakers: readonly {
    readonly c: React.ReactNode;
    readonly ini: React.ReactNode;
    readonly n: React.ReactNode;
  }[];
  readonly pvSub: React.ReactNode;
  readonly pvSunk: string;
  readonly pvTitle: React.ReactNode;
  readonly pvW: string;
  readonly search: boolean;
  readonly searchSwBg: string;
  readonly searchSwX: string;
  readonly themes: readonly {
    readonly bg: string;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly sh: string;
    readonly wt: string;
  }[];
  readonly toasts: readonly {
    readonly msg: React.ReactNode;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togSearch: (event: React.SyntheticEvent) => void;
  readonly trackChips: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly widgets: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Publishing({ d }: { d: PublishingData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Publishing embeds" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Publishing" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <ConsoleHeader /> <div style={{flex: "1", overflowY: "auto", padding: "20px 28px 80px"}}> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px"}}> <h1 style={{font: "600 30px/1.15 'IBM Plex Sans',sans-serif", letterSpacing: "-0.02em", color: "var(--ik,#16232B)", margin: "0"}}>Publishing</h1> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>embeds · one script tag · under 40KB · always current</span>  <div style={{display: "flex", alignItems: "center", gap: "8px", flex: "none", alignSelf: "center", marginLeft: "auto"}}><Link href={d.publicHref as never} style={{display: "inline-flex", alignItems: "center", height: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textDecoration: "none", whiteSpace: "nowrap", background: "var(--cd,#FFFFFF)"}}>View public page</Link></div> </div> <div style={{display: "grid", gridTemplateColumns: "minmax(280px,380px) minmax(0,1fr)", gap: "16px", alignItems: "start"}}> <div style={{display: "flex", flexDirection: "column", gap: "12px"}}> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "9px"}}>WIDGET</div> <div style={{display: "flex", gap: "6px", flexWrap: "wrap"}}> {(d.widgets ?? []).map((w, wIndex) => (<Fragment key={wIndex}> <button onClick={w.on} style={{height: "36px", padding: "0 12px", borderRadius: "999px", border: `1px solid ${w.bd}`, background: w.bg, font: "500 12px 'IBM Plex Sans',sans-serif", color: w.fg, whiteSpace: "nowrap"}}>{w.n}</button> </Fragment>))} </div> </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)"}}>OPTIONS</div> <div style={{display: "flex", alignItems: "center", gap: "10px"}}> <span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", width: "64px"}}>Theme</span> <div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> {(d.themes ?? []).map((tm, tmIndex) => (<Fragment key={tmIndex}> <button onClick={tm.on} style={{height: "36px", padding: "0 11px", borderRadius: "999px", border: "none", background: tm.bg, color: tm.fg, font: `${tm.wt} 11.5px 'IBM Plex Sans',sans-serif`, boxShadow: tm.sh}}>{tm.n}</button> </Fragment>))} </div> </div> {d.isSchedule ? (<> <div style={{display: "flex", alignItems: "center", gap: "10px"}}> <span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", width: "64px"}}>Day</span> <select value={d.day} onChange={d.onDay} style={{flex: "1", boxSizing: "border-box", height: "40px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "var(--sg, #E04E4E)"}}> <option>All days</option><option>Day 1 · Mon 12 Oct</option><option>Day 2 · Tue 13 Oct</option><option>Day 3 · Wed 14 Oct</option> </select> </div> </>) : null} <div> <div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "6px"}}>Tracks</div> <div style={{display: "flex", gap: "5px", flexWrap: "wrap"}}> {(d.trackChips ?? []).map((tc, tcIndex) => (<Fragment key={tcIndex}> <button onClick={tc.on} style={{height: "36px", padding: "0 10px", borderRadius: "999px", border: `1px solid ${tc.bd}`, background: tc.bg, font: "500 11px 'IBM Plex Sans',sans-serif", color: tc.fg, whiteSpace: "nowrap"}}>{tc.n}</button> </Fragment>))} </div> </div> <button onClick={d.togSearch} style={{display: "flex", alignItems: "center", gap: "9px", minHeight: "44px", background: "none", border: "none", padding: "0", textAlign: "left"}}> <span style={{width: "34px", height: "20px", borderRadius: "99px", background: d.searchSwBg, position: "relative", flex: "none", display: "inline-block", transition: "background .15s"}}><span style={{position: "absolute", top: "2px", left: d.searchSwX, width: "16px", height: "16px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(13,16,32,.2)", transition: "left .15s"}}></span></span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Search box inside the widget</span> </button> </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px"}}> <div style={{display: "flex", alignItems: "center", marginBottom: "8px"}}> <span style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", flex: "1"}}>EMBED CODE</span> <button onClick={d.copyCode} style={{height: "36px", padding: "0 11px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 11.5px 'IBM Plex Sans',sans-serif"}}>Copy code</button> </div> <div style={{borderRadius: "8px", background: "#0D1020", border: "1px solid var(--ln,#E1E7E9)", padding: "12px 14px", font: "400 11.5px/18px 'IBM Plex Mono',monospace", overflowX: "auto", color: "#B8BED6", whiteSpace: "pre-wrap"}}>{d.codeText}</div> <div style={{font: "400 11.5px/17px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", marginTop: "8px"}}>Deep-link any card with a URL parameter, for example ?session-id=S-102. The widget scrolls to it and opens the detail.</div> </div> </div> {d.aside} <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", overflow: "hidden"}}> <div style={{display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--sk,#EDF1F2)"}}> <span style={{width: "9px", height: "9px", borderRadius: "50%", background: "var(--ls,#C8D2D5)"}}></span><span style={{width: "9px", height: "9px", borderRadius: "50%", background: "var(--ls,#C8D2D5)"}}></span><span style={{width: "9px", height: "9px", borderRadius: "50%", background: "var(--ls,#C8D2D5)"}}></span> <span style={{flex: "1", textAlign: "center", font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>yourconference.com/schedule · live preview</span> <div style={{display: "flex", gap: "2px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> <button onClick={d.devDesk} style={{height: "36px", padding: "0 9px", borderRadius: "999px", border: "none", background: d.dD.bg, color: d.dD.fg, font: `${d.dD.wt} 10.5px 'IBM Plex Sans',sans-serif`}}>Desktop</button> <button onClick={d.devMob} style={{height: "36px", padding: "0 9px", borderRadius: "999px", border: "none", background: d.dM.bg, color: d.dM.fg, font: `${d.dM.wt} 10.5px 'IBM Plex Sans',sans-serif`}}>Mobile</button> </div> </div> <div style={{padding: "20px", background: d.pvPage, display: "flex", justifyContent: "center"}}> <div style={{width: d.pvW, maxWidth: "100%", transition: "width .2s"}}> <div style={{border: `1px solid ${d.pvLn}`, borderRadius: "10px", background: d.pvCard, overflow: "hidden"}}> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "11px 14px", borderBottom: `1px solid ${d.pvLn}`}}> <span style={{font: "600 12.5px 'IBM Plex Sans',sans-serif", color: d.pvInk}}>{d.pvTitle}</span> <span style={{font: "400 10px 'IBM Plex Mono',monospace", color: d.pvMut}}>{d.pvSub}</span> <div style={{flex: "1"}}></div> {d.search ? (<> <span style={{display: "inline-flex", alignItems: "center", height: "22px", padding: "0 9px", borderRadius: "999px", background: d.pvSunk, font: "400 10px 'IBM Plex Sans',sans-serif", color: d.pvMut}}>Search…</span> </>) : null} </div> {d.isSchedule ? (<> {(d.pvRows ?? []).map((r, rIndex) => (<Fragment key={rIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", borderBottom: `1px solid ${d.pvLn}`}}> <span style={{font: "400 10px 'IBM Plex Mono',monospace", color: d.pvMut, width: "64px", flex: "none"}}>{r.time}</span> <span style={{width: "3px", height: "22px", borderRadius: "2px", background: r.col, flex: "none"}}></span> <span style={{flex: "1", minWidth: "0"}}><span style={{display: "block", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: d.pvInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{r.t}</span><span style={{display: "block", font: "400 10px 'IBM Plex Sans',sans-serif", color: d.pvMut}}>{r.sp}</span></span> <span style={{font: "400 9.5px 'IBM Plex Mono',monospace", color: d.pvMut, whiteSpace: "nowrap"}}>{r.room}</span> </div> </Fragment>))} </>) : null} {d.isSpeakers ? (<> <div style={{display: "grid", gridTemplateColumns: `repeat(${d.pvCols},1fr)`, gap: "10px", padding: "14px"}}> {(d.pvSpeakers ?? []).map((sp, spIndex) => (<Fragment key={spIndex}> <div style={{border: `1px solid ${d.pvLn}`, borderRadius: "8px", padding: "10px", textAlign: "center"}}> <span style={{display: "inline-flex", width: "34px", height: "34px", borderRadius: "50%", background: d.pvSunk, alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: d.pvMut, marginBottom: "6px"}}>{sp.ini}</span> <span style={{display: "block", font: "500 11px 'IBM Plex Sans',sans-serif", color: d.pvInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{sp.n}</span> <span style={{display: "block", font: "400 9.5px 'IBM Plex Sans',sans-serif", color: d.pvMut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{sp.c}</span> </div> </Fragment>))} </div> </>) : null} <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px"}}> <span style={{font: "400 9.5px 'IBM Plex Mono',monospace", color: d.pvMut}}>{d.pvCount}</span> <span style={{display: "inline-flex", alignItems: "center", gap: "4px", font: "400 9px 'IBM Plex Mono',monospace", color: d.pvMut}}><svg width="9" height="9" viewBox="0 0 24 24"><rect width="24" height="24" rx="6.5" fill="#12142E"></rect><circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B"></circle><circle cx="6.3" cy="6.3" r="2.3" fill="#EBEDF7"></circle><circle cx="14.4" cy="5.4" r="1.5" fill="#EBEDF7"></circle><circle cx="5.4" cy="14.4" r="1.5" fill="#EBEDF7"></circle></svg>Runs on Gather</span> </div> </div> <div style={{font: "400 10.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", textAlign: "center", marginTop: "9px"}}>Updates the moment you publish. Visitors never see a stale schedule.</div> </div> </div> </div> </div> </div> </div> <div style={{position: "fixed", right: "20px", bottom: "20px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--sg,#E04E4E)", borderLeft: "4px solid var(--sg,#E04E4E)", borderRadius: "10px", padding: "12px 14px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> <button onClick={t.onX} aria-label="Dismiss" style={{display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "var(--control-h-sm, 36px)", minHeight: "var(--control-h-sm, 36px)", background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
