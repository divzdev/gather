"use client";

/* GENERATED from Agenda.dc.html by tools/dc2tsx.py, then hand-bound. Re-running
 * the converter would drop that binding, so the pipeline is one-way here: change
 * this file, not the prototype. Behaviour (scroll reveals, count-up) comes from
 * DesignMotion; the markup is otherwise the prototype verbatim, with its {{ }}
 * bindings turned into the props declared above.
 *
 * Hand-bound since generation: the view switcher renders from `d.views` rather
 * than four hardcoded buttons, the drag canvas is gated on `d.gridOn` so the
 * other three views have somewhere to render, and the new-session sheet reads
 * its days, rooms and speakers from the event instead of the prototype's
 * literal October dates and "Main stage / Room 2 / Room 3". Its notes box is an
 * abstract, which is the field a session actually has. */

import { Fragment } from "react";
import Link from "next/link";
import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { DesignMotion } from "@/components/DesignMotion";
import { Rail } from "@/components/console/Rail";

export type AgendaData = {
  readonly acceptAll: (event: React.SyntheticEvent) => void;
  readonly agentOn: boolean;
  readonly aiQ: string;
  readonly aiText: React.ReactNode;
  readonly aiHead: React.ReactNode;
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
  readonly dayOpts: readonly { readonly l: React.ReactNode; readonly v: string }[];
  readonly roomOpts: readonly { readonly l: React.ReactNode; readonly v: string }[];
  readonly spOpts: readonly { readonly l: React.ReactNode; readonly v: string }[];
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
  readonly ckOn: boolean;
  readonly ckLabel: React.ReactNode;
  readonly ckBd: string;
  readonly ckBg: string;
  readonly closeConf: (event: React.SyntheticEvent) => void;
  readonly closePub: (event: React.SyntheticEvent) => void;
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
  readonly pub: boolean;
  readonly pubBlurb: React.ReactNode;
  readonly pubChanges: readonly React.ReactNode[];
  readonly notifyOn: boolean;
  readonly notifyLabel: React.ReactNode;
  readonly togNotify: (event: React.SyntheticEvent) => void;
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
  readonly startOpts: readonly {
    readonly l: React.ReactNode;
    readonly v: string;
  }[];
  readonly toasts: readonly {
    readonly canUndo: boolean;
    readonly msg: React.ReactNode;
    readonly onUndo: (event: React.SyntheticEvent) => void;
    readonly onX: (event: React.SyntheticEvent) => void;
  }[];
  readonly togCk: (event: React.SyntheticEvent) => void;
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
  readonly views: readonly {
    readonly label: React.ReactNode;
    readonly active: boolean;
    readonly on: (event: React.SyntheticEvent) => void;
  }[];
  readonly alt: React.ReactNode;
  readonly gridOn: boolean;
};

const HOVER_CSS = `.dch-57a5fa4b:hover{background:var(--cnw,#FBE8E6)}
.dch-afadde2a:hover{border:1px solid var(--ls,#C8D2D5);border-left:3px solid {{ u.col }}}
.dch-c4989b43:hover{background:var(--sk,#EDF1F2)}
.dch-e45ba47f:hover{border:1px solid var(--ls,#C8D2D5)}`;

