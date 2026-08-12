"use client";

/* GENERATED from CFP.dc.html by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{ }} bindings turned into the props declared above. */

import { Fragment } from "react";
import Link from "next/link";
import { DesignMotion } from "@/components/DesignMotion";

export type CfpData = {
  readonly addCo: (event: React.SyntheticEvent) => void;
  readonly again: (event: React.SyntheticEvent) => void;
  readonly back: (event: React.SyntheticEvent) => void;
  readonly bio: string;
  readonly bioBd: string;
  readonly canBack: boolean;
  readonly coEmail: string;
  readonly coName: string;
  readonly code: React.ReactNode;
  readonly company: string;
  readonly copyCode: (event: React.SyntheticEvent) => void;
  readonly doneNote: React.ReactNode;
  readonly doneTitle: React.ReactNode;
  readonly doneV: boolean;
  readonly email: string;
  readonly emailBd: string;
  readonly errCount: React.ReactNode;
  readonly errors: readonly {
    readonly on: (event: React.SyntheticEvent) => void;
    readonly t: React.ReactNode;
  }[];
  readonly fields: readonly {
    readonly bd: string;
    readonly consentText: React.ReactNode;
    readonly count: React.ReactNode;
    readonly hasCount: boolean;
    readonly hasHelp: boolean;
    readonly help: React.ReactNode;
    readonly inputType: string;
    readonly isArea: boolean;
    readonly isChoice: boolean;
    readonly isConsent: boolean;
    readonly isLine: boolean;
    readonly label: React.ReactNode;
    readonly onChange: (event: React.SyntheticEvent) => void;
    readonly onToggle: (event: React.SyntheticEvent) => void;
    readonly options: readonly {
      readonly bd: string;
      readonly bg: string;
      readonly fg: string;
      readonly label: React.ReactNode;
      readonly on: (event: React.SyntheticEvent) => void;
    }[];
    readonly placeholder: string;
    readonly reqD: string;
    readonly tick: React.ReactNode;
    readonly tickBg: string;
    readonly value: string;
  }[];
  readonly hasCo: boolean;
  readonly hasCode: boolean;
  readonly hasErrors: boolean;
  readonly name: string;
  readonly nameBd: string;
  readonly next: (event: React.SyntheticEvent) => void;
  readonly nextLabel: React.ReactNode;
  readonly noCo: boolean;
  readonly onBio: (event: React.SyntheticEvent) => void;
  readonly onCoEmail: (event: React.SyntheticEvent) => void;
  readonly onCoName: (event: React.SyntheticEvent) => void;
  readonly onCompany: (event: React.SyntheticEvent) => void;
  readonly onEmail: (event: React.SyntheticEvent) => void;
  readonly onName: (event: React.SyntheticEvent) => void;
  readonly p0: boolean;
  readonly p1: boolean;
  readonly p2: boolean;
  readonly p3: boolean;
  readonly p4: boolean;
  readonly rmCo: (event: React.SyntheticEvent) => void;
  readonly savedAt: React.ReactNode;
  readonly steps: readonly {
    readonly dotBd: string;
    readonly dotBg: string;
    readonly dotFg: string;
    readonly fg: string;
    readonly mark: React.ReactNode;
    readonly n: React.ReactNode;
    readonly on: (event: React.SyntheticEvent) => void;
    readonly wt: string;
  }[];
  readonly summary: readonly {
    readonly fg: string;
    readonly k: React.ReactNode;
    readonly v: React.ReactNode;
  }[];
  readonly tBd: string;
  readonly tBg: string;
  readonly tCk: React.ReactNode;
  readonly toasts: readonly {
    readonly msg: React.ReactNode;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togTerms: (event: React.SyntheticEvent) => void;
  readonly welcomeMsg: React.ReactNode;
  readonly working: boolean;
};

const HOVER_CSS = `.dch-6cbd904b:hover{background:#E85B5B;color:#331313}`;

export function Cfp({ d }: { d: CfpData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div data-screen-label="Public CFP wizard" style={{minHeight: "100vh", background: "#F4F6F7", color: "#16232B"}}> <div style={{borderBottom: "1px solid #E1E7E9", background: "#FFFFFF"}}> <div style={{maxWidth: "860px", margin: "0 auto", padding: "0 20px", height: "54px", display: "flex", alignItems: "center", gap: "10px"}}> <svg width="22" height="22" viewBox="0 0 24 24" aria-label="Gather"><rect width="24" height="24" rx="6.5" fill="#12142E"></rect><circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B"></circle><circle cx="6.3" cy="6.3" r="2.3" fill="#EBEDF7"></circle><circle cx="14.4" cy="5.4" r="1.5" fill="#EBEDF7"></circle><circle cx="5.4" cy="14.4" r="1.5" fill="#EBEDF7"></circle></svg> <Link href="/e/devflow-2027" style={{font: "700 15px 'Bricolage Grotesque',sans-serif", letterSpacing: "-0.01em", color: "#16232B", textDecoration: "none", whiteSpace: "nowrap"}}>AI Engineer 2026</Link> <div style={{flex: "1"}}></div> <span style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "#6B7B84", whiteSpace: "nowrap"}}>closes in 37d 05h</span> </div> </div> <div style={{maxWidth: "860px", margin: "0 auto", padding: "26px 20px 80px"}}> {d.working ? (<> <div style={{border: "1px solid #C6CDEA", background: "#E9ECF7", borderRadius: "8px", padding: "10px 14px", marginBottom: "22px", display: "flex", gap: "14px", flexWrap: "wrap"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>Submissions close <span style={{font: "500 12px 'IBM Plex Mono',monospace"}}>15 Sep, 23:59 PT</span></span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>Limit: <span style={{font: "500 12px 'IBM Plex Mono',monospace"}}>3 per speaker</span>, drafts included</span> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>No account needed, your email is your identity</span> </div> <div style={{display: "grid", gridTemplateColumns: "minmax(0,200px) minmax(0,1fr)", gap: "32px"}}> <div> <div style={{position: "sticky", top: "20px"}}> {(d.steps ?? []).map((st, stIndex) => (<Fragment key={stIndex}> <button onClick={st.on} style={{display: "flex", alignItems: "center", gap: "10px", background: "none", border: "none", padding: "6px 0", width: "100%", textAlign: "left"}}> <span style={{width: "18px", height: "18px", borderRadius: "50%", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: st.dotBg, border: `1.5px solid ${st.dotBd}`, font: "600 9.5px 'IBM Plex Sans',sans-serif", color: st.dotFg}}>{st.mark}</span> <span style={{font: `${st.wt} 13.5px 'IBM Plex Sans',sans-serif`, color: st.fg, minWidth: "0"}}>{st.n}</span> </button> </Fragment>))} <div style={{font: "400 11px 'IBM Plex Mono',monospace", color: "#E04E4E", marginTop: "14px"}}>autosaved {d.savedAt}</div> </div> </div> <div style={{minWidth: "0"}}> {d.hasErrors ? (<> <div style={{border: "1px solid #F3C7C2", background: "#FBE8E6", borderRadius: "8px", padding: "12px 14px", marginBottom: "16px"}}> <div style={{font: "600 13px 'IBM Plex Sans',sans-serif", color: "#D8432B", marginBottom: "4px"}}>Almost there. {d.errCount} required answers are missing:</div> {(d.errors ?? []).map((er, erIndex) => (<Fragment key={erIndex}> <button onClick={er.on} style={{display: "block", background: "none", border: "none", padding: "2px 0", font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "#D8432B", textDecoration: "underline", textAlign: "left"}}>{er.t}</button> </Fragment>))} </div> </>) : null} {d.p0 ? (<> <h1 style={{font: "700 30px/36px 'Bricolage Grotesque',sans-serif", letterSpacing: "-0.02em", color: "#16232B", margin: "0 0 10px"}}>Speak at AI Engineer 2026</h1> <p style={{font: "400 14.5px/22px 'IBM Plex Sans',sans-serif", color: "#3E4E58", margin: "0 0 18px", maxWidth: "560px"}}>{d.welcomeMsg}</p> <div style={{border: "1px solid #E1E7E9", borderRadius: "8px", background: "#FFFFFF", padding: "14px 16px", marginBottom: "18px", maxWidth: "560px"}}> <div style={{font: "600 12.5px 'IBM Plex Sans',sans-serif", color: "#16232B", marginBottom: "6px"}}>What you will need · about 15 minutes</div> <div style={{font: "400 12.5px/19px 'IBM Plex Sans',sans-serif", color: "#6B7B84"}}>A title under 80 characters · an abstract of 150 to 400 words · your track and format · a short third-person bio. Headshot can wait until acceptance.</div> </div> <button onClick={d.togTerms} style={{display: "flex", alignItems: "flex-start", gap: "9px", background: "none", border: "none", padding: "0", marginBottom: "18px", textAlign: "left", maxWidth: "560px"}}> <span style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${d.tBd}`, background: d.tBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "#FFFFFF", flex: "none", marginTop: "2px"}}>{d.tCk}</span> <span style={{font: "400 13px/19px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>I agree to the speaker terms: recording consent is asked separately after acceptance, and my talk contains no vendor pitch.</span> </button> </>) : null} {d.p1 ? (<> <h2 style={{font: "600 20px 'IBM Plex Sans',sans-serif", color: "#16232B", margin: "0 0 4px"}}>You</h2> <p style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "#6B7B84", margin: "0 0 18px"}}>Your email is the identity for this submission. We send a magic link, never a password.</p> <div style={{maxWidth: "420px"}}> <div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "5px"}}>Email address <span style={{color: "#D8432B"}}>*</span></div> <input aria-label="you@company.com" value={d.email} onChange={d.onEmail} placeholder="you@company.com" style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 12px", borderRadius: "6px", border: `1px solid ${d.emailBd}`, background: "#FFFFFF", font: "400 14px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /> <div style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "#99A6AD", marginTop: "6px"}}>Already started? The same email resumes your draft on any device.</div> </div> </>) : null} {d.p2 ? (<> <h2 style={{font: "600 20px 'IBM Plex Sans',sans-serif", color: "#16232B", margin: "0 0 18px"}}>Your proposal</h2> <div style={{maxWidth: "560px", display: "flex", flexDirection: "column", gap: "16px"}}> {(d.fields ?? []).map((fd, fdIndex) => (<Fragment key={fdIndex}> <div> <div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "5px"}}>{fd.label}<span style={{color: "#D8432B", display: fd.reqD}}> *</span></div> {fd.isLine ? (<> <input value={fd.value} onChange={fd.onChange} type={fd.inputType} placeholder={fd.placeholder} style={{width: "100%", boxSizing: "border-box", height: "38px", padding: "0 12px", borderRadius: "6px", border: `1px solid ${fd.bd}`, background: "#FFFFFF", font: "400 14px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /> </>) : null} {fd.isArea ? (<> <textarea value={fd.value} onChange={fd.onChange} rows={7} placeholder={fd.placeholder} style={{width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "6px", border: `1px solid ${fd.bd}`, background: "#FFFFFF", font: "400 13.5px/21px 'IBM Plex Sans',sans-serif", color: "#16232B", resize: "vertical", outlineColor: "var(--sg, #E04E4E)"}}></textarea> </>) : null} {fd.isChoice ? (<> <div style={{display: "flex", gap: "7px", flexWrap: "wrap"}}> {(fd.options ?? []).map((op, opIndex) => (<Fragment key={opIndex}> <button onClick={op.on} style={{height: "36px", padding: "0 13px", borderRadius: "6px", border: `1px solid ${op.bd}`, background: op.bg, font: "500 12.5px 'IBM Plex Sans',sans-serif", color: op.fg, whiteSpace: "nowrap"}}>{op.label}</button> </Fragment>))} </div> </>) : null} {fd.isConsent ? (<> <button onClick={fd.onToggle} style={{display: "flex", alignItems: "flex-start", gap: "9px", background: "none", border: "none", padding: "0", textAlign: "left"}}><span style={{width: "14px", height: "14px", borderRadius: "4px", border: `1px solid ${fd.bd}`, background: fd.tickBg, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px 'IBM Plex Sans',sans-serif", color: "#FFFFFF", flex: "none", marginTop: "2px"}}>{fd.tick}</span><span style={{font: "400 13px/19px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>{fd.consentText}</span></button> </>) : null} {fd.hasCount ? (<><div style={{font: "400 11.5px 'IBM Plex Mono',monospace", color: "#99A6AD", marginTop: "5px"}}>{fd.count}</div></>) : null} {fd.hasHelp ? (<><div style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "#99A6AD", marginTop: "6px"}}>{fd.help}</div></>) : null} </div> </Fragment>))} </div> </>) : null} {d.p3 ? (<> <h2 style={{font: "600 20px 'IBM Plex Sans',sans-serif", color: "#16232B", margin: "0 0 4px"}}>Speakers</h2> <p style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "#6B7B84", margin: "0 0 18px"}}>Between 1 and 4 speakers. Co-speakers get their own portal invite on acceptance.</p> <div style={{maxWidth: "560px", display: "flex", flexDirection: "column", gap: "14px"}}> <div style={{border: "1px solid #E1E7E9", borderRadius: "8px", background: "#FFFFFF", padding: "14px 16px"}}> <div style={{font: "600 12px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.06em", color: "#99A6AD", marginBottom: "10px"}}>SPEAKER 1 · YOU</div> <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px"}}> <div><div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "5px"}}>Full name <span style={{color: "#D8432B"}}>*</span></div><input value={d.name} onChange={d.onName} style={{width: "100%", boxSizing: "border-box", height: "36px", padding: "0 12px", borderRadius: "6px", border: `1px solid ${d.nameBd}`, background: "#FFFFFF", font: "400 13.5px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /></div> <div><label htmlFor="cfp-company" style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "5px"}}>Company</label><input id="cfp-company" value={d.company} onChange={d.onCompany} style={{width: "100%", boxSizing: "border-box", height: "36px", padding: "0 12px", borderRadius: "6px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "400 13.5px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /></div> </div> <div style={{font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "5px"}}>Bio <span style={{color: "#D8432B"}}>*</span><span style={{font: "400 11.5px 'IBM Plex Sans',sans-serif", color: "#99A6AD"}}>50 to 100 words, third person</span></div> <textarea value={d.bio} onChange={d.onBio} rows={3} style={{width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "6px", border: `1px solid ${d.bioBd}`, background: "#FFFFFF", font: "400 13px/19px 'IBM Plex Sans',sans-serif", color: "#16232B", resize: "vertical", outlineColor: "var(--sg, #E04E4E)"}}></textarea> </div> {d.hasCo ? (<> <div style={{border: "1px solid #E1E7E9", borderRadius: "8px", background: "#FFFFFF", padding: "14px 16px"}}> <div style={{display: "flex", alignItems: "center", marginBottom: "10px"}}><span style={{font: "600 12px 'IBM Plex Sans Condensed',sans-serif", letterSpacing: "0.06em", color: "#99A6AD", flex: "1"}}>SPEAKER 2 · CO-SPEAKER</span><button onClick={d.rmCo} style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "#6B7B84", padding: "0"}}>Remove</button></div> <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px"}}> <input aria-label="Full name" value={d.coName} onChange={d.onCoName} placeholder="Full name" style={{width: "100%", boxSizing: "border-box", height: "36px", padding: "0 12px", borderRadius: "6px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "400 13.5px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /> <input aria-label="Email for their portal invite" value={d.coEmail} onChange={d.onCoEmail} placeholder="Email for their portal invite" style={{width: "100%", boxSizing: "border-box", height: "36px", padding: "0 12px", borderRadius: "6px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "400 13.5px 'IBM Plex Sans',sans-serif", color: "#16232B", outlineColor: "var(--sg, #E04E4E)"}} /> </div> </div> </>) : null} {d.noCo ? (<> <button onClick={d.addCo} style={{height: "36px", borderRadius: "6px", border: "1px dashed #C8D2D5", background: "none", font: "500 12.5px 'IBM Plex Sans',sans-serif", color: "#6B7B84"}}>+ Add a co-speaker</button> </>) : null} </div> </>) : null} {d.p4 ? (<> <h2 style={{font: "600 20px 'IBM Plex Sans',sans-serif", color: "#16232B", margin: "0 0 4px"}}>Review and submit</h2> <p style={{font: "400 13px 'IBM Plex Sans',sans-serif", color: "#6B7B84", margin: "0 0 18px"}}>You can edit everything until the deadline, even after submitting.</p> <div style={{maxWidth: "560px", border: "1px solid #E1E7E9", borderRadius: "8px", background: "#FFFFFF", overflow: "hidden"}}> {(d.summary ?? []).map((sm, smIndex) => (<Fragment key={smIndex}> <div style={{display: "grid", gridTemplateColumns: "130px 1fr", gap: "12px", padding: "10px 16px", borderBottom: "1px solid #E1E7E9"}}> <span style={{font: "400 12px 'IBM Plex Sans',sans-serif", color: "#6B7B84"}}>{sm.k}</span> <span style={{font: "400 13px/19px 'IBM Plex Sans',sans-serif", color: sm.fg}}>{sm.v}</span> </div> </Fragment>))} </div> </>) : null} <div style={{display: "flex", gap: "10px", marginTop: "24px", maxWidth: "560px"}}> {d.canBack ? (<> <button onClick={d.back} style={{height: "44px", padding: "0 18px", borderRadius: "8px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "500 14px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>Back</button> </>) : null} <div style={{flex: "1"}}></div> <button className="dch-6cbd904b" onClick={d.next} style={{height: "44px", padding: "0 22px", borderRadius: "8px", border: "none", background: "#FF6B6B", color: "#331313", font: "600 14.5px 'IBM Plex Sans',sans-serif", whiteSpace: "nowrap"}}>{d.nextLabel}</button> </div> </div> </div> </>) : null} {d.doneV ? (<> <div style={{maxWidth: "560px", margin: "40px auto 0", textAlign: "center"}}> <div style={{width: "46px", height: "46px", borderRadius: "50%", background: "#E2F1EC", border: "1px solid #C2E0D5", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 19px 'IBM Plex Sans',sans-serif", color: "#0E7A5F", marginBottom: "16px"}}>✓</div> <h1 style={{font: "700 28px 'Bricolage Grotesque',sans-serif", letterSpacing: "-0.02em", color: "#16232B", margin: "0 0 8px"}}>{d.doneTitle}</h1> <p style={{font: "400 14.5px/22px 'IBM Plex Sans',sans-serif", color: "#3E4E58", margin: "0 0 16px", maxWidth: "520px"}}>{d.doneNote}</p> {d.hasCode ? (<> <div style={{font: "600 24px 'IBM Plex Mono',monospace", color: "#E04E4E", letterSpacing: "0.04em", marginBottom: "6px"}}>{d.code}</div> <button onClick={d.copyCode} style={{height: "36px", padding: "0 11px", borderRadius: "6px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "500 12px 'IBM Plex Sans',sans-serif", color: "#3E4E58", marginBottom: "20px"}}>Copy code</button> <div style={{border: "1px solid #E1E7E9", borderRadius: "8px", background: "#FFFFFF", padding: "16px", textAlign: "left", marginBottom: "16px"}}> <div style={{font: "400 13.5px/21px 'IBM Plex Sans',sans-serif", color: "#3E4E58"}}>A confirmation email is on its way to <span style={{fontWeight: "600", color: "#16232B"}}>{d.email}</span>. Reviews close 22 Sep, decisions go out by 29 Sep. Your status link shows every stage: submitted, in review, decision.</div> </div> </>) : null} <div style={{display: "flex", justifyContent: "center", gap: "10px"}}> <button onClick={d.again} style={{height: "38px", padding: "0 15px", borderRadius: "8px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "500 13px 'IBM Plex Sans',sans-serif", color: "#16232B"}}>Submit another proposal</button> <Link href="/e/devflow-2027" style={{display: "inline-flex", alignItems: "center", height: "38px", padding: "0 15px", borderRadius: "8px", border: "1px solid #C8D2D5", background: "#FFFFFF", font: "500 13px 'IBM Plex Sans',sans-serif", color: "#16232B", textDecoration: "none"}}>Back to the event</Link> </div> </div> </>) : null} </div> <div style={{position: "fixed", right: "20px", bottom: "20px", zIndex: "90", display: "flex", flexDirection: "column", gap: "8px"}}> {(d.toasts ?? []).map((t, tIndex) => (<Fragment key={tIndex}> <div style={{display: "flex", alignItems: "center", gap: "10px", background: "var(--cd,#FFFFFF)", border: "1px solid var(--sg,#E04E4E)", borderLeft: "4px solid var(--sg,#E04E4E)", borderRadius: "10px", padding: "12px 14px", boxShadow: "0 12px 32px rgba(16,19,25,.16)", maxWidth: "420px"}}> <span style={{font: "400 12.5px 'IBM Plex Sans',sans-serif", color: "#16232B"}}>{t.msg}</span> <button onClick={t.onX} aria-label="Dismiss" style={{background: "none", border: "none", font: "500 12px 'IBM Plex Sans',sans-serif", color: "#99A6AD", padding: "0"}}>✕</button> </div> </Fragment>))} </div> </div>
    </DesignMotion>
  );
}
