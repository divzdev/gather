"use client";

/* GENERATED from ConsoleRail.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";

export type ConsoleRailData = {
  readonly ag: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly agBadge: React.ReactNode;
  readonly agBadgeD: string;
  readonly col: boolean;
  readonly divD: string;
  readonly eventDates: React.ReactNode;
  readonly eventName: React.ReactNode;
  readonly eventPlace: React.ReactNode;
  readonly exp: boolean;
  readonly eyeD: string;
  readonly fm: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly iJus: string;
  readonly iPad: string;
  readonly lblD: string;
  readonly lgBg: string;
  readonly lgHov: boolean;
  readonly lgIdle: boolean;
  readonly lgIn: (event: React.SyntheticEvent) => void;
  readonly lgOut: (event: React.SyntheticEvent) => void;
  readonly ms: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly navPad: string;
  readonly ov: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly pb: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly pt: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly railW: string;
  readonly rv: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly rvBadge: React.ReactNode;
  readonly rvBadgeD: string;
  readonly se: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly seBadge: React.ReactNode;
  readonly seBadgeD: string;
  readonly sp: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly st: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly su: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly subBadge: React.ReactNode;
  readonly subBadgeD: string;
  readonly tk: {
    readonly bg: string;
    readonly dot: string;
    readonly fg: string;
    readonly wt: string;
  };
  readonly tkBadge: React.ReactNode;
  readonly tkBadgeD: string;
  readonly togRail: (event: React.SyntheticEvent) => void;
};

const HOVER_CSS = `.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-cd0c4601:hover{background:var(--sk,#EDF1F2);color:var(--ik,#16232B)}`;

export function ConsoleRail({ d }: { d: ConsoleRailData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <aside style={{height: "100vh", maxHeight: "100%", width: d.railW, transition: "width .16s ease", borderRight: "1px solid var(--ln,#E1E7E9)", background: "var(--cd,#FFFFFF)", display: "flex", flexDirection: "column", overflow: "visible", boxSizing: "border-box"}}> {d.exp ? (<> <div style={{display: "flex", alignItems: "center", gap: "6px", margin: "12px 8px 6px 12px"}}> <Link href="/" title="Gather home" style={{textDecoration: "none", flex: "1", minWidth: "0", borderRadius: "12px", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", padding: "11px 12px", display: "flex", alignItems: "center", gap: "10px"}}> <svg width="30" height="30" viewBox="0 0 24 24" aria-label="Gather" style={{flex: "none"}}><rect width="24" height="24" rx="6.5" fill="#12142E"></rect><circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B"></circle><circle cx="6.3" cy="6.3" r="2.3" fill="#EBEDF7"></circle><circle cx="14.4" cy="5.4" r="1.5" fill="#EBEDF7"></circle><circle cx="5.4" cy="14.4" r="1.5" fill="#EBEDF7"></circle></svg> <span style={{flex: "1", minWidth: "0"}}> <span style={{display: "block", font: "600 13.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{d.eventName}</span> <span style={{display: "block", font: "400 10.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", whiteSpace: "nowrap"}}>{d.eventDates} · {d.eventPlace}</span> </span> <span style={{font: "400 10px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>▾</span> </Link> <button className="dch-cd0c4601" onClick={d.togRail} title="Collapse sidebar" aria-label="Collapse sidebar" style={{width: "26px", height: "26px", borderRadius: "7px", border: "none", background: "none", color: "var(--i3,#6B7B84)", display: "flex", alignItems: "center", justifyContent: "center", padding: "0", flex: "none"}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="2" width="12" height="11" rx="2.5"></rect><path d="M5.7 2v11"></path><path d="M10.9 5.6L9 7.5l1.9 1.9"></path></svg></button> </div> </>) : null} {d.col ? (<> <div style={{position: "relative", display: "flex", justifyContent: "center", margin: "12px 0 6px"}}> <button onClick={d.togRail} onMouseEnter={d.lgIn} onMouseLeave={d.lgOut} aria-label="Open sidebar" style={{width: "40px", height: "40px", borderRadius: "10px", border: "none", background: d.lgBg, display: "flex", alignItems: "center", justifyContent: "center", padding: "0"}}> {d.lgHov ? (<> <svg width="17" height="17" viewBox="0 0 15 15" fill="none" stroke="var(--i2,#3E4E58)" strokeWidth="1.3"><rect x="1.5" y="2" width="12" height="11" rx="2.5"></rect><path d="M5.7 2v11"></path><path d="M8.9 5.6l1.9 1.9-1.9 1.9"></path></svg> </>) : null} {d.lgIdle ? (<> <svg width="26" height="26" viewBox="0 0 24 24" aria-label="Gather"><rect width="24" height="24" rx="6.5" fill="#12142E"></rect><circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B"></circle><circle cx="6.3" cy="6.3" r="2.3" fill="#EBEDF7"></circle><circle cx="14.4" cy="5.4" r="1.5" fill="#EBEDF7"></circle><circle cx="5.4" cy="14.4" r="1.5" fill="#EBEDF7"></circle></svg> </>) : null} </button> {d.lgHov ? (<> <span style={{position: "absolute", left: "56px", top: "50%", transform: "translateY(-50%)", background: "var(--ik,#16232B)", color: "var(--cd,#FFFFFF)", font: "500 11px 'IBM Plex Sans',sans-serif", padding: "5px 10px", borderRadius: "7px", whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(13,16,32,.22)", zIndex: "120", pointerEvents: "none"}}>Open sidebar</span> </>) : null} </div> </>) : null} <nav style={{padding: d.navPad, display: "flex", flexDirection: "column", gap: "2px", flex: "1", minHeight: "0", overflowY: "auto", overflowX: "hidden"}}> <Link className="dch-c4989b43" href="/admin" title="Overview" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.ov.bg, color: d.ov.fg, font: `${d.ov.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" style={{flex: "none"}}><rect x="1" y="1" width="5.5" height="5.5" rx="1.5"></rect><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5"></rect><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5"></rect><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Overview</span><span style={{display: d.ov.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <div style={{display: d.eyeD, font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "16px 13px 6px"}}>PROGRAM</div> <div style={{display: d.divD, height: "1px", background: "var(--ln,#E1E7E9)", margin: "9px 12px"}}></div> <Link className="dch-c4989b43" href="/admin/submissions" title="Submissions" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.su.bg, color: d.su.fg, font: `${d.su.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" style={{flex: "none"}}><rect x="1.5" y="2" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="6.3" width="12" height="2.4" rx="1.2"></rect><rect x="1.5" y="10.6" width="8" height="2.4" rx="1.2"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Submissions</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--sk,#EDF1F2)", color: "var(--i3,#6B7B84)", borderRadius: "99px", padding: "2px 7px", display: d.subBadgeD}}>{d.subBadge}</span><span style={{display: d.su.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/sessions" title="Sessions" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.se.bg, color: d.se.fg, font: `${d.se.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="1.5" y="4.5" width="9.5" height="9" rx="1.8"></rect><path d="M4.5 4.5V3.2A1.7 1.7 0 0 1 6.2 1.5h5.6a1.7 1.7 0 0 1 1.7 1.7v5.6a1.7 1.7 0 0 1-1.7 1.7h-1.3"></path></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Sessions</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--sk,#EDF1F2)", color: "var(--i3,#6B7B84)", borderRadius: "99px", padding: "2px 7px", display: d.seBadgeD}}>{d.seBadge}</span><span style={{display: d.se.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/review" title="Review" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.rv.bg, color: d.rv.fg, font: `${d.rv.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><circle cx="7.5" cy="7.5" r="6"></circle><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"></circle></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Review</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--sk,#EDF1F2)", color: "var(--i3,#6B7B84)", borderRadius: "99px", padding: "2px 7px", display: d.rvBadgeD}}>{d.rvBadge}</span><span style={{display: d.rv.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/speakers" title="Speakers" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.sp.bg, color: d.sp.fg, font: `${d.sp.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><circle cx="7.5" cy="4.6" r="2.6"></circle><rect x="2.4" y="9.4" width="10.2" height="4.4" rx="2.2"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Speakers</span><span style={{display: d.sp.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/agenda" title="Agenda" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.ag.bg, color: d.ag.fg, font: `${d.ag.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="1.5" y="1.5" width="12" height="12" rx="2"></rect><rect x="4" y="6" width="3.4" height="5" rx="0.8" fill="currentColor" stroke="none"></rect><rect x="8.6" y="3.8" width="3.4" height="3.4" rx="0.8" fill="currentColor" stroke="none"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Agenda</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--cnw,#FBE8E6)", color: "var(--cn,#D8432B)", borderRadius: "99px", padding: "2px 7px", display: d.agBadgeD}}>{d.agBadge}</span><span style={{display: d.ag.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <div style={{display: d.eyeD, font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "16px 13px 6px"}}>OPERATIONS</div> <div style={{display: d.divD, height: "1px", background: "var(--ln,#E1E7E9)", margin: "9px 12px"}}></div> <Link className="dch-c4989b43" href="/admin/tasks" title="Tasks" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.tk.bg, color: d.tk.fg, font: `${d.tk.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="1.5" y="1.5" width="12" height="12" rx="2"></rect><path d="M4.6 7.8l2 2 3.8-4.2" fill="none"></path></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Tasks</span><span style={{font: "500 10.5px 'IBM Plex Mono',monospace", background: "var(--pdw,#F9EDDF)", color: "var(--pd,#B96A1F)", borderRadius: "99px", padding: "2px 7px", display: d.tkBadgeD}}>{d.tkBadge}</span><span style={{display: d.tk.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/messages" title="Messages" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.ms.bg, color: d.ms.fg, font: `${d.ms.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="1.5" y="3" width="12" height="9" rx="2"></rect><rect x="4" y="6.2" width="7" height="1.6" rx="0.8" fill="currentColor" stroke="none"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Messages</span><span style={{display: d.ms.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/portal" title="Speaker portal" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.pt.bg, color: d.pt.fg, font: `${d.pt.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="3.5" y="1.5" width="8" height="12" rx="2"></rect><rect x="6.4" y="10.4" width="2.2" height="1.4" rx="0.7" fill="currentColor" stroke="none"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Speaker portal</span><span style={{display: d.pt.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <div style={{display: d.eyeD, font: "600 10px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.1em", color: "var(--i4,#99A6AD)", padding: "16px 13px 6px"}}>SETUP</div> <div style={{display: d.divD, height: "1px", background: "var(--ln,#E1E7E9)", margin: "9px 12px"}}></div> <Link className="dch-c4989b43" href="/admin/forms" title="Forms & pages" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.fm.bg, color: d.fm.fg, font: `${d.fm.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><rect x="2.5" y="1.5" width="10" height="12" rx="2"></rect><rect x="5" y="4.4" width="5" height="1.4" rx="0.7" fill="currentColor" stroke="none"></rect><rect x="5" y="7.2" width="5" height="1.4" rx="0.7" fill="currentColor" stroke="none"></rect></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Forms &amp; pages</span><span style={{display: d.fm.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/publishing" title="Publishing" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.pb.bg, color: d.pb.fg, font: `${d.pb.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flex: "none"}}><path d="M5 4L1.8 7.5 5 11"></path><path d="M10 4l3.2 3.5L10 11"></path></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Publishing</span><span style={{display: d.pb.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> <Link className="dch-c4989b43" href="/admin/settings" title="Settings" style={{textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", height: "38px", padding: d.iPad, justifyContent: d.iJus, borderRadius: "99px", background: d.st.bg, color: d.st.fg, font: `${d.st.wt} 13.5px 'IBM Plex Sans',sans-serif`}}><svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" style={{flex: "none"}}><circle cx="7.5" cy="7.5" r="2.4"></circle><circle cx="7.5" cy="1.9" r="1.3"></circle><circle cx="7.5" cy="13.1" r="1.3"></circle><circle cx="1.9" cy="7.5" r="1.3"></circle><circle cx="13.1" cy="7.5" r="1.3"></circle></svg><span style={{display: d.lblD, flex: "1", minWidth: "0", alignItems: "center", gap: "10px"}}><span style={{flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Settings</span><span style={{display: d.st.dot, width: "6px", height: "6px", borderRadius: "50%", background: "var(--sg,#E04E4E)"}}></span></span></Link> </nav> {d.exp ? (<> <div style={{borderTop: "1px solid var(--ln,#E1E7E9)", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px"}}> <span style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)", flex: "none"}}>SW</span> <span style={{flex: "1", minWidth: "0"}}> <span style={{display: "block", font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)"}}>Sasha W</span> <span style={{display: "block", font: "400 10.5px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)"}}>Program lead</span> </span> <span style={{font: "500 9px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)", border: "1px solid var(--ls,#C8D2D5)", borderRadius: "99px", padding: "2px 7px"}}>DEMO</span> </div> </>) : null} {d.col ? (<> <div style={{borderTop: "1px solid var(--ln,#E1E7E9)", padding: "12px 0", display: "flex", justifyContent: "center"}} title="Sasha W · Program lead"> <span style={{width: "28px", height: "28px", borderRadius: "50%", background: "var(--sk,#EDF1F2)", border: "1px solid var(--ln,#E1E7E9)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 10px 'IBM Plex Sans Condensed',sans-serif", color: "var(--i2,#3E4E58)"}}>SW</span> </div> </>) : null} </aside>
    </DesignMotion>
  );
}