export function Agenda({ d }: { d: AgendaData }) {
  return (
    <DesignMotion css={HOVER_CSS}>
      <div
        data-screen-label="Agenda builder"
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0,1fr)",
          height: "100vh",
          overflow: "hidden",
          background: "var(--pp,#F4F6F7)",
          color: "var(--ik,#16232B)",
        }}
      >
        {" "}
        <Rail active="Agenda" style={{ height: "100%", minHeight: "0" }} />{" "}
        <div
          style={{ display: "flex", flexDirection: "column", minWidth: "0", overflow: "hidden" }}
        >
          {" "}
          <ConsoleHeader />{" "}
          <div
            style={{
              flex: "none",
              padding: "20px 28px 12px",
              borderBottom: "1px solid var(--ln,#E1E7E9)",
              background: "var(--cd,#FFFFFF)",
            }}
          >
            {" "}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                font: "500 11px 'IBM Plex Mono',monospace",
                letterSpacing: "0.1em",
                color: "var(--i4,#99A6AD)",
                margin: "0 0 9px",
              }}
            >
              {" "}
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "var(--sg,#E04E4E)",
                  flex: "none",
                }}
              ></span>{" "}
              PROGRAM <span aria-hidden="true">›</span> AGENDA{" "}
            </div>{" "}
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              {" "}
              <h1
                style={{
                  font: "600 30px/1.15 'IBM Plex Sans',sans-serif",
                  letterSpacing: "-0.02em",
                  color: "var(--ik,#16232B)",
                  margin: "0",
                }}
              >
                Agenda
              </h1>{" "}
              <span
                style={{ font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)" }}
              >
                draft
              </span>{" "}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flex: "none",
                  alignSelf: "center",
                  marginLeft: "auto",
                }}
              >
                <span
                  style={{ font: "400 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)" }}
                >
                  drag to place · double-click adds · Delete unschedules · ⌘Z undo
                </span>
              </div>{" "}
            </div>{" "}
          </div>{" "}
          <div
            style={{
              minHeight: "44px",
              flex: "none",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "6px 10px",
              padding: "5px 14px",
              boxSizing: "border-box",
              borderBottom: "1px solid var(--ln,#E1E7E9)",
              background: "var(--cd,#FFFFFF)",
            }}
          >
            {" "}
            <div
              style={{
                display: "flex",
                gap: "2px",
                background: "var(--sk,#EDF1F2)",
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: "999px",
                padding: "2px",
              }}
            >
              {" "}
              {(d.days ?? []).map((d, dIndex) => (
                <Fragment key={dIndex}>
                  {" "}
                  <button
                    onClick={d.on}
                    style={{
                      height: "36px",
                      padding: "0 12px",
                      borderRadius: "999px",
                      border: "none",
                      background: d.bg,
                      color: d.fg,
                      font: `${d.wt} 12px 'IBM Plex Sans',sans-serif`,
                      boxShadow: d.sh,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.n}
                  </button>{" "}
                </Fragment>
              ))}{" "}
            </div>{" "}
            <div
              style={{
                display: "flex",
                gap: "2px",
                background: "var(--sk,#EDF1F2)",
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: "999px",
                padding: "2px",
              }}
            >
              {" "}
              {(d.views ?? []).map((v, vIndex) => (
                <Fragment key={vIndex}>
                  {" "}
                  <button
                    onClick={v.on}
                    aria-pressed={v.active}
                    style={{
                      height: "36px",
                      padding: "0 11px",
                      borderRadius: "999px",
                      border: "none",
                      background: v.active ? "var(--cd,#FFFFFF)" : "none",
                      color: v.active ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
                      font: `${v.active ? 600 : 500} 12px 'IBM Plex Sans',sans-serif`,
                      boxShadow: v.active ? "0 1px 2px rgba(16,19,25,.08)" : "none",
                    }}
                  >
                    {v.label}
                  </button>{" "}
                </Fragment>
              ))}{" "}
            </div>{" "}
            <div style={{ flex: "1" }}></div>{" "}
            {d.hasConf ? (
              <>
                {" "}
                <button
                  onClick={d.openConf}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    height: "36px",
                    padding: "0 11px",
                    borderRadius: "6px",
                    background: "var(--cnw,#FBE8E6)",
                    border: "1px solid var(--cnl,#F3C7C2)",
                    font: "600 11.5px 'IBM Plex Mono',monospace",
                    color: "var(--cn,#D8432B)",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚠ {d.confLabel}
                </button>{" "}
              </>
            ) : null}{" "}
            {d.noConf ? (
              <>
                {" "}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    height: "36px",
                    padding: "0 11px",
                    borderRadius: "6px",
                    background: "var(--okw,#E2F1EC)",
                    border: "1px solid var(--okl,#C2E0D5)",
                    font: "600 11.5px 'IBM Plex Mono',monospace",
                    color: "var(--ok,#0E7A5F)",
                  }}
                >
                  NO CONFLICTS
                </span>{" "}
              </>
            ) : null}{" "}
            <button
              className="dch-c4989b43"
              onClick={d.newSess}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                height: "36px",
                padding: "0 13px",
                borderRadius: "999px",
                border: "1px solid var(--ls,#C8D2D5)",
                background: "var(--cd,#FFFFFF)",
                color: "var(--ik,#16232B)",
                font: "500 12.5px 'IBM Plex Sans',sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              + New session
            </button>{" "}
            <button
              onClick={d.openPub}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                height: "36px",
                padding: "0 14px",
                borderRadius: "999px",
                border: "none",
                background: "var(--bt,#FF6B6B)",
                color: "var(--bf,#331313)",
                font: "600 12.5px 'IBM Plex Sans',sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              Publish schedule{" "}
              <span
                style={{
                  font: "500 10.5px 'IBM Plex Mono',monospace",
                  background: "rgba(255,255,255,.22)",
                  borderRadius: "99px",
                  padding: "1px 6px",
                }}
              >
                {d.dirty}
              </span>
            </button>{" "}
          </div>{" "}
          <div style={{ flex: "1", display: "flex", minHeight: "0" }}>
            {" "}
            <div
              style={{
                width: "240px",
                flex: "none",
                borderRight: "1px solid var(--ln,#E1E7E9)",
                background: "var(--cd,#FFFFFF)",
                display: "flex",
                flexDirection: "column",
                minHeight: "0",
              }}
            >
              {" "}
              <div
                style={{
                  padding: "12px 14px 8px",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif",
                    letterSpacing: "0.08em",
                    color: "var(--i3,#6B7B84)",
                  }}
                >
                  UNSCHEDULED
                </span>
                <span
                  style={{ font: "500 11px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)" }}
                >
                  {d.trayN}
                </span>
              </div>{" "}
              <div style={{ padding: "0 12px 10px" }}>
                <input
                  aria-label="Search the tray"
                  value={d.q}
                  onChange={d.onQ}
                  placeholder="Search the tray"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: "40px",
                    padding: "0 9px",
                    borderRadius: "6px",
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "var(--cd,#FFFFFF)",
                    font: "400 12px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                    outlineColor: "var(--sg, #E04E4E)",
                  }}
                />
              </div>{" "}
              <div
                style={{
                  flex: "1",
                  overflowY: "auto",
                  padding: "0 12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {" "}
                {(d.tray ?? []).map((u, uIndex) => (
                  <Fragment key={uIndex}>
                    {" "}
                    <div
                      className="dch-afadde2a"
                      onMouseDown={u.onDown}
                      style={{
                        border: "1px solid var(--ln,#E1E7E9)",
                        borderLeft: `3px solid ${u.col}`,
                        borderRadius: "6px",
                        background: "var(--cd,#FFFFFF)",
                        padding: "9px 11px",
                        cursor: "grab",
                        opacity: u.op,
                      }}
                    >
                      {" "}
                      <div
                        style={{
                          font: "500 12px/16px 'IBM Plex Sans',sans-serif",
                          color: "var(--ik,#16232B)",
                        }}
                      >
                        {u.t}
                      </div>{" "}
                      <div
                        style={{
                          font: "400 10.5px 'IBM Plex Mono',monospace",
                          color: "var(--i4,#99A6AD)",
                          marginTop: "3px",
                        }}
                      >
                        {u.meta}
                      </div>{" "}
                    </div>{" "}
                  </Fragment>
                ))}{" "}
                {d.trayEmpty ? (
                  <>
                    {" "}
                    <div
                      style={{
                        font: "400 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i4,#99A6AD)",
                        padding: "8px 2px",
                      }}
                    >
                      Everything is placed. Drag a session here to unschedule it.
                    </div>{" "}
                  </>
                ) : null}{" "}
              </div>{" "}
            </div>{" "}
            {d.gridOn ? (
              <>
                {" "}
                <div
                  style={{
                    flex: "1",
                    overflow: "auto",
                    minWidth: "0",
                    background: "var(--pp,#F4F6F7)",
                  }}
                >
                  {" "}
                  <div
                    style={{
                      position: "sticky",
                      top: "0",
                      zIndex: "6",
                      display: "grid",
                      gridTemplateColumns: `56px repeat(${d.roomCount},1fr)`,
                      background: "var(--cd,#FFFFFF)",
                      borderBottom: "1px solid var(--ln,#E1E7E9)",
                      minWidth: "700px",
                      boxSizing: "border-box",
                    }}
                  >
                    {" "}
                    <div style={{ height: "32px" }}></div>{" "}
                    {(d.roomCols ?? []).map((rc, rcIndex) => (
                      <Fragment key={rcIndex}>
                        {" "}
                        <div
                          style={{
                            height: "32px",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 10px",
                            font: "600 10.5px 'IBM Plex Sans Condensed',sans-serif",
                            letterSpacing: "0.1em",
                            color: "var(--i3,#6B7B84)",
                            borderLeft: "1px solid var(--ln,#E1E7E9)",
                          }}
                        >
                          {rc.n}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                  </div>{" "}
                  <div
                    data-agenda-grid=""
                    onDoubleClick={d.gridDbl}
                    style={{
                      position: "relative",
                      height: "720px",
                      minWidth: "700px",
                      boxSizing: "border-box",
                      backgroundImage:
                        "repeating-linear-gradient(to bottom,var(--ls,#C8D2D5) 0 1px,transparent 1px 90px),repeating-linear-gradient(to bottom,var(--ln,#E1E7E9) 0 1px,transparent 1px 45px)",
                    }}
                  >
                    {" "}
                    {(d.hours ?? []).map((h, hIndex) => (
                      <Fragment key={hIndex}>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            left: "0",
                            width: "56px",
                            top: h.top,
                            paddingTop: "3px",
                            textAlign: "center",
                            font: "400 10.5px 'IBM Plex Mono',monospace",
                            color: "var(--i4,#99A6AD)",
                          }}
                        >
                          {h.label}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                    <div
                      style={{
                        position: "absolute",
                        top: "0",
                        bottom: "0",
                        left: "56px",
                        width: "1px",
                        background: "var(--ln,#E1E7E9)",
                      }}
                    ></div>{" "}
                    {(d.roomRules ?? []).map((rr, rrIndex) => (
                      <Fragment key={rrIndex}>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            top: "0",
                            bottom: "0",
                            left: rr.left,
                            width: "1px",
                            background: "var(--ln,#E1E7E9)",
                          }}
                        ></div>{" "}
                      </Fragment>
                    ))}{" "}
                    {(d.blocks ?? []).map((bk, bkIndex) => (
                      <Fragment key={bkIndex}>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            left: bk.left,
                            right: "0",
                            width: bk.w,
                            top: bk.top,
                            height: bk.h,
                            background: "var(--sk,#EDF1F2)",
                            borderTop: "1px solid var(--ln,#E1E7E9)",
                            borderBottom: "1px solid var(--ln,#E1E7E9)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            font: "500 10.5px 'IBM Plex Mono',monospace",
                            letterSpacing: "0.08em",
                            color: "var(--i4,#99A6AD)",
                          }}
                        >
                          {bk.label}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                    {(d.ribbons ?? []).map((rb, rbIndex) => (
                      <Fragment key={rbIndex}>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            left: rb.left,
                            width: rb.w,
                            top: rb.top,
                            height: rb.h,
                            background:
                              "repeating-linear-gradient(-45deg,rgba(216,67,43,.13) 0 6px,rgba(216,67,43,.04) 6px 12px)",
                            borderTop: "2px solid var(--cn,#D8432B)",
                            borderBottom: "2px solid var(--cn,#D8432B)",
                            pointerEvents: "none",
                            zIndex: "1",
                          }}
                        ></div>{" "}
                      </Fragment>
                    ))}{" "}
                    {(d.cards ?? []).map((c, cIndex) => (
                      <Fragment key={cIndex}>
                        {" "}
                        <div
                          onMouseDown={c.onDown}
                          onClick={c.onClick}
                          style={{
                            position: "absolute",
                            left: c.left,
                            width: c.w,
                            top: c.top,
                            height: c.h,
                            borderRadius: "8px",
                            background: "var(--cd,#FFFFFF)",
                            border: c.bd,
                            borderLeft: `3px solid ${c.col}`,
                            boxShadow: c.sh,
                            padding: "5px 9px",
                            cursor: "grab",
                            overflow: "hidden",
                            boxSizing: "border-box",
                            opacity: c.op,
                            zIndex: "2",
                          }}
                        >
                          {" "}
                          <div
                            style={{
                              font: "400 10px 'IBM Plex Mono',monospace",
                              color: "var(--i3,#6B7B84)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.time}
                          </div>{" "}
                          <div
                            style={{
                              font: "500 12px/15px 'IBM Plex Sans',sans-serif",
                              color: "var(--ik,#16232B)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.t}
                          </div>{" "}
                          <div
                            style={{
                              display: c.spDisp,
                              font: "400 10.5px 'IBM Plex Sans',sans-serif",
                              color: "var(--i4,#99A6AD)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.sp}
                          </div>{" "}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                    {(d.ghostCards ?? []).map((g, gIndex) => (
                      <Fragment key={gIndex}>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            left: g.left,
                            width: g.w,
                            top: g.top,
                            height: g.h,
                            borderRadius: "6px",
                            border: "1.5px dashed var(--sg,#E04E4E)",
                            background: "var(--sw,#FFEAE6)",
                            padding: "5px 9px",
                            boxSizing: "border-box",
                            overflow: "hidden",
                            zIndex: "4",
                          }}
                        >
                          {" "}
                          <div
                            style={{
                              font: "500 9.5px 'IBM Plex Mono',monospace",
                              color: "var(--sg,#E04E4E)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✦ {g.time}
                          </div>{" "}
                          <div
                            style={{
                              font: "500 11.5px/14px 'IBM Plex Sans',sans-serif",
                              color: "var(--ik,#16232B)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {g.t}
                          </div>{" "}
                          <div style={{ display: "flex", gap: "5px", marginTop: "4px" }}>
                            {" "}
                            <button
                              onClick={g.onAcc}
                              style={{
                                height: "20px",
                                padding: "0 9px",
                                borderRadius: "4px",
                                border: "none",
                                background: "var(--bt,#FF6B6B)",
                                color: "var(--bf,#331313)",
                                font: "600 10.5px 'IBM Plex Sans',sans-serif",
                              }}
                            >
                              Accept
                            </button>{" "}
                            <button
                              onClick={g.onRej}
                              style={{
                                height: "20px",
                                padding: "0 9px",
                                borderRadius: "4px",
                                border: "1px solid var(--ls,#C8D2D5)",
                                background: "var(--cd,#FFFFFF)",
                                color: "var(--i2,#3E4E58)",
                                font: "500 10.5px 'IBM Plex Sans',sans-serif",
                              }}
                            >
                              Reject
                            </button>{" "}
                          </div>{" "}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                    {d.dropOn ? (
                      <>
                        {" "}
                        <div
                          style={{
                            position: "absolute",
                            left: d.drop.left,
                            width: d.drop.w,
                            top: d.drop.top,
                            height: d.drop.h,
                            borderRadius: "6px",
                            background: d.drop.bg,
                            border: `1.5px dashed ${d.drop.bd}`,
                            boxSizing: "border-box",
                            pointerEvents: "none",
                            zIndex: "5",
                          }}
                        ></div>{" "}
                        <div
                          style={{
                            position: "absolute",
                            left: d.drop.left,
                            top: d.drop.labTop,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: "var(--cd,#FFFFFF)",
                            border: `1px solid ${d.drop.bd}`,
                            font: "500 10px 'IBM Plex Mono',monospace",
                            color: d.drop.labFg,
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                            zIndex: "5",
                            boxShadow: "0 2px 6px rgba(16,19,25,.12)",
                          }}
                        >
                          {d.drop.label}
                        </div>{" "}
                      </>
                    ) : null}{" "}
                  </div>{" "}
                </div>{" "}
              </>
            ) : (
              <>
                {" "}
                <div
                  style={{
                    flex: "1",
                    overflow: "auto",
                    minWidth: "0",
                    background: "var(--pp,#F4F6F7)",
                  }}
                >
                  {d.alt}
                </div>{" "}
              </>
            )}{" "}
            <div
              style={{
                width: "280px",
                flex: "none",
                borderLeft: "1px solid var(--ln,#E1E7E9)",
                background: "var(--cd,#FFFFFF)",
                display: "flex",
                flexDirection: "column",
                minHeight: "0",
              }}
            >
              {" "}
              {d.agentOn ? (
                <>
                  {" "}
                  <div
                    style={{
                      padding: "14px 16px",
                      borderBottom: "1px solid var(--ln,#E1E7E9)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        font: "500 12px 'IBM Plex Mono',monospace",
                        color: "var(--sg,#E04E4E)",
                      }}
                    >
                      ✦
                    </span>
                    <span
                      style={{
                        font: "600 12px 'IBM Plex Sans Condensed',sans-serif",
                        letterSpacing: "0.08em",
                        color: "var(--i2,#3E4E58)",
                      }}
                    >
                      AUTO-SCHEDULE
                    </span>
                  </div>{" "}
                  <div style={{ padding: "14px 16px", overflowY: "auto", flex: "1" }}>
                    {" "}
                    <textarea
                      value={d.aiQ}
                      onChange={d.onAiQ}
                      rows={4}
                      placeholder="Leave 12:00 free. Nothing before 10:00. Nothing after 17:00. Keep Workshop Lab empty."
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "9px 11px",
                        borderRadius: "6px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 12.5px/18px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        resize: "vertical",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    ></textarea>{" "}
                    {d.hasChips ? (
                      <>
                        {" "}
                        <div
                          style={{
                            font: "600 9.5px 'IBM Plex Sans Condensed',sans-serif",
                            letterSpacing: "0.08em",
                            color: "var(--i4,#99A6AD)",
                            margin: "12px 0 6px",
                          }}
                        >
                          UNDERSTOOD AS
                        </div>{" "}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {" "}
                          {(d.chips ?? []).map((ch, chIndex) => (
                            <Fragment key={chIndex}>
                              {" "}
                              <button
                                onClick={ch.onX}
                                title="Remove this constraint"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  padding: "3px 9px",
                                  borderRadius: "99px",
                                  background: "var(--sw,#FFEAE6)",
                                  border: "1px solid var(--sl,#FFC9C0)",
                                  font: "500 11px 'IBM Plex Sans',sans-serif",
                                  color: "var(--sg,#E04E4E)",
                                  textAlign: "left",
                                }}
                              >
                                {ch.t} ✕
                              </button>{" "}
                            </Fragment>
                          ))}{" "}
                        </div>{" "}
                      </>
                    ) : null}{" "}
                    <button
                      onClick={d.runAi}
                      style={{
                        marginTop: "12px",
                        width: "100%",
                        height: "36px",
                        borderRadius: "999px",
                        border: "none",
                        background: "var(--bt,#FF6B6B)",
                        color: "var(--bf,#331313)",
                        font: "600 12.5px 'IBM Plex Sans',sans-serif",
                      }}
                    >
                      Draft the empty slots
                    </button>{" "}
                    {d.ran ? (
                      <>
                        {" "}
                        <div
                          style={{
                            marginTop: "14px",
                            border: "1px solid var(--sl,#FFC9C0)",
                            background: "var(--sw,#FFEAE6)",
                            borderRadius: "8px",
                            padding: "12px 13px",
                          }}
                        >
                          {" "}
                          <div
                            style={{
                              font: "500 11px 'IBM Plex Mono',monospace",
                              color: "var(--sg,#E04E4E)",
                              marginBottom: "7px",
                            }}
                          >
                            {d.aiHead}
                          </div>{" "}
                          <div
                            style={{
                              font: "400 12px/18px 'IBM Plex Sans',sans-serif",
                              color: "var(--i2,#3E4E58)",
                              whiteSpace: "pre-line",
                            }}
                          >
                            {d.aiText}
                          </div>{" "}
                          <div style={{ display: "flex", gap: "7px", marginTop: "11px" }}>
                            {" "}
                            <button
                              onClick={d.acceptAll}
                              style={{
                                height: "36px",
                                padding: "0 12px",
                                borderRadius: "999px",
                                border: "none",
                                background: "var(--bt,#FF6B6B)",
                                color: "var(--bf,#331313)",
                                font: "600 12px 'IBM Plex Sans',sans-serif",
                              }}
                            >
                              Accept all
                            </button>{" "}
                            <button
                              onClick={d.discard}
                              style={{
                                height: "36px",
                                padding: "0 12px",
                                borderRadius: "6px",
                                border: "1px solid var(--ls,#C8D2D5)",
                                background: "var(--cd,#FFFFFF)",
                                color: "var(--i2,#3E4E58)",
                                font: "500 12px 'IBM Plex Sans',sans-serif",
                              }}
                            >
                              Discard
                            </button>{" "}
                          </div>{" "}
                        </div>{" "}
                        <div
                          style={{
                            font: "400 11px 'IBM Plex Sans',sans-serif",
                            color: "var(--i4,#99A6AD)",
                            marginTop: "9px",
                          }}
                        >
                          Ghost cards on the grid accept one by one. Accepting is a single undo.
                        </div>{" "}
                      </>
                    ) : null}{" "}
                  </div>{" "}
                </>
              ) : null}{" "}
              {d.confOn ? (
                <>
                  {" "}
                  <div
                    style={{
                      padding: "14px 16px",
                      borderBottom: "1px solid var(--ln,#E1E7E9)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {" "}
                    <span
                      style={{
                        font: "600 12px 'IBM Plex Sans Condensed',sans-serif",
                        letterSpacing: "0.08em",
                        color: "var(--cn,#D8432B)",
                        flex: "1",
                      }}
                    >
                      CONFLICT INSPECTOR
                    </span>{" "}
                    <button
                      onClick={d.closeConf}
                      style={{
                        background: "none",
                        border: "none",
                        font: "500 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--i4,#99A6AD)",
                      }}
                    >
                      ✕
                    </button>{" "}
                  </div>{" "}
                  <div
                    style={{
                      padding: "12px 16px",
                      overflowY: "auto",
                      flex: "1",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {" "}
                    {(d.confItems ?? []).map((cf, cfIndex) => (
                      <Fragment key={cfIndex}>
                        {" "}
                        <div
                          style={{
                            border: "1px solid var(--cnl,#F3C7C2)",
                            borderRadius: "8px",
                            padding: "11px 12px",
                            background: "var(--cd,#FFFFFF)",
                          }}
                        >
                          {" "}
                          <div
                            style={{
                              font: "500 11px 'IBM Plex Mono',monospace",
                              color: "var(--cn,#D8432B)",
                              marginBottom: "4px",
                            }}
                          >
                            {cf.kind}
                          </div>{" "}
                          <div
                            style={{
                              font: "400 12.5px/18px 'IBM Plex Sans',sans-serif",
                              color: "var(--i2,#3E4E58)",
                            }}
                          >
                            {cf.label}
                          </div>{" "}
                          <div style={{ display: "flex", gap: "6px", marginTop: "9px" }}>
                            {" "}
                            <button
                              onClick={cf.onGoto}
                              style={{
                                height: "36px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                border: "1px solid var(--ls,#C8D2D5)",
                                background: "none",
                                font: "500 11.5px 'IBM Plex Sans',sans-serif",
                                color: "var(--ik,#16232B)",
                              }}
                            >
                              Select
                            </button>{" "}
                            <button
                              onClick={cf.onIgnore}
                              style={{
                                height: "36px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                border: "1px solid var(--ls,#C8D2D5)",
                                background: "none",
                                font: "500 11.5px 'IBM Plex Sans',sans-serif",
                                color: "var(--i3,#6B7B84)",
                              }}
                            >
                              Ignore
                            </button>{" "}
                          </div>{" "}
                        </div>{" "}
                      </Fragment>
                    ))}{" "}
                    {d.noConfItems ? (
                      <>
                        {" "}
                        <div
                          style={{
                            font: "400 12.5px 'IBM Plex Sans',sans-serif",
                            color: "var(--ok,#0E7A5F)",
                          }}
                        >
                          Nothing broken. Every placement is clean.
                        </div>{" "}
                      </>
                    ) : null}{" "}
                  </div>{" "}
                </>
              ) : null}{" "}
            </div>{" "}
          </div>{" "}
        </div>{" "}
        {d.pub ? (
          <>
            {" "}
            <button
              onClick={d.closePub}
              aria-label="Close"
              style={{
                position: "fixed",
                inset: "0",
                background: "rgba(13,16,32,.4)",
                border: "none",
                zIndex: "70",
                cursor: "default",
              }}
            ></button>{" "}
            <div
              style={{
                position: "fixed",
                left: "50%",
                top: "50%",
                transform: "translate(-50%,-50%)",
                width: "440px",
                background: "var(--cd,#FFFFFF)",
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: "10px",
                boxShadow: "0 12px 32px rgba(16,19,25,.24)",
                zIndex: "71",
                padding: "20px 22px",
              }}
            >
              {" "}
              <div
                style={{
                  font: "600 16px 'IBM Plex Sans',sans-serif",
                  color: "var(--ik,#16232B)",
                  marginBottom: "8px",
                }}
              >
                Publish schedule
              </div>{" "}
              <div
                style={{
                  font: "400 13px/19px 'IBM Plex Sans',sans-serif",
                  color: "var(--i2,#3E4E58)",
                  marginBottom: "14px",
                }}
              >
                {d.pubBlurb}
              </div>{" "}
              {d.pubChanges.length > 0 ? (
                <>
                  {" "}
                  <ul
                    style={{
                      margin: "0 0 14px",
                      padding: "12px 16px 12px 30px",
                      listStyleType: "disc",
                      borderRadius: "10px",
                      background: "var(--sk,#EDF1F2)",
                      display: "grid",
                      gap: "5px",
                      font: "400 12.5px/1.5 'IBM Plex Sans',sans-serif",
                      color: "var(--i2,#3E4E58)",
                    }}
                  >
                    {" "}
                    {(d.pubChanges ?? []).map((ch, chIndex) => (
                      <Fragment key={chIndex}>
                        <li>{ch}</li>
                      </Fragment>
                    ))}{" "}
                  </ul>{" "}
                </>
              ) : null}{" "}
              <button
                role="checkbox"
                aria-checked={d.notifyOn}
                onClick={d.togNotify}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: "44px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: d.notifyOn ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
                  border: `1px solid ${d.notifyOn ? "var(--sl,#FFC9C0)" : "var(--ls,#C8D2D5)"}`,
                  marginBottom: "10px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {" "}
                <span
                  aria-hidden
                  style={{
                    width: "24px",
                    height: "36px",
                    borderRadius: "7px",
                    border: `1px solid ${d.notifyOn ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)"}`,
                    background: d.notifyOn ? "var(--bt,#FF6B6B)" : "var(--cd,#FFFFFF)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 13px 'IBM Plex Sans',sans-serif",
                    color: "var(--bf,#331313)",
                    flex: "none",
                  }}
                >
                  {d.notifyOn ? "✓" : ""}
                </span>{" "}
                <span
                  style={{
                    font: "400 12.5px/1.5 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                  }}
                >
                  {d.notifyLabel}
                </span>{" "}
              </button>{" "}
              <button
                role="checkbox"
                aria-checked={d.ckOn}
                onClick={d.togCk}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: "44px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: d.ckOn ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
                  border: `1px solid ${d.ckOn ? "var(--sl,#FFC9C0)" : "var(--ls,#C8D2D5)"}`,
                  marginBottom: "18px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {" "}
                <span
                  aria-hidden
                  style={{
                    width: "24px",
                    height: "36px",
                    borderRadius: "7px",
                    border: `1px solid ${d.ckBd}`,
                    background: d.ckBg,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 13px 'IBM Plex Sans',sans-serif",
                    color: "var(--bf,#331313)",
                    flex: "none",
                  }}
                >
                  {d.ck}
                </span>{" "}
                <span
                  style={{
                    font: "500 12.5px/1.45 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                  }}
                >
                  {d.ckLabel}
                </span>{" "}
              </button>{" "}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                {" "}
                <button
                  onClick={d.closePub}
                  style={{
                    height: "44px",
                    padding: "0 18px",
                    borderRadius: "999px",
                    border: "none",
                    background: "none",
                    font: "500 13px 'IBM Plex Sans',sans-serif",
                    color: "var(--i3,#6B7B84)",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>{" "}
                <button
                  onClick={d.doPub}
                  style={{
                    height: "44px",
                    padding: "0 22px",
                    borderRadius: "999px",
                    border: "none",
                    background: d.pubBg,
                    color: d.pubFg,
                    font: "600 13.5px 'IBM Plex Sans',sans-serif",
                    cursor: "pointer",
                  }}
                >
                  {d.pubLabel}
                </button>{" "}
              </div>{" "}
            </div>{" "}
          </>
        ) : null}{" "}
        {d.compOn ? (
          <>
            {" "}
            <button
              onClick={d.compX}
              aria-label="Close"
              style={{
                position: "fixed",
                inset: "0",
                background: "rgba(20,17,12,.32)",
                border: "none",
                zIndex: "70",
                cursor: "default",
              }}
            ></button>{" "}
            <div
              style={{
                position: "fixed",
                top: "0",
                right: "0",
                bottom: "0",
                width: "min(600px,94vw)",
                background: "var(--cd,#FFFFFF)",
                borderLeft: "1px solid var(--ln,#E1E7E9)",
                boxShadow: "0 12px 32px rgba(16,19,25,.24)",
                zIndex: "71",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {" "}
              <div
                style={{
                  padding: "18px 24px 14px",
                  borderBottom: "1px solid var(--ln,#E1E7E9)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                {" "}
                <span
                  style={{
                    font: "600 19px 'IBM Plex Sans',sans-serif",
                    letterSpacing: "-0.01em",
                    color: "var(--ik,#16232B)",
                    flex: "1",
                  }}
                >
                  New session
                </span>{" "}
                <span
                  style={{
                    font: "500 10px 'IBM Plex Mono',monospace",
                    letterSpacing: "0.06em",
                    color: "var(--i4,#99A6AD)",
                  }}
                >
                  DRAFT · NOT PUBLISHED
                </span>{" "}
                <button
                  className="dch-c4989b43"
                  onClick={d.compX}
                  aria-label="Close"
                  style={{
                    width: "28px",
                    height: "36px",
                    borderRadius: "6px",
                    border: "none",
                    background: "none",
                    font: "500 14px 'IBM Plex Sans',sans-serif",
                    color: "var(--i3,#6B7B84)",
                  }}
                >
                  ✕
                </button>{" "}
              </div>{" "}
              <div style={{ flex: "1", overflowY: "auto", padding: "20px 28px 80px" }}>
                {" "}
                <label
                  htmlFor="agenda-title"
                  style={{
                    font: "500 12px 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                    marginBottom: "5px",
                  }}
                >
                  Title
                </label>
                <input
                  id="agenda-title"
                  value={d.cT}
                  onChange={d.onCT}
                  placeholder="e.g. Serving LLMs on spot fleets"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: "38px",
                    padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "var(--cd,#FFFFFF)",
                    font: "400 13.5px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                    outlineColor: "var(--sg, #E04E4E)",
                    marginBottom: "14px",
                  }}
                />{" "}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                    marginBottom: "14px",
                  }}
                >
                  {" "}
                  <div>
                    <label
                      htmlFor="agenda-speaker"
                      style={{
                        font: "500 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i2,#3E4E58)",
                        marginBottom: "5px",
                      }}
                    >
                      Speaker
                    </label>
                    <select
                      id="agenda-speaker"
                      value={d.cSp}
                      onChange={d.onCSp}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        height: "38px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    >
                      <option value="">To be confirmed</option>
                      {(d.spOpts ?? []).map((o, oIndex) => (
                        <Fragment key={oIndex}>
                          <option value={o.v}>{o.l}</option>
                        </Fragment>
                      ))}
                    </select>
                  </div>{" "}
                  <div>
                    <label
                      htmlFor="agenda-day"
                      style={{
                        font: "500 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i2,#3E4E58)",
                        marginBottom: "5px",
                      }}
                    >
                      Day
                    </label>
                    <select
                      id="agenda-day"
                      value={d.cDay}
                      onChange={d.onCDay}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        height: "38px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    >
                      {(d.dayOpts ?? []).map((o, oIndex) => (
                        <Fragment key={oIndex}>
                          <option value={o.v}>{o.l}</option>
                        </Fragment>
                      ))}
                    </select>
                  </div>{" "}
                </div>{" "}
                <div
                  style={{
                    font: "500 12px 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                    marginBottom: "5px",
                  }}
                >
                  Track
                </div>{" "}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "5px" }}>
                  {" "}
                  {(d.trOpts ?? []).map((t, tIndex) => (
                    <Fragment key={tIndex}>
                      {" "}
                      <button
                        className="dch-c4989b43"
                        onClick={t.on}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "7px",
                          height: "36px",
                          padding: "0 11px",
                          borderRadius: "999px",
                          border: `1px solid ${t.bd}`,
                          background: t.bg,
                          font: `${t.wt} 12px 'IBM Plex Sans',sans-serif`,
                          color: "var(--ik,#16232B)",
                        }}
                      >
                        <span
                          style={{
                            width: "9px",
                            height: "9px",
                            borderRadius: "3px",
                            background: t.col,
                            flex: "none",
                          }}
                        ></span>
                        {t.n}
                      </button>{" "}
                    </Fragment>
                  ))}{" "}
                </div>{" "}
                <div
                  style={{
                    font: "400 11px 'IBM Plex Sans',sans-serif",
                    color: "var(--i4,#99A6AD)",
                    marginBottom: "14px",
                  }}
                >
                  The track sets the card color on the agenda and the public schedule.
                </div>{" "}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1.2fr",
                    gap: "12px",
                    marginBottom: "14px",
                  }}
                >
                  {" "}
                  <div>
                    <label
                      htmlFor="agenda-room"
                      style={{
                        font: "500 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i2,#3E4E58)",
                        marginBottom: "5px",
                      }}
                    >
                      Room
                    </label>
                    <select
                      id="agenda-room"
                      value={d.cRoom}
                      onChange={d.onCRoom}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        height: "38px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    >
                      {(d.roomOpts ?? []).map((o, oIndex) => (
                        <Fragment key={oIndex}>
                          <option value={o.v}>{o.l}</option>
                        </Fragment>
                      ))}
                    </select>
                  </div>{" "}
                  <div>
                    <label
                      htmlFor="agenda-starts"
                      style={{
                        font: "500 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i2,#3E4E58)",
                        marginBottom: "5px",
                      }}
                    >
                      Starts
                    </label>
                    <select
                      id="agenda-starts"
                      value={d.cStart}
                      onChange={d.onCStart}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        height: "38px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    >
                      {(d.startOpts ?? []).map((so, soIndex) => (
                        <Fragment key={soIndex}>
                          <option value={so.v}>{so.l}</option>
                        </Fragment>
                      ))}
                    </select>
                  </div>{" "}
                  <div>
                    <label
                      htmlFor="agenda-length"
                      style={{
                        font: "500 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i2,#3E4E58)",
                        marginBottom: "5px",
                      }}
                    >
                      Length
                    </label>
                    <select
                      id="agenda-length"
                      value={d.cDur}
                      onChange={d.onCDur}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        height: "38px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--ls,#C8D2D5)",
                        background: "var(--cd,#FFFFFF)",
                        font: "400 13px 'IBM Plex Sans',sans-serif",
                        color: "var(--ik,#16232B)",
                        outlineColor: "var(--sg, #E04E4E)",
                      }}
                    >
                      <option value="10">10 min · lightning</option>
                      <option value="15">15 min</option>
                      <option value="30">30 min · talk</option>
                      <option value="45">45 min · keynote</option>
                      <option value="60">60 min · panel</option>
                      <option value="90">90 min · workshop</option>
                    </select>
                  </div>{" "}
                </div>{" "}
                <label
                  htmlFor="agenda-abstract"
                  style={{
                    font: "500 12px 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                    marginBottom: "5px",
                  }}
                >
                  Abstract
                </label>
                <textarea
                  id="agenda-abstract"
                  value={d.cNo}
                  onChange={d.onCNo}
                  rows={3}
                  placeholder="What the talk covers. This is what the public schedule shows."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "var(--cd,#FFFFFF)",
                    font: "400 12.5px/18px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                    resize: "vertical",
                    outlineColor: "var(--sg, #E04E4E)",
                  }}
                ></textarea>{" "}
                {d.cWarnOn ? (
                  <>
                    {" "}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        background: "var(--cnw,#FBE8E6)",
                        border: "1px solid var(--cnl,#F3C7C2)",
                        borderRadius: "8px",
                        padding: "9px 12px",
                        marginTop: "12px",
                      }}
                    >
                      {" "}
                      <span
                        style={{
                          font: "600 11px 'IBM Plex Sans',sans-serif",
                          color: "var(--cn,#D8432B)",
                        }}
                      >
                        ⚠
                      </span>{" "}
                      <span
                        style={{
                          font: "400 11.5px/16px 'IBM Plex Mono',monospace",
                          color: "var(--cn,#D8432B)",
                        }}
                      >
                        {d.cWarn} · you can still add it
                      </span>{" "}
                    </div>{" "}
                  </>
                ) : null}{" "}
              </div>{" "}
              <div
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 24px",
                  borderTop: "1px solid var(--ln,#E1E7E9)",
                  background: "var(--cd,#FFFFFF)",
                }}
              >
                {" "}
                <span
                  style={{
                    font: "400 11px 'IBM Plex Mono',monospace",
                    color: "var(--i4,#99A6AD)",
                    flex: "1",
                    minWidth: "0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.cWhen}
                </span>{" "}
                <button
                  className="dch-c4989b43"
                  onClick={d.compX}
                  style={{
                    height: "36px",
                    padding: "0 15px",
                    borderRadius: "999px",
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "none",
                    font: "500 12.5px 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                  }}
                >
                  Cancel
                </button>{" "}
                <button
                  onClick={d.compAdd}
                  style={{
                    height: "36px",
                    padding: "0 18px",
                    borderRadius: "999px",
                    border: "none",
                    background: "var(--bt,#FF6B6B)",
                    color: "var(--bf,#331313)",
                    font: "600 13px 'IBM Plex Sans',sans-serif",
                  }}
                >
                  Add to agenda
                </button>{" "}
              </div>{" "}
            </div>{" "}
          </>
        ) : null}{" "}
        <div
          style={{
            position: "fixed",
            left: "16px",
            bottom: "16px",
            zIndex: "90",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {" "}
          {(d.toasts ?? []).map((t, tIndex) => (
            <Fragment key={tIndex}>
              {" "}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "var(--cd,#FFFFFF)",
                  border: "1px solid var(--ln,#E1E7E9)",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  boxShadow: "0 12px 32px rgba(16,19,25,.16)",
                  maxWidth: "440px",
                }}
              >
                {" "}
                <span
                  style={{
                    font: "400 12.5px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                  }}
                >
                  {t.msg}
                </span>{" "}
                {t.canUndo ? (
                  <>
                    {" "}
                    <button
                      onClick={t.onUndo}
                      style={{
                        background: "none",
                        border: "none",
                        font: "600 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--sg,#E04E4E)",
                        padding: "0",
                      }}
                    >
                      Undo
                    </button>{" "}
                  </>
                ) : null}{" "}
                <button
                  onClick={t.onX}
                  aria-label="Dismiss"
                  style={{
                    background: "none",
                    border: "none",
                    font: "500 12px 'IBM Plex Sans',sans-serif",
                    color: "var(--i4,#99A6AD)",
                    padding: "0",
                  }}
                >
                  ✕
                </button>{" "}
              </div>{" "}
            </Fragment>
          ))}{" "}
        </div>{" "}
      </div>
    </DesignMotion>
  );
}
