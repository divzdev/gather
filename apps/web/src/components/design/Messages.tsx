"use client";

/* GENERATED from Messages.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type MessagesData = {
  readonly body: string;
  readonly bounceN: React.ReactNode;
  readonly ck: React.ReactNode;
  readonly ckBd: string;
  readonly ckBg: string;
  readonly doSend: (event: React.SyntheticEvent) => void;
  readonly hasBounce: boolean;
  readonly ics: boolean;
  readonly icsBd: string;
  readonly icsBg: string;
  readonly icsCk: React.ReactNode;
  readonly outbox: readonly {
    readonly at: React.ReactNode;
    readonly bg: string;
    readonly canResend: boolean;
    readonly fg: string;
    readonly onResend: (event: React.SyntheticEvent) => void;
    readonly st: React.ReactNode;
    readonly subj: React.ReactNode;
    readonly to: React.ReactNode;
  }[];
  readonly pvBody: React.ReactNode;
  readonly pvWho: React.ReactNode;
  readonly pvTo: React.ReactNode;
  readonly sendNote: React.ReactNode;
  readonly pvSubj: React.ReactNode;
  readonly resendAll: (event: React.SyntheticEvent) => void;
  readonly segCount: React.ReactNode;
  readonly segs: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly c: React.ReactNode;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly rb: string;
    readonly rd: string;
  }[];
  readonly sendBg: string;
  readonly sendFg: string;
  readonly sendLabel: React.ReactNode;
  readonly sendTest: (event: React.SyntheticEvent) => void;
  readonly subj: string;
  readonly sumOut: React.ReactNode;
  readonly tAllM: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tBn: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tQd: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tSent: {
    readonly bd: string;
    readonly c: React.ReactNode;
    readonly numFg: string;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly ring: string;
  };
  readonly tabCompose: boolean;
  readonly tabOutbox: boolean;
  readonly tabTpl: boolean;
  readonly tabs: readonly {
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
  readonly togCk: (event: React.SyntheticEvent) => void;
  readonly togIcs: (event: React.SyntheticEvent) => void;
  readonly togWho: (event: React.SyntheticEvent) => void;
  readonly tplName: React.ReactNode;
  readonly tplRows: readonly {
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly purpose: React.ReactNode;
    readonly subj: React.ReactNode;
    readonly used: React.ReactNode;
  }[];
  readonly tpls: readonly {
    readonly bd: string;
    readonly bg: string;
    readonly fg: string;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly vars: readonly {
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly whoLabel: React.ReactNode;
  readonly whoList: React.ReactNode;
  readonly whoOpen: boolean;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Messages({ d }: { d: MessagesData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Messages" style={{display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh", overflow: "hidden", background: "var(--pp,#F4F6F7)", color: "var(--ik,#16232B)"}}> <Rail active="Messages" style={{height: "100%", minHeight: "0"}} /> <div style={{display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden"}}> <ConsoleHeader /> <div style={{flex: "1", overflowY: "auto", padding: "20px 28px 80px"}}> {d.tabCompose ? (<> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 30px/1.15 'IBM Plex Sans',sans-serif", letterSpacing: "-0.02em", color: "var(--ik,#16232B)", margin: "0"}}>Compose and send</h1> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>nothing sends until step 3, ever</span>  <div style={{display: "flex", alignItems: "center", gap: "8px", flex: "none", alignSelf: "center", marginLeft: "auto"}}><div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px", marginLeft: "10px"}}> {(d.tabs ?? []).map((tb, tbIndex) => (<Fragment key={tbIndex}> <button onClick={tb.on} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: tb.bg, color: tb.fg, font: `${tb.wt} 12px 'IBM Plex Sans',sans-serif`, whiteSpace: "nowrap", boxShadow: tb.sh}}>{tb.n}</button> </Fragment>))} </div></div> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>Pick an audience, write once with variables, preview against a real speaker. Sending is always the explicit last step.</div> <div style={{display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: "20px"}}> <div style={{display: "flex", flexDirection: "column", gap: "14px"}}> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "10px"}}>1 · RECIPIENTS</div> {(d.segs ?? []).map((sg, sgIndex) => (<Fragment key={sgIndex}> <button onClick={sg.on} style={{width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "6px", border: `1px solid ${sg.bd}`, background: sg.bg, marginBottom: "6px", textAlign: "left"}}> <span style={{width: "13px", height: "13px", borderRadius: "50%", border: `1.5px solid ${sg.rb}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><span style={{width: "6px", height: "6px", borderRadius: "50%", background: sg.rd}}></span></span> <span style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", flex: "1"}}>{sg.n}</span> <span style={{font: "500 11.5px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>{sg.c}</span> </button> </Fragment>))} <button onClick={d.togWho} style={{background: "none", border: "none", padding: "0", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--sg,#E04E4E)"}}>{d.whoLabel}</button> {d.whoOpen ? (<> <div style={{font: "400 12px/19px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)", marginTop: "8px", borderTop: "1px solid var(--ln,#E1E7E9)", paddingTop: "8px"}}>{d.whoList}</div> </>) : null} </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "10px"}}>2 · MESSAGE</div> <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px"}}> {(d.tpls ?? []).map((tp, tpIndex) => (<Fragment key={tpIndex}> <button onClick={tp.on} style={{height: "28px", padding: "0 11px", borderRadius: "6px", border: `1px solid ${tp.bd}`, background: tp.bg, font: "500 12px 'IBM Plex Sans',sans-serif", color: tp.fg, whiteSpace: "nowrap"}}>{tp.n}</button> </Fragment>))} </div> <label htmlFor="messages-subject" style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "5px"}}>Subject</label><input id="messages-subject" value={d.subj} readOnly aria-readonly="true" style={{width: "100%", boxSizing: "border-box", height: "32px", padding: "0 11px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--sk,#EDF1F2)", font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", outlineColor: "#E04E4E", marginBottom: "12px"}} /> <div style={{display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px"}}><span style={{font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Body</span><span style={{font: "400 11px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>click a variable to insert it</span></div> <div style={{display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "7px"}}> {(d.vars ?? []).map((v, vIndex) => (<Fragment key={vIndex}> <button onClick={v.on} style={{padding: "2px 8px", borderRadius: "99px", background: "var(--sw,#FFEAE6)", border: "1px solid var(--sl,#FFC9C0)", font: "500 10.5px 'IBM Plex Mono',monospace", color: "var(--sg,#E04E4E)"}}>{v.n}</button> </Fragment>))} </div> <textarea value={d.body} readOnly aria-readonly="true" rows={11} style={{width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "var(--sk,#EDF1F2)", font: "400 13px/20px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", resize: "vertical", outlineColor: "#E04E4E"}}></textarea> <div style={{display: "flex", alignItems: "center", gap: "8px", marginTop: "10px"}}> <button onClick={d.togIcs} style={{display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", padding: "0"}}><span style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${d.icsBd}`, background: d.icsBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)"}}>{d.icsCk}</span><span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Attach calendar invite (.ics) with add-to-calendar links</span></button> </div> </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "14px 16px"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "10px"}}>3 · SEND</div> <div style={{font: "400 13px/20px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", marginBottom: "12px"}}>This sends <span style={{font: "500 12px 'IBM Plex Mono',monospace", color: "var(--ik,#16232B)"}}>{d.segCount}</span> {d.sendNote} Delivery lands in the outbox with per-recipient status.</div> <button onClick={d.togCk} style={{display: "flex", alignItems: "center", gap: "9px", background: "none", border: "none", padding: "0", marginBottom: "14px", textAlign: "left"}}> <span style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${d.ckBd}`, background: d.ckBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "var(--bf,#331313)", flex: "none"}}>{d.ck}</span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>I have reviewed the recipient list</span> </button> <div style={{display: "flex", gap: "8px"}}> <button onClick={d.doSend} style={{height: "34px", padding: "0 16px", borderRadius: "6px", border: "none", background: d.sendBg, color: d.sendFg, font: "600 13px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>{d.sendLabel}</button> <button onClick={d.sendTest} style={{height: "34px", padding: "0 13px", borderRadius: "6px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap"}}>Send a test to me</button> </div> </div> </div> <div> <div style={{position: "sticky", top: "0"}}> <div style={{font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i4,#99A6AD)", marginBottom: "8px"}}>{d.pvWho}</div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)", padding: "16px 18px"}}> <div style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", marginBottom: "4px"}}>to: {d.pvTo}</div> <div style={{font: "600 14px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", borderBottom: "1px solid var(--ln,#E1E7E9)", paddingBottom: "10px", marginBottom: "10px"}}>{d.pvSubj}</div> <div style={{font: "400 13px/20px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "pre-line"}}>{d.pvBody}</div> {d.ics ? (<> <div style={{display: "flex", alignItems: "center", gap: "8px", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "6px", padding: "8px 10px", marginTop: "12px"}}><span style={{width: "24px", height: "24px", borderRadius: "5px", background: "var(--sk,#EDF1F2)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "500 8px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)"}}>ICS</span><span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)"}}>session.ics · Google Calendar · Outlook</span></div> </>) : null} </div> <div style={{font: "400 11.5px/17px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", marginTop: "8px"}}>Variables fill from each real recipient. A variable with no value flags before send.</div> </div> </div> </div> </>) : null} {d.tabOutbox ? (<> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px"}}> <h1 style={{font: "600 30px/1.15 'IBM Plex Sans',sans-serif", letterSpacing: "-0.02em", color: "var(--ik,#16232B)", margin: "0"}}>Outbox</h1> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>every send, with delivery truth</span>  <div style={{display: "flex", alignItems: "center", gap: "8px", flex: "none", alignSelf: "center", marginLeft: "auto"}}><div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px", marginLeft: "10px"}}> {(d.tabs ?? []).map((tb, tbIndex) => (<Fragment key={tbIndex}> <button onClick={tb.on} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: tb.bg, color: tb.fg, font: `${tb.wt} 12px 'IBM Plex Sans',sans-serif`, whiteSpace: "nowrap", boxShadow: tb.sh}}>{tb.n}</button> </Fragment>))} </div></div> </div> <div style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", marginBottom: "16px"}}>{d.sumOut}</div> <div style={{display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: "12px", marginBottom: "16px"}}> <button onClick={d.tAllM.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tAllM.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tAllM.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--ifw,#E9ECF7)", color: "var(--if,#47599F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="3" width="12" height="9" rx="2"></rect><path d="M2.2 4.2l5.3 4.2 5.3-4.2"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tAllM.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tAllM.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>All sends</span></span> </button> <button onClick={d.tSent.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tSent.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tSent.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--okw,#E2F1EC)", color: "var(--ok,#0E7A5F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M4.8 7.8l1.8 1.8 3.6-4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tSent.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tSent.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Delivered</span></span> </button> <button onClick={d.tQd.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tQd.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tQd.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><path d="M7.5 4.3v3.4l2.3 1.4"></path></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tQd.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tQd.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Queued</span></span> </button> <button onClick={d.tBn.on} style={{display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${d.tBn.bd}`, background: "var(--cd,#FFFFFF)", boxShadow: d.tBn.ring, textAlign: "left", cursor: "pointer"}}> <span style={{width: "32px", height: "32px", borderRadius: "9px", background: "var(--cnw,#FBE8E6)", color: "var(--cn,#D8432B)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none"}}><svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7.5" cy="7.5" r="6"></circle><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"></circle></svg></span> <span style={{minWidth: "0"}}><span style={{display: "block", font: "600 19px 'IBM Plex Sans',sans-serif", color: d.tBn.numFg, fontVariantNumeric: "tabular-nums", lineHeight: "22px"}}>{d.tBn.c}</span><span style={{display: "block", font: "400 12px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap"}}>Bounced</span></span> </button> </div> {d.hasBounce ? (<> <div style={{display: "flex", alignItems: "center", gap: "12px", background: "var(--cnw,#FBE8E6)", border: "1px solid var(--cnl,#F3C7C2)", borderRadius: "6px", padding: "9px 12px", marginBottom: "14px"}}> <span style={{width: "7px", height: "7px", borderRadius: "50%", background: "var(--cn,#D8432B)", flex: "none"}}></span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", flex: "1"}}><span style={{fontWeight: "600", color: "var(--cn,#D8432B)"}}>{d.bounceN} bounced.</span> These speakers have not received their message. Bounces are silent failures in most tools.</span> <button onClick={d.resendAll} style={{height: "26px", padding: "0 10px", borderRadius: "6px", background: "none", border: "1px solid var(--cnl,#F3C7C2)", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--cn,#D8432B)", whiteSpace: "nowrap"}}>Resend failed</button> </div> </>) : null} <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)"}}> <div style={{display: "grid", gridTemplateColumns: "minmax(150px,1fr) minmax(200px,1.4fr) 130px 90px 80px", gap: "8px", alignItems: "center", padding: "0 12px", height: "34px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>RECIPIENT</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>SUBJECT</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>STATUS</span> <span style={{font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.08em", color: "var(--i3,#6B7B84)"}}>SENT</span> <span></span> </div> {(d.outbox ?? []).map((m, mIndex) => (<Fragment key={mIndex}> <div style={{display: "grid", gridTemplateColumns: "minmax(150px,1fr) minmax(200px,1.4fr) 130px 90px 80px", gap: "8px", alignItems: "center", padding: "0 12px", height: "38px", borderBottom: "1px solid var(--ln,#E1E7E9)"}}> <span style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{m.to}</span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{m.subj}</span> <span style={{justifySelf: "start", display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px 2px 7px", borderRadius: "4px", font: "500 11px 'IBM Plex Sans',sans-serif", color: m.fg, background: m.bg}}><span style={{width: "5px", height: "5px", borderRadius: "50%", background: m.fg}}></span>{m.st}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{m.at}</span> {m.canResend ? (<> <button onClick={m.onResend} style={{height: "24px", padding: "0 9px", borderRadius: "5px", border: "1px solid var(--ls,#C8D2D5)", background: "none", font: "500 11px 'IBM Plex Sans',sans-serif", color: "var(--i2,#3E4E58)"}}>Resend</button> </>) : null} </div> </Fragment>))} </div> </>) : null} {d.tabTpl ? (<> <div style={{display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px"}}> <h1 style={{font: "600 30px/1.15 'IBM Plex Sans',sans-serif", letterSpacing: "-0.02em", color: "var(--ik,#16232B)", margin: "0"}}>Templates</h1> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>one verb per template, previewed against a real speaker</span>  <div style={{display: "flex", alignItems: "center", gap: "8px", flex: "none", alignSelf: "center", marginLeft: "auto"}}><div style={{display: "flex", gap: "2px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "999px", padding: "2px", marginLeft: "10px"}}> {(d.tabs ?? []).map((tb, tbIndex) => (<Fragment key={tbIndex}> <button onClick={tb.on} style={{height: "26px", padding: "0 12px", borderRadius: "999px", border: "none", background: tb.bg, color: tb.fg, font: `${tb.wt} 12px 'IBM Plex Sans',sans-serif`, whiteSpace: "nowrap", boxShadow: tb.sh}}>{tb.n}</button> </Fragment>))} </div></div> </div> <div style={{border: "1px solid var(--ln,#E1E7E9)", borderRadius: "14px", background: "var(--cd,#FFFFFF)", boxShadow: "0 1px 2px rgba(13,16,32,.04),0 8px 24px rgba(13,16,32,.04)"}}> {(d.tplRows ?? []).map((tr, trIndex) => (<Fragment key={trIndex}> <button className="dch-c4989b43" onClick={tr.on} style={{width: "100%", display: "grid", gridTemplateColumns: "minmax(140px,0.8fr) minmax(220px,1.6fr) 120px 90px", gap: "8px", alignItems: "center", padding: "0 14px", height: "42px", border: "none", borderBottom: "1px solid var(--ln,#E1E7E9)", background: "none", textAlign: "left"}}> <span style={{font: "500 13px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{tr.n}</span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{tr.subj}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{tr.purpose}</span> <span style={{font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)"}}>{tr.used}</span> </button> </Fragment>))} </div> </>) : null} </div> </div> <div style={{position: "fixed", left: "16px", bottom: "16px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--ln,#E1E7E9)", borderRadius: "8px", padding: "10px 12px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "440px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>{t.msg}</span> <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
