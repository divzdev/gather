"use client";

/* GENERATED from Evaluations.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { EventSwitcher } from "@/components/console/EventSwitcher";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type EvaluationsData = {
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
  readonly closeUser: (event: React.SyntheticEvent) => void;
  readonly closesLine: React.ReactNode;
  readonly coverage: React.ReactNode;
  readonly createRound: (event: React.SyntheticEvent) => void;
  readonly eB: {
    readonly bg: string;
    readonly fg: string;
    readonly sh: string;
    readonly wt: string;
  };
  readonly evals: readonly {
    readonly bias: React.ReactNode;
    readonly biasFg: string;
    readonly fill: string;
    readonly frac: React.ReactNode;
    readonly ini: React.ReactNode;
    readonly n: React.ReactNode;
    readonly onNudge: (event: React.SyntheticEvent) => void;
    readonly pace: React.ReactNode;
    readonly paceBg: string;
    readonly paceFg: string;
    readonly w: string;
  }[];
  readonly evalsFrac: React.ReactNode;
  readonly evaluatorCount: React.ReactNode;
  readonly medianScore: React.ReactNode;
  readonly newBlindLabel: React.ReactNode;
  readonly newName: string;
  readonly newPlan: (event: React.SyntheticEvent) => void;
  readonly notStartedLine: React.ReactNode;
  readonly onEval: boolean;
  readonly onNewName: (event: React.SyntheticEvent) => void;
  readonly onPlans: boolean;
  readonly pB: {
    readonly bg: string;
    readonly fg: string;
    readonly sh: string;
    readonly wt: string;
  };
  readonly plansNote: React.ReactNode;
  readonly popUser: boolean;
  readonly profileGo: (event: React.SyntheticEvent) => void;
  readonly rounds: readonly {
    readonly blindD: string;
    readonly blindLabel: React.ReactNode;
    readonly crits: React.ReactNode;
    readonly done: React.ReactNode;
    readonly evals: React.ReactNode;
    readonly meta: React.ReactNode;
    readonly name: React.ReactNode;
    readonly onAdvance: (event: React.SyntheticEvent) => void;
    readonly onAssign: (event: React.SyntheticEvent) => void;
    readonly onBlind: (event: React.SyntheticEvent) => void;
    readonly onNudge: (event: React.SyntheticEvent) => void;
    readonly progW: string;
    readonly stBg: string;
    readonly stFg: string;
    readonly stLabel: React.ReactNode;
    readonly subs: React.ReactNode;
    readonly total: React.ReactNode;
  }[];
  readonly signOut: (event: React.SyntheticEvent) => void;
  readonly soBias: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly soDone: {
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
  readonly soPace: {
    readonly fg: string;
    readonly g: React.ReactNode;
    readonly gc: string;
    readonly on: (event: React.SyntheticEvent) => void;
  };
  readonly sumLine: React.ReactNode;
  readonly tBehind: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tDoneE: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tEvalsT: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tPlans: {
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
    readonly msg: React.ReactNode;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togNewBlind: (event: React.SyntheticEvent) => void;
  readonly togTheme: (event: React.SyntheticEvent) => void;
  readonly togUser: (event: React.SyntheticEvent) => void;
  readonly vEval: (event: React.SyntheticEvent) => void;
  readonly vPlans: (event: React.SyntheticEvent) => void;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}
.dch-f129dbea:hover{color:var(--ik,#16232B)}`;

export function Evaluations({ d }: { d: EvaluationsData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Evaluation plans" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Review" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <div style={{height: "48px", flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <EventSwitcher /> <Link href="/review" style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", textDecoration: "none", whiteSpace: "nowrap"}}>‹ Review queue</Link> <span style={{font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap"}}>Evaluation plans</span> <div style={{flex: "1"}}></div> <button onClick={d.newPlan} style={{height: "32px", padding: "0 15px", borderRadius: "999px", border: "none", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12.5px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>New plan</button> <div style={{position: "relative"}}> <button className="dch-e45ba47f" onClick={d.togUser} title="Account" aria-label="Account menu" style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", padding: "0"}}>{d.youInitials}</button> {d.popUser ? (<> <button onClick={d.closeUser} aria-label="Close" style={{position: "fixed", inset: "0", background: "none", border: "none", cursor: "default", zIndex: "41"}}></button> <div style={{position: "absolute", top: "36px", right: "0", width: "248px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", boxShadow: "0 16px 40px rgba(13,16,32,.20)", padding: "6px", zIndex: "42"}}> <div style={{display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px"}}> <span style={{width: "32px", height: "32px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 11px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>{d.youInitials}</span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{d.youName}</span><span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.youRole} · {d.youOrg}</span></span> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <div style={{font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "8px 10px 6px"}}>THEME</div> <div style={{display: "flex", alignItems: "center", gap: "8px", padding: "0 10px 10px"}}> {(d.accents ?? []).map((ac, acIndex) => (<Fragment key={acIndex}><button onClick={ac.on} title={ac.n} aria-label={ac.n} style={{width: "16px", height: "16px", borderRadius: "50%", border: "none", background: ac.c, boxShadow: ac.ring, padding: "0", flex: "none"}}></button></Fragment>))} <div style={{flex: "1"}}></div> <button className="dch-c4989b43" onClick={d.togTheme} title={d.themeTitle} style={{display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", borderRadius: "99px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.themeGlyph} {d.themeWord}</button> </div> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-c4989b43" onClick={d.profileGo} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", textAlign: "left"}}>Your profile</button> <Link className="dch-c4989b43" href="/admin/settings" style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "7px", textDecoration: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Event settings</Link> <div style={{height: "1px", background: "var(--ln,#E1E7E9)", margin: "4px 6px"}}></div> <button className="dch-57a5fa4b" onClick={d.signOut} style={{display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "8px 10px", borderRadius: "7px", border: "none", background: "none", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", textAlign: "left"}}>Sign out</button> </div> </>) : null} </div> </div> <div style={{height: "32px", flex: "none", display: "flex", alignItems: "center", gap: "16px", overflowX: "auto", padding: "0 20px", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)"}}> <span style={{font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--ik,#16232B)"}}>COVERAGE {d.coverage}</span><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)"}}>EVALS {d.evalsFrac}</span><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <span style={{font: "500 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--i3,#6B7B84)"}}>MEDIAN {d.medianScore}</span><span style={{color: "var(--i4,#99A6AD)"}}>·</span> <span style={{font: "600 10.5px 'IBM Plex Mono',monospace", letterSpacing: "0.05em", whiteSpace: "nowrap", color: "var(--pd,#B96A1F)"}}>{d.notStartedLine}</span> <div style={{flex: "1"}}></div> <span style={{font: "400 10.5px 'IBM Plex Mono',monospace", whiteSpace: "nowrap", color: "var(--i4,#99A6AD)"}}>{d.closesLine}</span> </div> <div style={{flex: "1", overflowY: "auto", padding: "20px 28px 80px"}}> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 24px 'IBM Plex Sans',sans-serif", letterSpacing: "-0.015em", color: "var(--ik,#16232B)", margin: "0"}}>Evaluation plans</h1> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>who scores what, by when, under which rules</span> <div style={{flex: "1"}}></div> <div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px"}}> <button onClick={d.vPlans} style={{height: "26px", padding: "0 13px", borderRadius: "999px", border: "none", background: d.pB.bg, color: d.pB.fg, font: `${d.pB.wt} 12px 'IBM Plex Sans',sans-serif`, boxShadow: d.pB.sh}}>Plans</button> <button onClick={d.vEval} style={{height: "26px", padding: "0 13px", borderRadius: "999px", border: "none", background: d.eB.bg, color: d.eB.fg, font: `${d.eB.wt} 12px 'IBM Plex Sans',sans-serif`, boxShadow: d.eB.sh}}>Evaluators</button> </div> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>{d.sumLine}</div> <div style={{display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: "12px", marginBottom: "16px"}}> <button onClick={d.tPlans.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tPlans.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tPlans.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--ifw,#E9ECF7)", color: "var(--if,#47599F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 1.5h4.8l2.7 2.7v9.3H4z"></path><path d="M8.8 1.5v2.7h2.7"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tPlans.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tPlans.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Review plans</span></span> </button> <button onClick={d.tEvalsT.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tEvalsT.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tEvalsT.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--sw,#FFEAE6)", color: "var(--sg,#E04E4E)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="4.8" r="2.5"></circle><path d="M2.8 12.8c.6-2.5 2.4-3.9 4.7-3.9s4.1 1.4 4.7 3.9"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tEvalsT.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tEvalsT.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Evaluators</span></span> </button> <button onClick={d.tBehind.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tBehind.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tBehind.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M7.5 4.3v3.4l2.3 1.4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tBehind.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tBehind.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Need a nudge</span></span> </button> <button onClick={d.tDoneE.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tDoneE.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tDoneE.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--okw,#E2F1EC)", color: "var(--ok,#0E7A5F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M4.8 7.8l1.8 1.8 3.6-4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tDoneE.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tDoneE.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Reviews in</span></span> </button> </div> {d.onPlans ? (<> <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: "14px"}}> {(d.rounds ?? []).map((r, rIndex) => (<Fragment key={rIndex}> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "12px", background: "linear-gradient(120deg,var(--sw,#FFEAE6) 0%,var(--cd,#FFFFFF) 55%)", boxShadow: "0 1px 2px rgba(13,16,32,.03)", padding: "18px 20px"}}> <div style={{display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px"}}> <span style={{font: "600 15px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.name}</span> <span style={{display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: r.stFg, background: r.stBg}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: r.stFg}}></span>{r.stLabel}</span> <span style={{alignItems: "center", padding: "2px 8px", borderRadius: "4px", font: "500 10.5px 'IBM Plex Mono',monospace", color: "var(--if,#47599F)", background: "var(--ifw,#E9ECF7)", display: r.blindD}}>BLIND</span> </div> <div style={{font: "400 12px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)", marginBottom: "14px"}}>{r.meta}</div> <div style={{display: "flex", gap: "20px", marginBottom: "12px"}}> <span><span style={{display: "block", font: "600 20px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.subs}</span><span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>submissions</span></span> <span><span style={{display: "block", font: "600 20px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.evals}</span><span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>evaluators</span></span> <span><span style={{display: "block", font: "600 20px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.done}<span style={{font: "400 13px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>/{r.total}</span></span><span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>evals done</span></span> <span><span style={{display: "block", font: "600 20px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{r.crits}</span><span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>criteria</span></span> </div> <div style={{height: "5px", borderRadius: "3px", background: "var(--ln,#E1E7E9)", marginBottom: "14px"}}><div style={{width: r.progW, height: "5px", borderRadius: "3px", background: "var(--bt,#FF6B6B)"}}></div></div> <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}> <button onClick={r.onAssign} style={{display: "inline-flex", alignItems: "center", height: "32px", padding: "0 15px", borderRadius: "999px", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12.5px 'IBM Plex Sans',sans-serif", textDecoration: "none", border: "none"}}>Assign reviewers</button> <button onClick={r.onNudge} style={{height: "32px", padding: "0 13px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Nudge</button> <button onClick={r.onBlind} style={{height: "32px", padding: "0 13px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{r.blindLabel}</button> <button onClick={r.onAdvance} style={{height: "32px", padding: "0 13px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Advance</button> </div> </div> </Fragment>))} <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "18px 20px"}}> <div style={{font: "600 15px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", marginBottom: "4px"}}>New review round</div> <div style={{font: "400 12px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)", marginBottom: "14px"}}>Each round has its own name, its own rubric, and its own reviewers.</div> <input aria-label="Round 2 · Program fit" value={d.newName} onChange={d.onNewName} placeholder="Round 2 · Program fit" style={{width: "100%", boxSizing: "border-box", height: "36px", padding: "0 12px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E", marginBottom: "10px"}} /> <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}> <button onClick={d.createRound} style={{display: "inline-flex", alignItems: "center", height: "32px", padding: "0 15px", borderRadius: "999px", background: "var(--bt,#FF6B6B)", color: "var(--bf,#331313)", font: "600 12.5px 'IBM Plex Sans',sans-serif", textDecoration: "none", border: "none"}}>Create round</button> <button onClick={d.togNewBlind} style={{height: "32px", padding: "0 13px", borderRadius: "999px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--cd,#FFFFFF)", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>{d.newBlindLabel}</button> </div> </div> </div> <div style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", marginTop: "14px"}}>{d.plansNote}</div> </>) : null} {d.onEval ? (<> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", overflow: "hidden"}}> <div style={{display: "grid", gridTemplateColumns: "minmax(160px,1.2fr) 90px 170px 130px 120px 90px", gap: "8px", alignItems: "center", padding: "0 14px", height: "34px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <button className="dch-f129dbea" onClick={d.soName.on} title="Sort by evaluator" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soName.fg}}>EVALUATOR<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soName.gc, letterSpacing: "0"}}>{d.soName.g}</span></button> <button className="dch-f129dbea" onClick={d.soDone.on} title="Sort by done" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soDone.fg}}>DONE<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soDone.gc, letterSpacing: "0"}}>{d.soDone.g}</span></button> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>PROGRESS</span> <button className="dch-f129dbea" onClick={d.soPace.on} title="Sort by pace" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soPace.fg}}>PACE<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soPace.gc, letterSpacing: "0"}}>{d.soPace.g}</span></button> <button className="dch-f129dbea" onClick={d.soBias.on} title="Sort by vs panel avg" style={{display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", padding: "0", textAlign: "left", cursor: "pointer", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: d.soBias.fg}}>VS PANEL AVG<span style={{font: "500 9.5px 'IBM Plex Mono',monospace", color: d.soBias.gc, letterSpacing: "0"}}>{d.soBias.g}</span></button> <span></span> </div> {(d.evals ?? []).map((ev, evIndex) => (<Fragment key={evIndex}> <div style={{display: "grid", gridTemplateColumns: "minmax(160px,1.2fr) 90px 170px 130px 120px 90px", gap: "8px", alignItems: "center", padding: "0 14px", height: "42px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <span style={{display: "flex", alignItems: "center", gap: "9px", minWidth: "0"}}><span style={{width: "24px", height: "24px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 8.5px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i3,#6B7B84)", flex: "none"}}>{ev.ini}</span><span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{ev.n}</span></span> <span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{ev.frac}</span> <span style={{display: "block", height: "4px", borderRadius: "2px", background: "var(--ln,#E1E7E9)"}}><span style={{display: "block", height: "4px", borderRadius: "2px", background: ev.fill, width: ev.w}}></span></span> <span style={{justifySelf: "start", display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: ev.paceFg, background: ev.paceBg, whiteSpace: "nowrap"}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: ev.paceFg}}></span>{ev.pace}</span> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: ev.biasFg}} title="Average score given, relative to the panel">{ev.bias}</span> <button onClick={ev.onNudge} style={{height: "26px", padding: "0 10px", borderRadius: "999px", border: "1px solid var(--pdl,#EFD3B6)", background: "var(--pdw,#F9EDDF)", font: "500 11.5px 'IBM Plex Sans',sans-serif", color: "var(--pd,#B96A1F)", justifySelf: "start"}}>Nudge</button> </div> </Fragment>))} <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px"}}> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{d.evaluatorCount} evaluators · assignments auto-balance as submissions arrive</span> <span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>harsh and generous reviewers surface here, never punished automatically</span> </div> </div> </>) : null} </div> </div> <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
