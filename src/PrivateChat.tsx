import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Peer, { type DataConnection, type MediaConnection } from "peerjs";

/* ─────────────────────────────────────────
   TYPES
───────────────────────────────────────── */
type Screen = "home" | "wait" | "connecting" | "room";

interface Participant {
  peerId: string;
  name: string;
  isAdmin: boolean;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
}

interface ChatMsg {
  id: string;
  text: string;
  type: "me" | "them" | "system";
  sender: string;
  time: string;
}

interface PendingApproval {
  peerId: string;
  name: string;
  device: string;
  conn: DataConnection;
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const DEVICE_ID: string = (() => {
  const key = "pc_did_v3";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
})();

const EMOJIS = [
  "🌸",
  "💫",
  "🌙",
  "⭐",
  "🦋",
  "🌺",
  "💎",
  "🔥",
  "🌊",
  "🎭",
  "🦊",
  "🐬",
  "🦁",
  "🎨",
  "🚀",
  "🌿",
  "🍀",
  "✨",
  "🎯",
  "🦄",
];
function nameToEmoji(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return EMOJIS[h % EMOJIS.length];
}
function nowTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
function uid() {
  return Math.random().toString(36).slice(2);
}

/* ─────────────────────────────────────────
   GLOBAL STYLES
───────────────────────────────────────── */
const CSS = `
  html,body{margin:0;padding:0;height:100%;overflow:hidden}
  #pc-wrap{position:fixed;inset:0;background:#05040f;color:#f0eeff;font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
  #pc-wrap *,#pc-wrap *::before,#pc-wrap *::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  #pc-wrap button{cursor:pointer;font-family:inherit}
  #pc-wrap input{font-family:inherit}

  .pc-amb{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 65% 50% at 15% 10%,rgba(109,40,217,.14) 0%,transparent 70%),radial-gradient(ellipse 50% 60% at 85% 85%,rgba(139,92,246,.09) 0%,transparent 70%)}

  /* ── HOME / WAIT / CONNECTING ── */
  .pc-center{flex:1;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden}

  /* orb */
  .pc-orb{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa,#c4b5fd);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;box-shadow:0 0 0 1px rgba(167,139,250,.25),0 0 50px rgba(109,40,217,.5);animation:pcFloat 4s ease-in-out infinite;position:relative}
  .pc-orb::after{content:'';position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(from 0deg,rgba(167,139,250,.6),transparent 60%,rgba(109,40,217,.6),transparent 60%);animation:pcSpin 5s linear infinite;mask:radial-gradient(farthest-side,transparent calc(100% - 2px),white calc(100% - 2px));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),white calc(100% - 2px))}
  @keyframes pcFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
  @keyframes pcSpin{to{transform:rotate(360deg)}}
  @keyframes pcPulse{0%,100%{box-shadow:0 0 40px rgba(109,40,217,.2);transform:scale(1)}50%{box-shadow:0 0 70px rgba(109,40,217,.4);transform:scale(1.07)}}

  /* card */
  .pc-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:clamp(20px,5vw,34px);width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07);position:relative;overflow:hidden}
  .pc-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.45),transparent)}

  /* title */
  .pc-title{font-style:italic;font-size:clamp(2rem,8vw,3rem);letter-spacing:-.03em;background:linear-gradient(135deg,#f0eeff 30%,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:6px}
  .pc-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);font-size:.62rem;color:#c4b5fd;letter-spacing:.12em;text-transform:uppercase;font-weight:500}

  /* inputs */
  .pc-iw{position:relative;margin-bottom:10px}
  .pc-iw-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:rgba(240,238,255,.3);pointer-events:none;display:flex}
  .pc-input{width:100%;padding:13px 14px 13px 40px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:#f0eeff;font-size:.88rem;outline:none;transition:all .2s;caret-color:#a78bfa}
  .pc-input:focus{border-color:rgba(167,139,250,.5);background:rgba(167,139,250,.05);box-shadow:0 0 0 3px rgba(167,139,250,.08)}
  .pc-input::placeholder{color:rgba(240,238,255,.28)}

  /* buttons */
  .pc-btn-p{width:100%;padding:14px 18px;border-radius:12px;border:none;background:linear-gradient(135deg,#6d28d9,#a78bfa);color:#fff;font-size:.88rem;font-weight:700;letter-spacing:.04em;transition:all .2s;box-shadow:0 4px 24px rgba(109,40,217,.4),inset 0 1px 0 rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;gap:8px}
  .pc-btn-p:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(109,40,217,.55),inset 0 1px 0 rgba(255,255,255,.15)}
  .pc-btn-s{width:100%;padding:13px 18px;border-radius:12px;background:transparent;border:1px solid rgba(255,255,255,.16);color:#f0eeff;font-size:.88rem;font-weight:600;letter-spacing:.04em;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}
  .pc-btn-s:hover{background:rgba(255,255,255,.07);border-color:rgba(167,139,250,.4);color:#c4b5fd}
  .pc-divider{display:flex;align-items:center;gap:12px;margin:14px 0;color:rgba(240,238,255,.28);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}
  .pc-divider::before,.pc-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.09)}

  /* trust row */
  .pc-trust{display:flex;gap:18px;justify-content:center;margin-top:16px}
  .pc-trust-item{display:flex;flex-direction:column;align-items:center;gap:4px}
  .pc-trust-icon{width:28px;height:28px;border-radius:50%;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.15);display:flex;align-items:center;justify-content:center;font-size:13px}
  .pc-trust-label{font-size:.57rem;color:rgba(240,238,255,.28);letter-spacing:.08em;text-transform:uppercase}

  /* wait screen */
  .pc-wait-orb{width:76px;height:76px;border-radius:50%;background:rgba(109,40,217,.2);border:1px solid rgba(167,139,250,.25);display:flex;align-items:center;justify-content:center;font-size:26px;animation:pcPulse 2.5s ease-in-out infinite;margin:0 auto}
  .pc-link-box{background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.2);border-radius:13px;padding:13px 16px;font-size:clamp(.57rem,2vw,.68rem);color:#c4b5fd;word-break:break-all;line-height:1.7;width:100%;font-family:monospace}
  .pc-copy-btn{display:flex;align-items:center;gap:7px;padding:10px 24px;border-radius:10px;border:1px solid rgba(167,139,250,.35);background:rgba(167,139,250,.1);color:#c4b5fd;font-size:.78rem;font-weight:600;letter-spacing:.05em;transition:all .2s}
  .pc-copy-btn:hover{background:rgba(167,139,250,.2);transform:translateY(-1px)}
  .pc-spinner{width:64px;height:64px;border-radius:50%;border:2px solid rgba(167,139,250,.1);border-top-color:#a78bfa;animation:pcSpin 1s linear infinite;margin:0 auto}

  /* ══════════ ROOM ══════════ */
  .pc-room-wrap{flex:1;display:grid;grid-template-columns:1fr 290px;grid-template-rows:1fr 68px;overflow:hidden;min-height:0}

  /* video area */
  .pc-video-area{grid-column:1;grid-row:1;background:#020108;position:relative;overflow:hidden;min-height:0}
  .pc-vgrid{width:100%;height:100%;display:grid;gap:3px;padding:3px}
  .pc-g1{grid-template-columns:1fr}
  .pc-g2{grid-template-columns:1fr 1fr}
  .pc-g3{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g5{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g6{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-gmany{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}

  /* tile */
  .pc-tile{position:relative;border-radius:8px;overflow:hidden;background:#080616;border:1px solid rgba(255,255,255,.06);min-height:80px}
  .pc-tile.pc-self{border-color:rgba(139,92,246,.3)}
  .pc-tile video{width:100%;height:100%;object-fit:cover;display:block}
  .pc-tile-ov{position:absolute;bottom:0;left:0;right:0;padding:7px 10px;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);display:flex;align-items:center;justify-content:space-between}
  .pc-tile-name{font-size:.72rem;font-weight:600;color:#fff;display:flex;align-items:center;gap:4px}
  .pc-tile-icons{display:flex;gap:3px}
  .pc-tile-icon{width:18px;height:18px;border-radius:50%;background:rgba(248,113,113,.35);display:flex;align-items:center;justify-content:center}
  .pc-av-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
  .pc-av-ring{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1.4rem;box-shadow:0 0 24px rgba(109,40,217,.4)}
  .pc-av-name{font-size:.74rem;color:rgba(240,238,255,.45);font-style:italic}
  .pc-self-badge{position:absolute;top:7px;left:7px;padding:2px 7px;border-radius:20px;background:rgba(139,92,246,.25);border:1px solid rgba(167,139,250,.4);font-size:.56rem;color:#c4b5fd;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
  .pc-adm-badge{background:rgba(109,40,217,.3);border-color:rgba(251,191,36,.5);color:#fde68a}

  /* room header overlay */
  .pc-rh{position:absolute;top:0;left:0;right:0;z-index:5;padding:10px 14px;background:linear-gradient(to bottom,rgba(0,0,0,.6),transparent);display:flex;align-items:center;justify-content:space-between;pointer-events:none}
  .pc-enc-pill{display:flex;align-items:center;gap:4px;padding:3px 9px;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.2);border-radius:20px;font-size:.58rem;color:#4ade80;letter-spacing:.07em;text-transform:uppercase}
  .pc-cnt-pill{font-size:.7rem;color:rgba(255,255,255,.45)}
  .pc-adm-pill{display:flex;align-items:center;gap:4px;padding:3px 9px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);border-radius:20px;font-size:.63rem;color:#fbbf24}

  /* ── SIDEBAR ── */
  .pc-sidebar{grid-column:2;grid-row:1/3;background:rgba(5,4,14,.99);border-left:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .pc-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
  .pc-tab{flex:1;padding:12px 8px;font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(240,238,255,.28);border:none;background:transparent;display:flex;align-items:center;justify-content:center;gap:5px;position:relative;transition:color .2s}
  .pc-tab.act{color:#c4b5fd}
  .pc-tab.act::after{content:'';position:absolute;bottom:0;left:15%;right:15%;height:2px;background:#a78bfa;border-radius:2px 2px 0 0}
  .pc-tab-bdg{background:#7c3aed;color:#fff;border-radius:10px;padding:1px 6px;font-size:.56rem;min-width:17px;text-align:center}

  /* people */
  .pc-people{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.15) transparent}
  .pc-people::-webkit-scrollbar{width:3px}
  .pc-people::-webkit-scrollbar-thumb{background:rgba(167,139,250,.15);border-radius:2px}
  .pc-pcard{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);transition:background .2s}
  .pc-pcard:hover{background:rgba(255,255,255,.07)}
  .pc-pcard.self{border-color:rgba(139,92,246,.2)}
  .pc-pav{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0}
  .pc-pinfo{flex:1;min-width:0}
  .pc-pname{font-size:.78rem;font-weight:600;color:#f0eeff;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pc-you{font-size:.52rem;color:#c4b5fd;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);padding:1px 5px;border-radius:7px;letter-spacing:.05em;text-transform:uppercase;flex-shrink:0}
  .pc-admtag{font-size:.52rem;color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);padding:1px 5px;border-radius:7px;flex-shrink:0}
  .pc-pstatus{font-size:.62rem;color:rgba(240,238,255,.28);display:flex;align-items:center;gap:3px;margin-top:1px}
  .pc-pdot{width:5px;height:5px;border-radius:50%;background:#4ade80;flex-shrink:0}
  .pc-picons{display:flex;gap:2px}
  .pc-picon{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:rgba(240,238,255,.3)}
  .pc-picon.off{color:#f87171}
  .pc-kick{width:24px;height:24px;border-radius:6px;border:1px solid rgba(248,113,113,.25);background:rgba(248,113,113,.07);color:#f87171;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0}
  .pc-kick:hover{background:rgba(248,113,113,.2);border-color:rgba(248,113,113,.5);transform:scale(1.1)}

  /* chat */
  .pc-chat{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .pc-msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.15) transparent;min-height:0}
  .pc-msgs::-webkit-scrollbar{width:3px}
  .pc-msgs::-webkit-scrollbar-thumb{background:rgba(167,139,250,.15);border-radius:2px}
  .pc-msg{max-width:90%;word-break:break-word}
  .pc-msg.me{align-self:flex-end}
  .pc-msg.them{align-self:flex-start}
  .pc-msg.sys{align-self:center}
  .pc-bubble{padding:7px 11px;border-radius:12px;font-size:.77rem;line-height:1.5}
  .me .pc-bubble{background:linear-gradient(135deg,rgba(109,40,217,.35),rgba(139,92,246,.2));border:1px solid rgba(167,139,250,.2);color:#f0eeff;border-bottom-right-radius:3px}
  .them .pc-bubble{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);color:#f0eeff;border-bottom-left-radius:3px}
  .sys .pc-bubble{background:transparent;border:none;color:rgba(240,238,255,.3);font-size:.64rem;font-style:italic;padding:2px 8px}
  .pc-mmeta{font-size:.57rem;color:rgba(240,238,255,.3);margin-bottom:3px;display:flex;align-items:center;gap:4px}
  .me .pc-mmeta{justify-content:flex-end}
  .pc-no-chat{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;opacity:.35}
  .pc-chat-foot{padding:9px 10px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:6px;flex-shrink:0}
  .pc-ci{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:8px 11px;color:#f0eeff;font-size:.79rem;outline:none;transition:border-color .2s;caret-color:#a78bfa}
  .pc-ci:focus{border-color:rgba(167,139,250,.4)}
  .pc-ci::placeholder{color:rgba(240,238,255,.28)}
  .pc-send{width:33px;height:33px;border-radius:10px;border:none;background:linear-gradient(135deg,#6d28d9,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .2s;flex-shrink:0}
  .pc-send:hover{transform:scale(1.08)}

  /* controls */
  .pc-ctrl{grid-column:1;grid-row:2;background:rgba(3,2,10,.99);border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;gap:12px;padding:0 20px;flex-shrink:0}
  .pc-cw{display:flex;flex-direction:column;align-items:center;gap:3px}
  .pc-cb{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#f0eeff;display:flex;align-items:center;justify-content:center;transition:all .2s}
  .pc-cb:hover{background:rgba(255,255,255,.12);border-color:rgba(167,139,250,.4)}
  .pc-cb.off{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.3);color:#f87171}
  .pc-cl{font-size:.53rem;color:rgba(240,238,255,.28);letter-spacing:.05em;text-transform:uppercase}
  .pc-end{width:48px;height:48px;border-radius:50%;border:none;background:linear-gradient(135deg,#991b1b,#ef4444);color:#fff;display:flex;align-items:center;justify-content:center;transition:all .2s;box-shadow:0 4px 20px rgba(239,68,68,.4)}
  .pc-end:hover{transform:scale(1.08);box-shadow:0 8px 30px rgba(239,68,68,.6)}

  /* knock modal */
  .pc-knock-ov{position:absolute;inset:0;z-index:50;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;animation:pcFadeIn .2s ease}
  @keyframes pcFadeIn{from{opacity:0}to{opacity:1}}
  .pc-knock-card{background:rgba(8,7,18,.98);border:1px solid rgba(167,139,250,.25);border-radius:22px;padding:28px 24px;max-width:320px;width:90%;text-align:center;animation:pcKnock .45s cubic-bezier(.34,1.56,.64,1);box-shadow:0 0 60px rgba(109,40,217,.2);position:relative;overflow:hidden}
  .pc-knock-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.5),transparent)}
  @keyframes pcKnock{from{opacity:0;transform:scale(.78) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
  .pc-kav{width:66px;height:66px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1.6rem;margin:0 auto 14px;box-shadow:0 0 0 4px rgba(109,40,217,.15),0 0 24px rgba(139,92,246,.4)}
  .pc-kname{font-style:italic;font-size:1.35rem;color:#f0eeff;margin-bottom:3px}
  .pc-kdev{font-size:.62rem;color:rgba(240,238,255,.28);letter-spacing:.08em;font-family:monospace}
  .pc-klbl{font-size:.72rem;color:rgba(240,238,255,.5);margin:12px 0 18px;line-height:1.6;padding:10px 12px;background:rgba(167,139,250,.06);border-radius:9px;border:1px solid rgba(167,139,250,.1)}
  .pc-kbtns{display:flex;gap:9px}
  .pc-accept{flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-size:.82rem;font-weight:700;letter-spacing:.05em;transition:all .2s;box-shadow:0 4px 16px rgba(34,197,94,.3);display:flex;align-items:center;justify-content:center;gap:6px}
  .pc-accept:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(34,197,94,.45)}
  .pc-decline{flex:1;padding:12px;border-radius:10px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.08);color:#f87171;font-size:.82rem;font-weight:700;letter-spacing:.05em;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px}
  .pc-decline:hover{background:rgba(248,113,113,.18)}

  /* toast */
  .pc-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:rgba(255,255,255,.09);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:9px 18px;font-size:.77rem;color:#f0eeff;z-index:999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .pc-toast.show{transform:translateX(-50%) translateY(0)}

  /* mobile */
  .pc-fabs{display:none;position:absolute;bottom:80px;right:14px;flex-direction:column;gap:8px;z-index:20}
  .pc-fab{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(5,4,14,.85);backdrop-filter:blur(12px);color:#f0eeff;display:flex;align-items:center;justify-content:center;transition:all .2s;position:relative}
  .pc-fab:hover{background:rgba(255,255,255,.1)}
  .pc-fab-bdg{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;border-radius:8px;background:#7c3aed;color:#fff;font-size:.54rem;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #05040f}
  .pc-mob-back{display:none;position:absolute;bottom:0;left:0;right:0;z-index:50;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);top:0}
  .pc-mob-panel{display:none;position:absolute;bottom:0;left:0;right:0;z-index:51;background:rgba(5,4,14,.99);border-top:1px solid rgba(255,255,255,.08);flex-direction:column;max-height:72%;border-radius:18px 18px 0 0}
  .pc-mob-handle{width:38px;height:3px;border-radius:2px;background:rgba(255,255,255,.15);margin:9px auto 4px}
  .pc-mob-head{display:flex;align-items:center;justify-content:space-between;padding:7px 14px 9px;border-bottom:1px solid rgba(255,255,255,.08)}

  @media (max-width:620px){
    .pc-room-wrap{grid-template-columns:1fr;grid-template-rows:1fr 68px}
    .pc-sidebar{display:none}
    .pc-ctrl{grid-column:1;grid-row:2}
    .pc-fabs{display:flex}
    .pc-mob-panel.open{display:flex}
    .pc-mob-back.open{display:block}
    .pc-toast{bottom:90px}
  }
`;

function injectStyles() {
  if (document.getElementById("pc-styles")) return;
  const s = document.createElement("style");
  s.id = "pc-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────
   INLINE ICONS
───────────────────────────────────────── */
const SVG: Record<string, string> = {
  User: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  Link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  Plus: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  LogIn: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
  Copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  Check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  X: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  X2: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  Mic: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  MicOff: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  Cam: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  CamOff: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  Vol: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  VolOff: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  Phone: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><path d="M6.28 6.28A19.79 19.79 0 0 0 3 14.9 2 2 0 0 0 5 17h3a2 2 0 0 1 2-1.72 12.84 12.84 0 0 0 .7-2.81 2 2 0 0 1-.45-2.11L8.98 9.1"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  Kick: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  Users: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  Chat: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  Send: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  Door: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.307.956L4 18V4.38a1 1 0 0 1 .993-1L12 3a1 1 0 0 1 1 1z"/></svg>`,
  Lock: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  Crown: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg>`,
};

const Ic = ({ n, style }: { n: string; style?: React.CSSProperties }) => (
  <span
    style={{ display: "inline-flex", alignItems: "center", ...style }}
    dangerouslySetInnerHTML={{ __html: SVG[n] ?? "" }}
  />
);

/* ─────────────────────────────────────────
   VIDEO TILE
───────────────────────────────────────── */
function VideoTile({
  p,
  isSelf,
  isAdminUser,
}: {
  p: Participant;
  isSelf: boolean;
  isAdminUser: boolean;
}) {
  const vidRef = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    if (p.stream) {
      el.srcObject = p.stream;
      el.play().catch(() => {});
    } else el.srcObject = null;
  }, [p.stream]);

  const hasVideo = !!p.stream && p.camOn !== false;
  return (
    <div className={`pc-tile${isSelf ? " pc-self" : ""}`}>
      <video
        ref={vidRef}
        autoPlay
        playsInline
        muted={isSelf}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: hasVideo ? "block" : "none",
          transform: isSelf ? "scaleX(-1)" : "none",
        }}
      />
      {!hasVideo && (
        <div className="pc-av-center">
          <div className="pc-av-ring">{nameToEmoji(p.name)}</div>
          <div className="pc-av-name">{p.name}</div>
        </div>
      )}
      <div className="pc-tile-ov">
        <div className="pc-tile-name">
          <span>{nameToEmoji(p.name)}</span>
          <span>{p.name}</span>
        </div>
        <div className="pc-tile-icons">
          {p.micOn === false && (
            <div className="pc-tile-icon">
              <Ic n="MicOff" style={{ transform: "scale(.7)" }} />
            </div>
          )}
          {p.camOn === false && (
            <div className="pc-tile-icon">
              <Ic n="CamOff" style={{ transform: "scale(.7)" }} />
            </div>
          )}
        </div>
      </div>
      <div className={`pc-self-badge${isAdminUser ? " pc-adm-badge" : ""}`}>
        {isAdminUser ? "👑 Admin (You)" : "You"}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   PEOPLE PANEL
───────────────────────────────────────── */
function PeoplePanel({
  parts,
  myId,
  isAdmin,
  onKick,
}: {
  parts: Participant[];
  myId: string;
  isAdmin: boolean;
  onKick: (id: string, n: string) => void;
}) {
  return (
    <div className="pc-people">
      {parts.map((p) => (
        <div
          key={p.peerId}
          className={`pc-pcard${p.peerId === myId ? " self" : ""}`}
        >
          <div className="pc-pav">{nameToEmoji(p.name)}</div>
          <div className="pc-pinfo">
            <div className="pc-pname">
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.name}
              </span>
              {p.peerId === myId && <span className="pc-you">You</span>}
              {p.isAdmin && <span className="pc-admtag">👑 Admin</span>}
            </div>
            <div className="pc-pstatus">
              <span className="pc-pdot" />
              <span>Connected</span>
            </div>
          </div>
          <div className="pc-picons">
            <div className={`pc-picon${p.micOn === false ? " off" : ""}`}>
              <Ic n={p.micOn === false ? "MicOff" : "Mic"} />
            </div>
            <div className={`pc-picon${p.camOn === false ? " off" : ""}`}>
              <Ic n={p.camOn === false ? "CamOff" : "Cam"} />
            </div>
          </div>
          {isAdmin && p.peerId !== myId && (
            <button
              className="pc-kick"
              onClick={() => onKick(p.peerId, p.name)}
              title={`Remove ${p.name}`}
            >
              <Ic n="Kick" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────
   CHAT PANEL
───────────────────────────────────────── */
function ChatPanel({
  msgs,
  onSend,
}: {
  msgs: ChatMsg[];
  onSend: (t: string) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [msgs]);
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="pc-chat">
      <div className="pc-msgs" ref={ref}>
        {msgs.length === 0 && (
          <div className="pc-no-chat">
            <Ic
              n="Chat"
              style={{ fontSize: 22, color: "rgba(240,238,255,.3)" }}
            />
            <p style={{ fontSize: ".72rem", color: "rgba(240,238,255,.3)" }}>
              No messages yet
            </p>
          </div>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`pc-msg ${m.type === "system" ? "sys" : m.type}`}
          >
            {m.type !== "system" && (
              <div className="pc-mmeta">
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: m.type === "me" ? "#a78bfa" : "#60a5fa",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontWeight: 600,
                    color: m.type === "me" ? "#c4b5fd" : "#93c5fd",
                  }}
                >
                  {m.sender}
                </span>
                <span style={{ marginLeft: "auto" }}>{m.time}</span>
              </div>
            )}
            <div className="pc-bubble">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="pc-chat-foot">
        <input
          className="pc-ci"
          placeholder="Message everyone…"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="pc-send" onClick={send}>
          <Ic n="Send" />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   KNOCK MODAL
───────────────────────────────────────── */
function KnockModal({
  a,
  onAccept,
  onDecline,
}: {
  a: PendingApproval;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="pc-knock-ov">
      <div className="pc-knock-card">
        <div className="pc-kav">{nameToEmoji(a.name)}</div>
        <div className="pc-kname">{a.name}</div>
        <div className="pc-kdev">Device: {a.device.slice(0, 16)}…</div>
        <div className="pc-klbl">
          Wants to join your private room.
          <br />
          Allow them in?
        </div>
        <div className="pc-kbtns">
          <button className="pc-accept" onClick={onAccept}>
            <Ic n="Check" />
            Accept
          </button>
          <button className="pc-decline" onClick={onDecline}>
            <Ic n="X2" />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MOBILE PANEL
───────────────────────────────────────── */
function MobPanel({
  open,
  tab,
  parts,
  myId,
  isAdmin,
  msgs,
  count,
  onKick,
  onSend,
  onClose,
  onTab,
}: {
  open: boolean;
  tab: string;
  parts: Participant[];
  myId: string;
  isAdmin: boolean;
  msgs: ChatMsg[];
  count: number;
  onKick: (id: string, n: string) => void;
  onSend: (t: string) => void;
  onClose: () => void;
  onTab: (t: string) => void;
}) {
  return (
    <>
      <div className={`pc-mob-back${open ? " open" : ""}`} onClick={onClose} />
      <div className={`pc-mob-panel${open ? " open" : ""}`}>
        <div className="pc-mob-handle" />
        <div className="pc-mob-head">
          <div style={{ display: "flex", gap: 7 }}>
            {["people", "chat"].map((t) => (
              <button
                key={t}
                onClick={() => onTab(t)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "1px solid",
                  fontSize: ".73rem",
                  fontWeight: 600,
                  background:
                    tab === t ? "rgba(109,40,217,.25)" : "transparent",
                  borderColor:
                    tab === t
                      ? "rgba(167,139,250,.4)"
                      : "rgba(255,255,255,.09)",
                  color: tab === t ? "#c4b5fd" : "rgba(240,238,255,.5)",
                  cursor: "pointer",
                }}
              >
                {t === "people" ? `People (${count})` : "Chat"}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(240,238,255,.3)",
              display: "flex",
            }}
          >
            <Ic n="X" />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {tab === "people" ? (
            <PeoplePanel
              parts={parts}
              myId={myId}
              isAdmin={isAdmin}
              onKick={onKick}
            />
          ) : (
            <ChatPanel msgs={msgs} onSend={onSend} />
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────
   HOME SCREEN
───────────────────────────────────────── */
function HomeScreen({
  onCreate,
  onJoin,
}: {
  onCreate: (n: string) => void;
  onJoin: (n: string, l: string) => void;
}) {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("room");
    if (p) setLink(window.location.href);
  }, []);
  return (
    <div className="pc-center">
      <div className="pc-amb" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div className="pc-orb">🛡️</div>
          <div className="pc-title">PrivateChat</div>
          <div
            style={{
              display: "flex",
              gap: 7,
              justifyContent: "center",
              marginTop: 9,
              flexWrap: "wrap",
            }}
          >
            <span className="pc-badge">🔒 Encrypted</span>
            <span className="pc-badge">👥 Multi-user</span>
            <span className="pc-badge">📡 P2P</span>
          </div>
        </div>
        <div className="pc-card">
          <p
            style={{
              fontSize: ".62rem",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(240,238,255,.28)",
              marginBottom: 18,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 18,
                height: 1,
                background: "#a78bfa",
                opacity: 0.5,
                display: "inline-block",
              }}
            />
            Start a Session
          </p>
          <div className="pc-iw">
            <span className="pc-iw-icon">
              <Ic n="User" />
            </span>
            <input
              className="pc-input"
              placeholder="Your display name…"
              maxLength={24}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCreate(name)}
            />
          </div>
          <button className="pc-btn-p" onClick={() => onCreate(name)}>
            <Ic n="Plus" />
            Create Private Room
          </button>
          <div className="pc-divider">or join existing</div>
          <div className="pc-iw">
            <span className="pc-iw-icon">
              <Ic n="Link" />
            </span>
            <input
              className="pc-input"
              placeholder="Paste invite link or Room ID…"
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onJoin(name, link)}
            />
          </div>
          <button className="pc-btn-s" onClick={() => onJoin(name, link)}>
            <Ic n="LogIn" />
            Join Room
          </button>
          <div className="pc-trust">
            {[
              ["🔐", "Encrypted"],
              ["🚫", "No Servers"],
              ["📵", "No Logs"],
            ].map(([ic, lbl]) => (
              <div key={lbl} className="pc-trust-item">
                <div className="pc-trust-icon">{ic}</div>
                <span className="pc-trust-label">{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   WAIT SCREEN
───────────────────────────────────────── */
function WaitScreen({
  link,
  onEnter,
  onCancel,
}: {
  link: string;
  onEnter: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };
  return (
    <div className="pc-center">
      <div className="pc-amb" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          width: "100%",
          maxWidth: 440,
          textAlign: "center",
        }}
      >
        <div className="pc-wait-orb">🏠</div>
        <div>
          <h2
            style={{
              fontStyle: "italic",
              fontSize: "clamp(1.4rem,6vw,2rem)",
              color: "#f0eeff",
              marginBottom: 7,
            }}
          >
            Room Ready!
          </h2>
          <p
            style={{
              fontSize: ".8rem",
              color: "rgba(240,238,255,.55)",
              lineHeight: 1.7,
              maxWidth: 320,
            }}
          >
            Share the invite link. Guests knock — you approve each request from
            inside the room.
          </p>
        </div>
        <div className="pc-link-box">{link || "Generating secure link…"}</div>
        <button className="pc-copy-btn" onClick={copy}>
          <Ic n={copied ? "Check" : "Copy"} />
          {copied ? "Copied!" : "Copy Invite Link"}
        </button>
        <p
          style={{
            fontSize: ".67rem",
            color: "rgba(240,238,255,.28)",
            lineHeight: 1.7,
          }}
        >
          🔒 Only you (admin) can approve or remove participants
        </p>
        <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 420 }}>
          <button
            className="pc-btn-p"
            onClick={onEnter}
            disabled={!link}
            style={{ flex: 1 }}
          >
            <Ic n="Door" />
            Enter Room
          </button>
          <button className="pc-btn-s" onClick={onCancel} style={{ flex: 1 }}>
            <Ic n="X" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   CONNECTING SCREEN
───────────────────────────────────────── */
function ConnectingScreen({ msg }: { msg: string }) {
  return (
    <div className="pc-center">
      <div className="pc-amb" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          textAlign: "center",
        }}
      >
        <div className="pc-spinner" />
        <h2
          style={{ fontStyle: "italic", fontSize: "1.35rem", color: "#f0eeff" }}
        >
          Connecting…
        </h2>
        <p style={{ fontSize: ".8rem", color: "rgba(240,238,255,.55)" }}>
          {msg}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   ROOM SCREEN
───────────────────────────────────────── */
function RoomScreen({
  parts,
  myId,
  isAdmin,
  msgs,
  micOn,
  camOn,
  speakerOn,
  knock,
  onMic,
  onCam,
  onSpeaker,
  onLeave,
  onKick,
  onSend,
  onAccept,
  onDecline,
}: {
  parts: Participant[];
  myId: string;
  isAdmin: boolean;
  msgs: ChatMsg[];
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  knock: PendingApproval | null;
  onMic: () => void;
  onCam: () => void;
  onSpeaker: () => void;
  onLeave: () => void;
  onKick: (id: string, n: string) => void;
  onSend: (t: string) => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [tab, setTab] = useState<"people" | "chat">("people");
  const [mobOpen, setMobOpen] = useState(false);
  const [mobTab, setMobTab] = useState("people");
  const count = parts.length;

  const gridCls = count <= 6 ? `pc-vgrid pc-g${count}` : "pc-vgrid pc-gmany";

  return (
    <div className="pc-room-wrap">
      {/* ── Video Area ── */}
      <div className="pc-video-area">
        <div className={gridCls}>
          {parts.map((p) => (
            <VideoTile
              key={p.peerId}
              p={p}
              isSelf={p.peerId === myId}
              isAdminUser={p.peerId === myId && isAdmin}
            />
          ))}
        </div>

        {/* header */}
        <div className="pc-rh">
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div className="pc-enc-pill">
              <Ic n="Lock" />
              E2E Encrypted
            </div>
            <span className="pc-cnt-pill">
              {count} participant{count !== 1 ? "s" : ""}
            </span>
          </div>
          {isAdmin && (
            <div className="pc-adm-pill">
              <Ic n="Crown" />
              Admin
            </div>
          )}
        </div>

        {/* knock overlay */}
        {knock && (
          <KnockModal a={knock} onAccept={onAccept} onDecline={onDecline} />
        )}

        {/* mobile FABs */}
        <div className="pc-fabs">
          <button
            className="pc-fab"
            onClick={() => {
              setMobTab("people");
              setMobOpen(true);
            }}
          >
            <Ic n="Users" />
            <span className="pc-fab-bdg">{count}</span>
          </button>
          <button
            className="pc-fab"
            onClick={() => {
              setMobTab("chat");
              setMobOpen(true);
            }}
          >
            <Ic n="Chat" />
          </button>
        </div>

        {/* mobile panel */}
        <MobPanel
          open={mobOpen}
          tab={mobTab}
          parts={parts}
          myId={myId}
          isAdmin={isAdmin}
          msgs={msgs}
          count={count}
          onKick={onKick}
          onSend={onSend}
          onClose={() => setMobOpen(false)}
          onTab={setMobTab}
        />
      </div>

      {/* ── Sidebar ── */}
      <div className="pc-sidebar">
        <div className="pc-tabs">
          <button
            className={`pc-tab${tab === "people" ? " act" : ""}`}
            onClick={() => setTab("people")}
          >
            <Ic n="Users" />
            People<span className="pc-tab-bdg">{count}</span>
          </button>
          <button
            className={`pc-tab${tab === "chat" ? " act" : ""}`}
            onClick={() => setTab("chat")}
          >
            <Ic n="Chat" />
            Chat
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {tab === "people" ? (
            <PeoplePanel
              parts={parts}
              myId={myId}
              isAdmin={isAdmin}
              onKick={onKick}
            />
          ) : (
            <ChatPanel msgs={msgs} onSend={onSend} />
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="pc-ctrl">
        {[
          {
            n: micOn ? "Mic" : "MicOff",
            off: !micOn,
            fn: onMic,
            lbl: micOn ? "Mute" : "Muted",
          },
          {
            n: camOn ? "Cam" : "CamOff",
            off: !camOn,
            fn: onCam,
            lbl: camOn ? "Camera" : "Off",
          },
          {
            n: speakerOn ? "Vol" : "VolOff",
            off: !speakerOn,
            fn: onSpeaker,
            lbl: "Speaker",
          },
        ].map((b) => (
          <div key={b.n} className="pc-cw">
            <button className={`pc-cb${b.off ? " off" : ""}`} onClick={b.fn}>
              <Ic n={b.n} />
            </button>
            <span className="pc-cl">{b.lbl}</span>
          </div>
        ))}
        <div className="pc-cw">
          <button className="pc-end" onClick={onLeave}>
            <Ic n="Phone" />
          </button>
          <span className="pc-cl" style={{ color: "#f87171" }}>
            Leave
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
export default function PrivateChat() {
  useEffect(() => {
    injectStyles();
  }, []);

  const [screen, setScreen] = useState<Screen>("home");
  const [toast, setToast] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [connectMsg, setConnectMsg] = useState("");
  const [parts, setParts] = useState<Participant[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingQ, setPendingQ] = useState<PendingApproval[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const myIdRef = useRef("");
  const myNameRef = useRef("");
  const isAdminRef = useRef(false);
  const localRef = useRef<MediaStream | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestConns = useRef<Map<string, DataConnection>>(new Map());
  const guestCalls = useRef<Map<string, MediaConnection>>(new Map());
  const hostConn = useRef<DataConnection | null>(null);
  const outCalls = useRef<Map<string, MediaConnection>>(new Map());
  const partsRef = useRef<Participant[]>([]);
  const micRef = useRef(true);
  const camRef = useRef(true);

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);
  useEffect(() => {
    micRef.current = micOn;
  }, [micOn]);
  useEffect(() => {
    camRef.current = camOn;
  }, [camOn]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const addMsg = useCallback(
    (text: string, type: ChatMsg["type"] = "system", sender = "") => {
      setMsgs((prev) => [
        ...prev,
        { id: uid(), text, type, sender, time: nowTime() },
      ]);
    },
    [],
  );

  const upsertPart = useCallback((p: Participant) => {
    setParts((prev) => {
      const i = prev.findIndex((x) => x.peerId === p.peerId);
      if (i >= 0) {
        const n = [...prev];
        n[i] = { ...n[i], ...p };
        return n;
      }
      return [...prev, p];
    });
  }, []);

  const updatePart = useCallback((peerId: string, u: Partial<Participant>) => {
    setParts((prev) =>
      prev.map((p) => (p.peerId === peerId ? { ...p, ...u } : p)),
    );
  }, []);

  const removePart = useCallback((peerId: string) => {
    setParts((prev) => prev.filter((p) => p.peerId !== peerId));
  }, []);

  const broadcast = useCallback((data: object, exclude?: string) => {
    guestConns.current.forEach((conn, pid) => {
      if (pid !== exclude && conn.open)
        try {
          conn.send(data);
        } catch {}
    });
  }, []);

  const handleGuestData = useCallback(
    (data: any, conn: DataConnection, gPeerId: string) => {
      if (data.type === "join-request") {
        if (partsRef.current.length >= 9) {
          conn.send({ type: "rejected", reason: "Room is full" });
          return;
        }
        guestConns.current.set(gPeerId, conn);
        setPendingQ((q) => [
          ...q,
          { peerId: gPeerId, name: data.name, device: data.deviceId, conn },
        ]);
      } else if (data.type === "chat") {
        addMsg(data.text, "them", data.name);
        broadcast(
          { type: "relay-chat", text: data.text, name: data.name },
          gPeerId,
        );
      } else if (data.type === "status-update") {
        updatePart(gPeerId, { micOn: data.micOn, camOn: data.camOn });
        broadcast(
          {
            type: "peer-status",
            peerId: gPeerId,
            micOn: data.micOn,
            camOn: data.camOn,
          },
          gPeerId,
        );
      }
    },
    [addMsg, broadcast, updatePart],
  );

  const acceptGuest = useCallback(
    (ap: PendingApproval) => {
      const currentList = partsRef.current.map((p) => ({
        peerId: p.peerId,
        name: p.name,
        isAdmin: p.isAdmin,
      }));
      ap.conn.send({
        type: "accepted",
        hostName: myNameRef.current,
        hostPeerId: myIdRef.current,
        participants: currentList,
      });
      broadcast(
        { type: "new-peer", peerId: ap.peerId, name: ap.name },
        ap.peerId,
      );
      upsertPart({
        peerId: ap.peerId,
        name: ap.name,
        isAdmin: false,
        stream: null,
        micOn: true,
        camOn: true,
      });
      addMsg(`${ap.name} joined the room`, "system");
      showToast(`✓ ${ap.name} joined`);
    },
    [broadcast, upsertPart, addMsg, showToast],
  );

  const handleKick = useCallback(
    (targetId: string, targetName: string) => {
      const conn = guestConns.current.get(targetId);
      if (conn?.open)
        try {
          conn.send({ type: "kicked" });
        } catch {}
      setTimeout(() => {
        guestConns.current.get(targetId)?.close();
        guestConns.current.delete(targetId);
      }, 300);
      guestCalls.current.get(targetId)?.close();
      guestCalls.current.delete(targetId);
      removePart(targetId);
      broadcast({ type: "peer-left", peerId: targetId });
      addMsg(`${targetName} was removed`, "system");
      showToast(`Removed ${targetName}`);
    },
    [broadcast, removePart, addMsg, showToast],
  );

  function cleanup(notify = true) {
    localRef.current?.getTracks().forEach((t) => t.stop());
    outCalls.current.forEach((c) => {
      try {
        c.close();
      } catch {}
    });
    outCalls.current.clear();
    guestCalls.current.forEach((c) => {
      try {
        c.close();
      } catch {}
    });
    guestCalls.current.clear();
    guestConns.current.forEach((c) => {
      try {
        c.close();
      } catch {}
    });
    guestConns.current.clear();
    try {
      hostConn.current?.close();
    } catch {}
    hostConn.current = null;
    peerRef.current?.destroy();
    peerRef.current = null;
    localRef.current = null;
    setParts([]);
    setMsgs([]);
    setPendingQ([]);
    setScreen("home");
    if (notify) showToast("Left the room");
  }

  async function getMedia() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast("⚠ Camera requires HTTPS or localhost");
        return false;
      }
      try {
        localRef.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setCamOn(true);
      } catch {
        localRef.current = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
        setCamOn(false);
        camRef.current = false;
        showToast("No camera — mic only");
      }
      return true;
    } catch {
      showToast("Could not access camera or mic");
      return false;
    }
  }

  async function handleCreate(name: string) {
    myNameRef.current = name || "Host";
    isAdminRef.current = true;
    setIsAdmin(true);
    const ok = await getMedia();
    if (!ok) return;
    setScreen("wait");

    const peer = new Peer({ debug: 0 });
    peerRef.current = peer;

    peer.on("open", (id) => {
      myIdRef.current = id;
      setRoomLink(
        `${window.location.origin}${window.location.pathname}?room=${id}`,
      );

      peer.on("connection", (conn) => {
        const gPeerId = conn.peer;
        conn.on("data", (d) => handleGuestData(d as any, conn, gPeerId));
        conn.on("close", () => {
          guestConns.current.delete(gPeerId);
          const p = partsRef.current.find((x) => x.peerId === gPeerId);
          if (p) {
            removePart(gPeerId);
            broadcast({ type: "peer-left", peerId: gPeerId });
            addMsg(`${p.name} left`, "system");
          }
        });
      });

      peer.on("call", (call) => {
        call.answer(localRef.current!);
        guestCalls.current.set(call.peer, call);
        call.on("stream", (stream) => updatePart(call.peer, { stream }));
        call.on("close", () => {
          guestCalls.current.delete(call.peer);
          updatePart(call.peer, { stream: null });
        });
      });
    });

    peer.on("error", (e) => showToast(`Error: ${(e as any).type || e}`));
  }

  function enterRoom() {
    setParts([
      {
        peerId: myIdRef.current,
        name: myNameRef.current,
        isAdmin: true,
        stream: localRef.current,
        micOn: true,
        camOn: camRef.current,
      },
    ]);
    setScreen("room");
    addMsg("🔒 Room created — share the link to invite guests", "system");
  }

  async function handleJoin(name: string, link: string) {
    if (!link.trim()) {
      showToast("Paste an invite link or Room ID");
      return;
    }
    let id = "";
    try {
      const u = new URL(link);
      id = u.searchParams.get("room") ?? "";
    } catch {}
    if (!id) id = link.trim();
    if (!id) {
      showToast("Invalid link or Room ID");
      return;
    }

    myNameRef.current = name || "Guest";
    isAdminRef.current = false;
    setIsAdmin(false);
    const ok = await getMedia();
    if (!ok) return;
    setScreen("connecting");
    setConnectMsg("Connecting to room…");

    const peer = new Peer({ debug: 0 });
    peerRef.current = peer;

    peer.on("open", (myId) => {
      myIdRef.current = myId;
      setConnectMsg("Sending join request…");

      const conn = peer.connect(id, { reliable: true });
      hostConn.current = conn;

      conn.on("open", () => {
        conn.send({
          type: "join-request",
          name: myNameRef.current,
          peerId: myId,
          deviceId: DEVICE_ID,
        });
        setConnectMsg("Waiting for host approval…");
      });

      conn.on("data", (raw) => {
        const data = raw as any;
        if (data.type === "accepted") {
          const others: Participant[] = [
            {
              peerId: data.hostPeerId,
              name: data.hostName,
              isAdmin: true,
              stream: null,
              micOn: true,
              camOn: true,
            },
            ...(
              data.participants as {
                peerId: string;
                name: string;
                isAdmin: boolean;
              }[]
            ).map((p) => ({ ...p, stream: null, micOn: true, camOn: true })),
          ].filter((p) => p.peerId !== myId);

          const self: Participant = {
            peerId: myId,
            name: myNameRef.current,
            isAdmin: false,
            stream: localRef.current,
            micOn: true,
            camOn: camRef.current,
          };
          setParts([self, ...others]);
          setScreen("room");
          addMsg("🔒 Encrypted call started", "system");

          others.forEach((p) => {
            if (!peerRef.current) return;
            const call = peerRef.current.call(p.peerId, localRef.current!);
            outCalls.current.set(p.peerId, call);
            call.on("stream", (stream) => updatePart(p.peerId, { stream }));
            call.on("close", () => {
              outCalls.current.delete(p.peerId);
              updatePart(p.peerId, { stream: null });
            });
          });
        } else if (data.type === "rejected") {
          showToast(`Request declined: ${data.reason ?? "by host"}`);
          localRef.current?.getTracks().forEach((t) => t.stop());
          peerRef.current?.destroy();
          setScreen("home");
        } else if (data.type === "new-peer") {
          upsertPart({
            peerId: data.peerId,
            name: data.name,
            isAdmin: false,
            stream: null,
            micOn: true,
            camOn: true,
          });
          addMsg(`${data.name} joined`, "system");
        } else if (data.type === "peer-left") {
          const p = partsRef.current.find((x) => x.peerId === data.peerId);
          if (p) addMsg(`${p.name} left`, "system");
          removePart(data.peerId);
          outCalls.current.get(data.peerId)?.close();
          outCalls.current.delete(data.peerId);
        } else if (data.type === "relay-chat") {
          addMsg(data.text, "them", data.name);
        } else if (data.type === "peer-status") {
          updatePart(data.peerId, { micOn: data.micOn, camOn: data.camOn });
        } else if (data.type === "kicked") {
          showToast("You were removed by the admin");
          cleanup(false);
        }
      });

      conn.on("close", () => {
        showToast("Disconnected from room");
        cleanup(false);
      });
    });

    peer.on("call", (call) => {
      call.answer(localRef.current!);
      outCalls.current.set(call.peer, call);
      call.on("stream", (stream) => updatePart(call.peer, { stream }));
      call.on("close", () => {
        outCalls.current.delete(call.peer);
        updatePart(call.peer, { stream: null });
      });
    });

    peer.on("error", (e) => {
      showToast(`Error: ${(e as any).type || e}`);
      setScreen("home");
    });
  }

  const handleSend = useCallback(
    (text: string) => {
      if (isAdminRef.current) {
        broadcast({ type: "relay-chat", text, name: myNameRef.current });
      } else {
        try {
          hostConn.current?.send({
            type: "chat",
            text,
            name: myNameRef.current,
          });
        } catch {}
      }
      addMsg(text, "me", myNameRef.current);
    },
    [broadcast, addMsg],
  );

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    micRef.current = next;
    localRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    updatePart(myIdRef.current, { micOn: next });
    const s = { type: "status-update", micOn: next, camOn: camRef.current };
    if (isAdminRef.current)
      broadcast({ ...s, type: "peer-status", peerId: myIdRef.current });
    else
      try {
        hostConn.current?.send(s);
      } catch {}
    showToast(next ? "Mic on" : "Mic muted");
  };

  const toggleCam = () => {
    const next = !camOn;
    setCamOn(next);
    camRef.current = next;
    localRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    updatePart(myIdRef.current, { camOn: next });
    const s = { type: "status-update", micOn: micRef.current, camOn: next };
    if (isAdminRef.current)
      broadcast({ ...s, type: "peer-status", peerId: myIdRef.current });
    else
      try {
        hostConn.current?.send(s);
      } catch {}
    showToast(next ? "Camera on" : "Camera off");
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    document
      .querySelectorAll<HTMLVideoElement>(".pc-tile:not(.pc-self) video")
      .forEach((v) => {
        v.muted = !next;
      });
    showToast(next ? "Speaker on" : "Speaker off");
  };

  const handleAccept = () => {
    const [first, ...rest] = pendingQ;
    if (!first) return;
    acceptGuest(first);
    setPendingQ(rest);
  };

  const handleDecline = () => {
    const [first, ...rest] = pendingQ;
    if (!first) return;
    try {
      first.conn.send({ type: "rejected", reason: "declined" });
    } catch {}
    guestConns.current.delete(first.peerId);
    setPendingQ(rest);
    showToast("Request declined");
  };

  return (
    <div id="pc-wrap">
      {screen === "home" && (
        <HomeScreen onCreate={handleCreate} onJoin={handleJoin} />
      )}
      {screen === "wait" && (
        <WaitScreen
          link={roomLink}
          onEnter={enterRoom}
          onCancel={() => {
            peerRef.current?.destroy();
            localRef.current?.getTracks().forEach((t) => t.stop());
            setScreen("home");
          }}
        />
      )}
      {screen === "connecting" && <ConnectingScreen msg={connectMsg} />}
      {screen === "room" && (
        <RoomScreen
          parts={parts}
          myId={myIdRef.current}
          isAdmin={isAdmin}
          msgs={msgs}
          micOn={micOn}
          camOn={camOn}
          speakerOn={speakerOn}
          knock={pendingQ[0] ?? null}
          onMic={toggleMic}
          onCam={toggleCam}
          onSpeaker={toggleSpeaker}
          onLeave={() => cleanup(true)}
          onKick={handleKick}
          onSend={handleSend}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}
      <div className={`pc-toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
