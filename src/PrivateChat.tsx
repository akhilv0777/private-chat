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
type Screen = "home" | "wait" | "connecting" | "room" | "random";

interface Participant {
  peerId: string;
  name: string;
  isAdmin: boolean;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  avatar?: string;
}

interface ChatMsg {
  id: string;
  text: string;
  type: "me" | "them" | "system";
  sender: string;
  senderPeerId?: string;
  time: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "pdf";
  mediaName?: string;
  viewOnce?: boolean;
  viewed?: boolean;
}

interface PendingApproval {
  peerId: string;
  name: string;
  device: string;
  conn: DataConnection;
}

interface MyProfile {
  name: string;
  avatar: string;       // emoji or base64 photo
  avatarIsPhoto: boolean;
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const DEVICE_ID: string = (() => {
  const key = "pc_did_v3";
  let id = localStorage.getItem(key);
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(key, id); }
  return id;
})();

const EMOJIS = ["🌸","💫","🌙","⭐","🦋","🌺","💎","🔥","🌊","🎭","🦊","🐬","🦁","🎨","🚀","🌿","🍀","✨","🎯","🦄","🐼","🦅","🌈","🎸","🏆","🍎","🎪","🌻","🐉","🦉"];

function nameToEmoji(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return EMOJIS[h % EMOJIS.length];
}
function nowTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}
function uid() { return Math.random().toString(36).slice(2); }

async function compressImage(dataUrl: string, maxKB = 350): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      let q = 0.88;
      const compress = (): string => {
        const r = canvas.toDataURL("image/jpeg", q);
        if (r.length > maxKB * 1024 * 1.37 && q > 0.15) { q -= 0.1; return compress(); }
        return r;
      };
      resolve(compress());
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ─────────────────────────────────────────
   STYLES
───────────────────────────────────────── */
const CSS = `
  html,body{margin:0;padding:0;height:100%;overflow:hidden}
  #pc-wrap{position:fixed;inset:0;background:#070610;color:#f0eeff;font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
  #pc-wrap *,#pc-wrap *::before,#pc-wrap *::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  #pc-wrap button{cursor:pointer;font-family:inherit}
  #pc-wrap input,#pc-wrap textarea{font-family:inherit}

  .pc-amb{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 65% 50% at 15% 10%,rgba(109,40,217,.13) 0%,transparent 70%),radial-gradient(ellipse 50% 60% at 85% 85%,rgba(139,92,246,.08) 0%,transparent 70%)}

  /* ── CENTER SCREENS ── */
  .pc-center{flex:1;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden auto}

  .pc-orb{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa,#c4b5fd);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;box-shadow:0 0 0 1px rgba(167,139,250,.25),0 0 50px rgba(109,40,217,.5);animation:pcFloat 4s ease-in-out infinite;position:relative}
  .pc-orb::after{content:'';position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(from 0deg,rgba(167,139,250,.6),transparent 60%,rgba(109,40,217,.6),transparent 60%);animation:pcSpin 5s linear infinite;mask:radial-gradient(farthest-side,transparent calc(100% - 2px),white calc(100% - 2px));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),white calc(100% - 2px))}
  @keyframes pcFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
  @keyframes pcSpin{to{transform:rotate(360deg)}}
  @keyframes pcPulse{0%,100%{box-shadow:0 0 40px rgba(109,40,217,.2);transform:scale(1)}50%{box-shadow:0 0 70px rgba(109,40,217,.4);transform:scale(1.07)}}
  @keyframes pcSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pcFadeIn{from{opacity:0}to{opacity:1}}
  @keyframes pcPing{0%{transform:scale(1);opacity:.8}80%,100%{transform:scale(2);opacity:0}}

  .pc-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:clamp(18px,5vw,32px);width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07);position:relative;overflow:hidden}
  .pc-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.45),transparent)}
  .pc-title{font-style:italic;font-size:clamp(2rem,8vw,3rem);letter-spacing:-.03em;background:linear-gradient(135deg,#f0eeff 30%,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:6px}
  .pc-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);font-size:.62rem;color:#c4b5fd;letter-spacing:.12em;text-transform:uppercase;font-weight:500}
  .pc-iw{position:relative;margin-bottom:10px}
  .pc-iw-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:rgba(240,238,255,.3);pointer-events:none;display:flex}
  .pc-input{width:100%;padding:13px 14px 13px 40px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:#f0eeff;font-size:.88rem;outline:none;transition:all .2s;caret-color:#a78bfa}
  .pc-input:focus{border-color:rgba(167,139,250,.5);background:rgba(167,139,250,.05);box-shadow:0 0 0 3px rgba(167,139,250,.08)}
  .pc-input::placeholder{color:rgba(240,238,255,.28)}
  .pc-btn-p{width:100%;padding:14px 18px;border-radius:12px;border:none;background:linear-gradient(135deg,#6d28d9,#a78bfa);color:#fff;font-size:.88rem;font-weight:700;letter-spacing:.04em;transition:all .2s;box-shadow:0 4px 24px rgba(109,40,217,.4),inset 0 1px 0 rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;gap:8px}
  .pc-btn-p:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(109,40,217,.55)}
  .pc-btn-p:disabled{opacity:.45;cursor:not-allowed;transform:none}
  .pc-btn-s{width:100%;padding:13px 18px;border-radius:12px;background:transparent;border:1px solid rgba(255,255,255,.16);color:#f0eeff;font-size:.88rem;font-weight:600;letter-spacing:.04em;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}
  .pc-btn-s:hover{background:rgba(255,255,255,.07);border-color:rgba(167,139,250,.4);color:#c4b5fd}
  .pc-btn-rand{width:100%;padding:13px 18px;border-radius:12px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.25);color:#fbbf24;font-size:.88rem;font-weight:700;letter-spacing:.04em;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}
  .pc-btn-rand:hover{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.45)}
  .pc-divider{display:flex;align-items:center;gap:12px;margin:14px 0;color:rgba(240,238,255,.28);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}
  .pc-divider::before,.pc-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.09)}
  .pc-trust{display:flex;gap:14px;justify-content:center;margin-top:16px;flex-wrap:wrap}
  .pc-trust-item{display:flex;flex-direction:column;align-items:center;gap:4px}
  .pc-trust-icon{width:28px;height:28px;border-radius:50%;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.15);display:flex;align-items:center;justify-content:center;font-size:13px}
  .pc-trust-label{font-size:.57rem;color:rgba(240,238,255,.28);letter-spacing:.08em;text-transform:uppercase}

  /* profile picker */
  .pc-profile-row{display:flex;align-items:center;gap:12px;padding:11px 14px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.15);border-radius:14px;margin-bottom:14px;cursor:pointer;transition:all .2s;width:100%}
  .pc-profile-row:hover{background:rgba(167,139,250,.1);border-color:rgba(167,139,250,.3)}
  .pc-av-lg{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1.35rem;flex-shrink:0;overflow:hidden}
  .pc-av-lg img{width:100%;height:100%;object-fit:cover}

  /* wait screen */
  .pc-wait-orb{width:76px;height:76px;border-radius:50%;background:rgba(109,40,217,.2);border:1px solid rgba(167,139,250,.25);display:flex;align-items:center;justify-content:center;font-size:26px;animation:pcPulse 2.5s ease-in-out infinite;margin:0 auto}
  .pc-link-box{background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.2);border-radius:13px;padding:13px 16px;font-size:clamp(.57rem,2vw,.68rem);color:#c4b5fd;word-break:break-all;line-height:1.7;width:100%;font-family:monospace}
  .pc-copy-btn{display:flex;align-items:center;gap:7px;padding:10px 24px;border-radius:10px;border:1px solid rgba(167,139,250,.35);background:rgba(167,139,250,.1);color:#c4b5fd;font-size:.78rem;font-weight:600;letter-spacing:.05em;transition:all .2s}
  .pc-copy-btn:hover{background:rgba(167,139,250,.2);transform:translateY(-1px)}
  .pc-spinner{width:64px;height:64px;border-radius:50%;border:2px solid rgba(167,139,250,.1);border-top-color:#a78bfa;animation:pcSpin 1s linear infinite;margin:0 auto}

  /* ══════════ ROOM ══════════ */
  .pc-room-wrap{flex:1;display:grid;grid-template-columns:1fr 296px;grid-template-rows:1fr auto auto;overflow:hidden;min-height:0}

  /* video area */
  .pc-video-area{grid-column:1;grid-row:1;background:#06050e;position:relative;overflow:hidden;min-height:0}
  .pc-vgrid{width:100%;height:100%;display:grid;gap:4px;padding:4px}
  .pc-g1{grid-template-columns:1fr}
  .pc-g2{grid-template-columns:1fr 1fr}
  .pc-g3{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g5{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-g6{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr}
  .pc-gmany{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}

  /* tile */
  .pc-tile{position:relative;border-radius:10px;overflow:hidden;background:#0d0b1e;border:1px solid rgba(255,255,255,.07);min-height:80px}
  .pc-tile.pc-self{border-color:rgba(139,92,246,.35)}
  .pc-tile video{width:100%;height:100%;object-fit:cover;display:block}
  .pc-tile-ov{position:absolute;bottom:0;left:0;right:0;padding:8px 10px;background:linear-gradient(to top,rgba(0,0,0,.82),transparent);display:flex;align-items:center;justify-content:space-between}
  .pc-tile-name{font-size:.72rem;font-weight:600;color:#fff;display:flex;align-items:center;gap:5px}
  .pc-tile-icons{display:flex;gap:4px}
  .pc-tile-icon{width:20px;height:20px;border-radius:50%;background:rgba(239,68,68,.45);display:flex;align-items:center;justify-content:center}
  .pc-av-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
  .pc-av-ring{width:62px;height:62px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1.5rem;box-shadow:0 0 28px rgba(109,40,217,.4);overflow:hidden;flex-shrink:0}
  .pc-av-ring img{width:100%;height:100%;object-fit:cover}
  .pc-av-name{font-size:.74rem;color:rgba(240,238,255,.5);font-style:italic}
  /* self badge now at bottom-left above overlay */
  .pc-self-badge{position:absolute;bottom:38px;left:8px;padding:2px 8px;border-radius:20px;background:rgba(139,92,246,.22);border:1px solid rgba(167,139,250,.35);font-size:.56rem;color:#c4b5fd;letter-spacing:.06em;text-transform:uppercase;font-weight:600;z-index:2}
  .pc-adm-badge{background:rgba(109,40,217,.28);border-color:rgba(251,191,36,.45);color:#fde68a}
  /* screen share indicator */
  .pc-screen-badge{position:absolute;top:8px;right:8px;padding:3px 8px;border-radius:20px;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.3);font-size:.56rem;color:#4ade80;letter-spacing:.06em;text-transform:uppercase;font-weight:600;display:flex;align-items:center;gap:4px;z-index:6}

  /* room header */
  .pc-rh{position:absolute;top:0;left:0;right:0;z-index:5;padding:10px 14px;background:linear-gradient(to bottom,rgba(0,0,0,.58),transparent);display:flex;align-items:center;justify-content:space-between;pointer-events:none}
  .pc-enc-pill{display:flex;align-items:center;gap:4px;padding:3px 10px;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.2);border-radius:20px;font-size:.58rem;color:#4ade80;letter-spacing:.07em;text-transform:uppercase}
  .pc-cnt-pill{font-size:.7rem;color:rgba(255,255,255,.4)}
  .pc-adm-pill{display:flex;align-items:center;gap:4px;padding:3px 10px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);border-radius:20px;font-size:.63rem;color:#fbbf24}

  /* knock banner */
  .pc-knock-bar{grid-column:1;grid-row:2;background:rgba(12,10,26,.98);border-top:1px solid rgba(167,139,250,.18);display:flex;align-items:center;gap:10px;padding:9px 16px;animation:pcSlideUp .3s ease;flex-shrink:0}
  .pc-kav-sm{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;overflow:hidden}
  .pc-kav-sm img{width:100%;height:100%;object-fit:cover}
  .pc-ktxt{flex:1;min-width:0}
  .pc-ktxt strong{font-size:.8rem;color:#f0eeff;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pc-ktxt span{font-size:.65rem;color:rgba(240,238,255,.4)}
  .pc-knock-count{font-size:.62rem;color:#c4b5fd;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.2);border-radius:20px;padding:2px 8px;flex-shrink:0}
  .pc-kaccept{padding:7px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-size:.75rem;font-weight:700;transition:all .2s;display:flex;align-items:center;gap:5px;flex-shrink:0}
  .pc-kaccept:hover{transform:scale(1.04)}
  .pc-kdecline{padding:7px 12px;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.08);color:#f87171;font-size:.75rem;font-weight:700;transition:all .2s;display:flex;align-items:center;gap:5px;flex-shrink:0}
  .pc-kdecline:hover{background:rgba(248,113,113,.18)}

  /* sidebar */
  .pc-sidebar{grid-column:2;grid-row:1/4;background:rgba(6,5,14,.99);border-left:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .pc-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;overflow-x:auto;scrollbar-width:none}
  .pc-tabs::-webkit-scrollbar{display:none}
  .pc-tab{flex:1;min-width:56px;padding:12px 6px;font-size:.65rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(240,238,255,.28);border:none;background:transparent;display:flex;align-items:center;justify-content:center;gap:4px;position:relative;transition:color .2s;white-space:nowrap}
  .pc-tab.act{color:#c4b5fd}
  .pc-tab.act::after{content:'';position:absolute;bottom:0;left:15%;right:15%;height:2px;background:#a78bfa;border-radius:2px 2px 0 0}
  .pc-tab-bdg{background:#7c3aed;color:#fff;border-radius:10px;padding:1px 5px;font-size:.54rem;min-width:16px;text-align:center;line-height:1.4}

  /* people */
  .pc-people{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.15) transparent}
  .pc-people::-webkit-scrollbar{width:3px}
  .pc-people::-webkit-scrollbar-thumb{background:rgba(167,139,250,.15);border-radius:2px}
  .pc-pcard{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);transition:background .2s}
  .pc-pcard:hover{background:rgba(255,255,255,.07)}
  .pc-pcard.self{border-color:rgba(139,92,246,.2)}
  .pc-pav{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0;overflow:hidden}
  .pc-pav img{width:100%;height:100%;object-fit:cover}
  .pc-pinfo{flex:1;min-width:0}
  .pc-pname{font-size:.78rem;font-weight:600;color:#f0eeff;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pc-you{font-size:.52rem;color:#c4b5fd;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);padding:1px 5px;border-radius:7px;text-transform:uppercase;flex-shrink:0}
  .pc-admtag{font-size:.52rem;color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);padding:1px 5px;border-radius:7px;flex-shrink:0}
  .pc-pstatus{font-size:.62rem;color:rgba(240,238,255,.28);display:flex;align-items:center;gap:3px;margin-top:1px}
  .pc-pdot{width:5px;height:5px;border-radius:50%;background:#4ade80;flex-shrink:0}
  .pc-picons{display:flex;gap:2px}
  .pc-picon{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:rgba(240,238,255,.3)}
  .pc-picon.off{color:#f87171}
  .pc-adm-acts{display:flex;gap:3px;margin-left:2px}
  .pc-adm-btn{width:22px;height:22px;border-radius:6px;border:1px solid rgba(248,113,113,.22);background:rgba(248,113,113,.07);color:#f87171;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0}
  .pc-adm-btn:hover{background:rgba(248,113,113,.2);border-color:rgba(248,113,113,.5);transform:scale(1.1)}
  .pc-dm-btn{width:22px;height:22px;border-radius:6px;border:1px solid rgba(96,165,250,.22);background:rgba(96,165,250,.07);color:#60a5fa;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;position:relative}
  .pc-dm-btn:hover{background:rgba(96,165,250,.18);border-color:rgba(96,165,250,.4)}
  .pc-dm-dot{position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#ef4444;border:2px solid #06050e}
  .pc-kick{width:22px;height:22px;border-radius:6px;border:1px solid rgba(248,113,113,.22);background:rgba(248,113,113,.06);color:#f87171;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0}
  .pc-kick:hover{background:rgba(248,113,113,.2);border-color:rgba(248,113,113,.5);transform:scale(1.1)}

  /* chat */
  .pc-chat{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .pc-msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.15) transparent;min-height:0}
  .pc-msgs::-webkit-scrollbar{width:3px}
  .pc-msgs::-webkit-scrollbar-thumb{background:rgba(167,139,250,.15);border-radius:2px}
  .pc-msg{max-width:92%;word-break:break-word}
  .pc-msg.me{align-self:flex-end}
  .pc-msg.them{align-self:flex-start}
  .pc-msg.sys{align-self:center}
  .pc-bubble{padding:8px 11px;border-radius:12px;font-size:.77rem;line-height:1.5}
  .me .pc-bubble{background:linear-gradient(135deg,rgba(109,40,217,.42),rgba(139,92,246,.28));border:1px solid rgba(167,139,250,.22);color:#f0eeff;border-bottom-right-radius:3px}
  .them .pc-bubble{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#f0eeff;border-bottom-left-radius:3px}
  .sys .pc-bubble{background:transparent;border:none;color:rgba(240,238,255,.3);font-size:.64rem;font-style:italic;padding:2px 8px}
  .pc-mmeta{font-size:.57rem;color:rgba(240,238,255,.3);margin-bottom:3px;display:flex;align-items:center;gap:4px}
  .me .pc-mmeta{justify-content:flex-end}
  .pc-no-chat{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;opacity:.35}
  .pc-chat-foot{padding:9px 10px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:6px;flex-shrink:0}
  .pc-chat-row{display:flex;gap:6px;align-items:flex-end}
  .pc-ci{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:8px 11px;color:#f0eeff;font-size:.79rem;outline:none;transition:border-color .2s;caret-color:#a78bfa;resize:none;min-height:36px;max-height:80px;overflow-y:auto;line-height:1.4}
  .pc-ci:focus{border-color:rgba(167,139,250,.4)}
  .pc-ci::placeholder{color:rgba(240,238,255,.28)}
  .pc-send{width:34px;height:34px;border-radius:10px;border:none;background:linear-gradient(135deg,#6d28d9,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .2s;flex-shrink:0}
  .pc-send:hover{transform:scale(1.08)}
  .pc-attach{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:rgba(240,238,255,.5);display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0}
  .pc-attach:hover{background:rgba(167,139,250,.15);border-color:rgba(167,139,250,.3);color:#c4b5fd}
  .pc-vo-icon-btn{width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(240,238,255,.4);display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;position:relative}
  .pc-vo-icon-btn:hover{border-color:rgba(167,139,250,.4);color:#c4b5fd;background:rgba(167,139,250,.08)}
  .pc-vo-icon-btn.on{border-color:rgba(167,139,250,.6);color:#a78bfa;background:rgba(167,139,250,.15);box-shadow:0 0 10px rgba(167,139,250,.2)}
  .pc-media-img{max-width:100%;border-radius:9px;display:block;margin-top:5px;max-height:180px;object-fit:cover;cursor:pointer}
  .pc-media-video{max-width:100%;border-radius:9px;display:block;margin-top:5px;max-height:180px}
  .pc-pdf-card{display:flex;align-items:center;gap:9px;padding:9px 12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:10px;margin-top:5px;cursor:pointer;transition:background .2s}
  .pc-pdf-card:hover{background:rgba(255,255,255,.12)}
  .pc-pdf-icon{width:32px;height:32px;border-radius:8px;background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.1rem}
  .pc-pdf-name{font-size:.73rem;color:#f0eeff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pc-pdf-sub{font-size:.6rem;color:rgba(240,238,255,.35)}
  .pc-vo-btn{padding:6px 12px;border-radius:8px;border:1px solid rgba(167,139,250,.3);background:rgba(167,139,250,.1);color:#c4b5fd;font-size:.73rem;font-weight:600;transition:all .2s;display:flex;align-items:center;gap:5px;margin-top:5px;cursor:pointer}
  .pc-vo-btn:hover{background:rgba(167,139,250,.2)}

  /* lightbox */
  .pc-lb{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:pcFadeIn .18s ease}
  .pc-lb img{max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 0 60px rgba(0,0,0,.8)}

  /* controls */
  .pc-ctrl{grid-column:1;grid-row:3;background:rgba(4,3,11,.99);border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;gap:10px;padding:0 14px;min-height:68px;flex-shrink:0}
  .pc-cw{display:flex;flex-direction:column;align-items:center;gap:3px}
  .pc-cb{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#f0eeff;display:flex;align-items:center;justify-content:center;transition:all .2s;position:relative}
  .pc-cb:hover{background:rgba(255,255,255,.12);border-color:rgba(167,139,250,.4)}
  .pc-cb.off{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.3);color:#f87171}
  .pc-cb.active{background:rgba(74,222,128,.12);border-color:rgba(74,222,128,.35);color:#4ade80}
  .pc-cl{font-size:.52rem;color:rgba(240,238,255,.28);letter-spacing:.04em;text-transform:uppercase}
  .pc-end{width:48px;height:48px;border-radius:50%;border:none;background:linear-gradient(135deg,#991b1b,#ef4444);color:#fff;display:flex;align-items:center;justify-content:center;transition:all .2s;box-shadow:0 4px 20px rgba(239,68,68,.35)}
  .pc-end:hover{transform:scale(1.08);box-shadow:0 8px 30px rgba(239,68,68,.6)}

  /* modal */
  .pc-modal-ov{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;animation:pcFadeIn .18s ease}
  .pc-modal{background:rgba(9,7,20,.99);border:1px solid rgba(167,139,250,.2);border-radius:22px;padding:26px 22px;max-width:360px;width:100%;animation:pcSlideUp .3s ease;box-shadow:0 0 60px rgba(109,40,217,.15);position:relative;overflow:hidden;max-height:90vh;overflow-y:auto}
  .pc-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.5),transparent)}
  .pc-modal-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
  .pc-modal-h h3{margin:0;font-style:italic;font-size:1.1rem;color:#f0eeff}
  .pc-avatar-row{display:flex;flex-wrap:wrap;gap:7px;padding:10px;background:rgba(0,0,0,.3);border-radius:12px;border:1px solid rgba(255,255,255,.08);margin-bottom:12px}
  .pc-av-opt{width:36px;height:36px;border-radius:50%;border:2px solid transparent;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:1.1rem;transition:all .15s;cursor:pointer}
  .pc-av-opt:hover,.pc-av-opt.sel{border-color:#a78bfa;background:rgba(167,139,250,.15)}
  .pc-photo-wrap{width:88px;height:88px;position:relative;margin:0 auto 16px;cursor:pointer}
  .pc-photo-preview{width:88px;height:88px;border-radius:50%;border:2px solid rgba(167,139,250,.3);overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6d28d9,#a78bfa);font-size:2rem;transition:filter .2s}
  .pc-photo-wrap:hover .pc-photo-preview{filter:brightness(.7)}
  .pc-photo-preview img{width:100%;height:100%;object-fit:cover}
  .pc-cam-overlay{position:absolute;bottom:2px;right:2px;width:26px;height:26px;border-radius:50%;background:rgba(109,40,217,.9);border:2px solid rgba(6,5,14,1);display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none}
  .pc-share-icon-btn{width:30px;height:30px;border-radius:8px;border:1px solid rgba(167,139,250,.2);background:rgba(167,139,250,.07);color:rgba(167,139,250,.55);display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0}
  .pc-share-icon-btn:hover{background:rgba(167,139,250,.18);border-color:rgba(167,139,250,.45);color:#c4b5fd}

  /* DM panel */
  .pc-dm-panel{display:flex;flex-direction:column;height:100%;overflow:hidden}
  .pc-dm-header{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:9px;flex-shrink:0}
  .pc-dm-av{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6d28d9,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;overflow:hidden}
  .pc-dm-av img{width:100%;height:100%;object-fit:cover}
  .pc-dm-name{font-size:.8rem;font-weight:700;color:#f0eeff;flex:1}
  .pc-dm-close{background:transparent;border:none;color:rgba(240,238,255,.35);display:flex;padding:2px}

  /* random chat */
  .pc-rand-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px;text-align:center;position:relative}
  .pc-rand-orb{width:90px;height:90px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center;margin:0 auto}
  .pc-rand-ping{position:absolute;inset:0;border-radius:50%;background:rgba(251,191,36,.3);animation:pcPing 1.5s cubic-bezier(0,0,.2,1) infinite}
  .pc-rand-inner{width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#92400e,#fbbf24);display:flex;align-items:center;justify-content:center;font-size:2.2rem;box-shadow:0 0 40px rgba(251,191,36,.3)}

  /* toast */
  .pc-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:rgba(14,11,30,.97);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.13);border-radius:12px;padding:9px 18px;font-size:.77rem;color:#f0eeff;z-index:999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none}
  .pc-toast.show{transform:translateX(-50%) translateY(0)}

  /* mobile */
  .pc-fabs{display:none;position:absolute;bottom:80px;right:14px;flex-direction:column;gap:8px;z-index:20}
  .pc-fab{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(5,4,14,.88);backdrop-filter:blur(12px);color:#f0eeff;display:flex;align-items:center;justify-content:center;transition:all .2s;position:relative}
  .pc-fab:hover{background:rgba(255,255,255,.1)}
  .pc-fab-bdg{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;border-radius:8px;background:#7c3aed;color:#fff;font-size:.54rem;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #050414}
  .pc-mob-back{display:none;position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)}
  .pc-mob-panel{display:none;position:fixed;bottom:0;left:0;right:0;z-index:51;background:rgba(5,4,14,.99);border-top:1px solid rgba(255,255,255,.08);flex-direction:column;max-height:72%;border-radius:18px 18px 0 0}
  .pc-mob-handle{width:38px;height:3px;border-radius:2px;background:rgba(255,255,255,.15);margin:9px auto 4px}
  .pc-mob-head{display:flex;align-items:center;justify-content:space-between;padding:7px 14px 9px;border-bottom:1px solid rgba(255,255,255,.08)}

  @media (max-width:640px){
    .pc-room-wrap{grid-template-columns:1fr;grid-template-rows:1fr auto auto}
    .pc-sidebar{display:none}
    .pc-ctrl{grid-column:1;grid-row:3;gap:8px;padding:0 10px}
    .pc-knock-bar{grid-column:1;grid-row:2}
    .pc-fabs{display:flex}
    .pc-mob-panel.open{display:flex}
    .pc-mob-back.open{display:block}
    .pc-toast{bottom:90px}
    .pc-cb{width:40px;height:40px}
    .pc-end{width:44px;height:44px}
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
   ICONS
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
  Mic: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  MicOff: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  Cam: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  CamOff: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  Vol: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  VolOff: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  Phone: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><path d="M6.28 6.28A19.79 19.79 0 0 0 3 14.9 2 2 0 0 0 5 17h3a2 2 0 0 1 2-1.72 12.84 12.84 0 0 0 .7-2.81 2 2 0 0 1-.45-2.11L8.98 9.1"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  Kick: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  Users: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  Chat: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  Send: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  Door: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.307.956L4 18V4.38a1 1 0 0 1 .993-1L12 3a1 1 0 0 1 1 1z"/></svg>`,
  Lock: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  Crown: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg>`,
  Flip: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m15 9 3-3-3-3"/></svg>`,
  Image: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  Edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  Screen: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  DM: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></svg>`,
  Upload: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  Eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  Zap: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  ArrowLeft: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  ViewOnce: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`,
  CamSmall: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  ShareLink: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
};

const Ic = ({ n, style }: { n: string; style?: React.CSSProperties }) => (
  <span style={{ display: "inline-flex", alignItems: "center", ...style }} dangerouslySetInnerHTML={{ __html: SVG[n] ?? "" }} />
);

/* ─────────────────────────────────────────
   AVATAR DISPLAY
───────────────────────────────────────── */
function AvatarDisplay({ avatar, name, size = 34, fontSize = ".9rem" }: { avatar?: string; name: string; size?: number; fontSize?: string }) {
  const isPhoto = avatar?.startsWith("data:image");
  const emoji = !isPhoto ? (avatar || nameToEmoji(name)) : null;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg,#6d28d9,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize, flexShrink: 0, overflow: "hidden" }}>
      {isPhoto ? <img src={avatar} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" /> : <span>{emoji}</span>}
    </div>
  );
}

/* ─────────────────────────────────────────
   VIDEO TILE
───────────────────────────────────────── */
function VideoTile({ p, isSelf, isAdminUser, isScreenSharing }: { p: Participant; isSelf: boolean; isAdminUser: boolean; isScreenSharing?: boolean }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    if (p.stream) { el.srcObject = p.stream; el.play().catch(() => {}); }
    else el.srcObject = null;
  }, [p.stream]);

  const hasVideo = !!p.stream && p.camOn !== false;
  return (
    <div className={`pc-tile${isSelf ? " pc-self" : ""}`}>
      <video ref={vidRef} autoPlay playsInline muted={isSelf} style={{ width: "100%", height: "100%", objectFit: "cover", display: hasVideo ? "block" : "none", transform: (isSelf && !isScreenSharing) ? "scaleX(-1)" : "none" }} />
      {!hasVideo && (
        <div className="pc-av-center">
          <AvatarDisplay avatar={p.avatar} name={p.name} size={62} fontSize="1.5rem" />
          <div className="pc-av-name">{p.name}</div>
        </div>
      )}
      <div className="pc-tile-ov">
        <div className="pc-tile-name">
          {!p.avatar?.startsWith("data:image") && <span>{p.avatar || nameToEmoji(p.name)}</span>}
          <span>{p.name}</span>
          {p.isAdmin && <span style={{ fontSize: ".55rem", color: "#fbbf24" }}>👑</span>}
        </div>
        <div className="pc-tile-icons">
          {p.micOn === false && <div className="pc-tile-icon"><Ic n="MicOff" style={{ transform: "scale(.65)" }} /></div>}
          {p.camOn === false && <div className="pc-tile-icon"><Ic n="CamOff" style={{ transform: "scale(.65)" }} /></div>}
        </div>
      </div>
      {isSelf && <div className={`pc-self-badge${isAdminUser ? " pc-adm-badge" : ""}`}>{isAdminUser ? "👑 Admin (You)" : "You"}</div>}
      {isSelf && isScreenSharing && <div className="pc-screen-badge"><Ic n="Screen" />Screen</div>}
    </div>
  );
}

/* ─────────────────────────────────────────
   PEOPLE PANEL
───────────────────────────────────────── */
function PeoplePanel({ parts, myId, isAdmin, onKick, onForceMute, onForceCam, onDm, dmUnread, roomLink }: {
  parts: Participant[]; myId: string; isAdmin: boolean;
  onKick: (id: string, n: string) => void;
  onForceMute: (id: string) => void;
  onForceCam: (id: string) => void;
  onDm: (p: Participant) => void;
  dmUnread: Record<string, number>;
  roomLink?: string;
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const copyLink = () => {
    if (!roomLink) return;
    navigator.clipboard.writeText(roomLink).then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); });
  };
  return (
    <div className="pc-people">
      {parts.map((p) => {
        const isSelf = p.peerId === myId;
        const unread = dmUnread[p.peerId] ?? 0;
        return (
          <div key={p.peerId} className={`pc-pcard${isSelf ? " self" : ""}`}>
            <AvatarDisplay avatar={p.avatar} name={p.name} size={34} />
            <div className="pc-pinfo">
              <div className="pc-pname">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                {isSelf && <span className="pc-you">You</span>}
                {p.isAdmin && <span className="pc-admtag">👑 Admin</span>}
              </div>
              <div className="pc-pstatus"><span className="pc-pdot" /><span>Connected</span></div>
            </div>
            <div className="pc-picons">
              <div className={`pc-picon${p.micOn === false ? " off" : ""}`}><Ic n={p.micOn === false ? "MicOff" : "Mic"} /></div>
              <div className={`pc-picon${p.camOn === false ? " off" : ""}`}><Ic n={p.camOn === false ? "CamOff" : "Cam"} /></div>
            </div>
            {isSelf && roomLink && (
              <button className="pc-share-icon-btn" onClick={copyLink} title="Copy invite link">
                <Ic n={copiedLink ? "Check" : "ShareLink"} style={{ color: copiedLink ? "#4ade80" : undefined }} />
              </button>
            )}
            {!isSelf && (
              <div className="pc-adm-acts">
                <button className="pc-dm-btn" onClick={() => onDm(p)} title={`DM ${p.name}`}>
                  <Ic n="DM" />
                  {unread > 0 && <span className="pc-dm-dot" />}
                </button>
                {isAdmin && p.micOn !== false && (
                  <button className="pc-adm-btn" onClick={() => onForceMute(p.peerId)} title="Mute">
                    <Ic n="MicOff" />
                  </button>
                )}
                {isAdmin && p.camOn !== false && (
                  <button className="pc-adm-btn" onClick={() => onForceCam(p.peerId)} title="Disable camera">
                    <Ic n="CamOff" />
                  </button>
                )}
                {isAdmin && (
                  <button className="pc-kick" onClick={() => onKick(p.peerId, p.name)} title={`Remove ${p.name}`}>
                    <Ic n="Kick" />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   DM PANEL
───────────────────────────────────────── */
function DmPanel({ peer: dmPeer, msgs, onSend, onClose }: {
  peer: Participant; msgs: ChatMsg[];
  onSend: (text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [msgs]);

  const send = () => { if (!text.trim()) return; onSend(text.trim()); setText(""); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let mediaType: ChatMsg["mediaType"] = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "pdf" : "image";
    let dataUrl = await fileToBase64(file);
    if (mediaType === "image") dataUrl = await compressImage(dataUrl);
    onSend("", dataUrl, mediaType, file.name, viewOnce);
    e.target.value = "";
  };

  const [viewed, setViewed] = useState<Record<string, boolean>>({});

  return (
    <div className="pc-dm-panel">
      {lightbox && <div className="pc-lb" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /></div>}
      <div className="pc-dm-header">
        <button className="pc-dm-close" onClick={onClose}><Ic n="ArrowLeft" /></button>
        <AvatarDisplay avatar={dmPeer.avatar} name={dmPeer.name} size={30} />
        <div className="pc-dm-name">{dmPeer.name}</div>
        {dmPeer.isAdmin && <span style={{ fontSize: ".55rem", color: "#fbbf24" }}>👑</span>}
      </div>
      <div className="pc-msgs" ref={msgsRef} style={{ flex: 1, minHeight: 0 }}>
        {msgs.length === 0 && (
          <div className="pc-no-chat">
            <span style={{ fontSize: 22 }}>💬</span>
            <p style={{ fontSize: ".72rem", color: "rgba(240,238,255,.3)" }}>Private message — only visible to you two</p>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`pc-msg ${m.type === "system" ? "sys" : m.type}`}>
            {m.type !== "system" && (
              <div className="pc-mmeta">
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.type === "me" ? "#a78bfa" : "#60a5fa", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: m.type === "me" ? "#c4b5fd" : "#93c5fd" }}>{m.sender}</span>
                <span style={{ marginLeft: "auto" }}>{m.time}</span>
              </div>
            )}
            <div className="pc-bubble">
              {m.text && <span>{m.text}</span>}
              {m.mediaUrl && m.mediaType === "image" && (
                m.viewOnce && !viewed[m.id] ? (
                  <button className="pc-vo-btn" onClick={() => setViewed(v => ({ ...v, [m.id]: true }))}>
                    <Ic n="Eye" /> View once 📷
                  </button>
                ) : (viewed[m.id] || !m.viewOnce) && m.mediaUrl ? (
                  <img src={m.mediaUrl} className="pc-media-img" onClick={() => setLightbox(m.mediaUrl!)} alt="" />
                ) : null
              )}
              {m.mediaUrl && m.mediaType === "video" && <video src={m.mediaUrl} controls className="pc-media-video" />}
              {m.mediaUrl && m.mediaType === "pdf" && (
                <a href={m.mediaUrl} download={m.mediaName || "document.pdf"} style={{ textDecoration: "none" }}>
                  <div className="pc-pdf-card">
                    <div className="pc-pdf-icon">📄</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pc-pdf-name">{m.mediaName || "Document.pdf"}</div>
                      <div className="pc-pdf-sub">PDF • Tap to download</div>
                    </div>
                  </div>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="pc-chat-foot">
        <div className="pc-chat-row">
          <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" style={{ display: "none" }} onChange={handleFile} />
          <button className="pc-attach" onClick={() => fileRef.current?.click()} title="Attach file"><Ic n="Image" /></button>
          <input className="pc-ci" placeholder="Private message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className={`pc-vo-icon-btn${viewOnce ? " on" : ""}`} onClick={() => setViewOnce(v => !v)} title={viewOnce ? "View once ON" : "View once OFF"}>
            <Ic n="ViewOnce" />
          </button>
          <button className="pc-send" onClick={send}><Ic n="Send" /></button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   CHAT PANEL
───────────────────────────────────────── */
function ChatPanel({ msgs, onSend }: {
  msgs: ChatMsg[];
  onSend: (text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Record<string, boolean>>({});
  const msgsRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [msgs]);

  const send = () => { if (!text.trim()) return; onSend(text.trim()); setText(""); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let mediaType: ChatMsg["mediaType"] = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "pdf" : "image";
    let dataUrl = await fileToBase64(file);
    if (mediaType === "image") dataUrl = await compressImage(dataUrl);
    onSend("", dataUrl, mediaType, file.name, viewOnce);
    e.target.value = "";
  };

  return (
    <div className="pc-chat">
      {lightbox && <div className="pc-lb" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /></div>}
      <div className="pc-msgs" ref={msgsRef}>
        {msgs.length === 0 && (
          <div className="pc-no-chat">
            <Ic n="Chat" style={{ fontSize: 22, color: "rgba(240,238,255,.3)" }} />
            <p style={{ fontSize: ".72rem", color: "rgba(240,238,255,.3)" }}>No messages yet</p>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`pc-msg ${m.type === "system" ? "sys" : m.type}`}>
            {m.type !== "system" && (
              <div className="pc-mmeta">
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.type === "me" ? "#a78bfa" : "#60a5fa", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: m.type === "me" ? "#c4b5fd" : "#93c5fd" }}>{m.sender}</span>
                <span style={{ marginLeft: "auto" }}>{m.time}</span>
              </div>
            )}
            <div className="pc-bubble">
              {m.text && <span>{m.text}</span>}
              {m.mediaUrl && m.mediaType === "image" && (
                m.viewOnce && !viewed[m.id] ? (
                  <button className="pc-vo-btn" onClick={() => setViewed(v => ({ ...v, [m.id]: true }))}>
                    <Ic n="Eye" /> View once 📷
                  </button>
                ) : (viewed[m.id] || !m.viewOnce) && m.mediaUrl ? (
                  <img src={m.mediaUrl} className="pc-media-img" onClick={() => setLightbox(m.mediaUrl!)} alt="" />
                ) : null
              )}
              {m.mediaUrl && m.mediaType === "video" && <video src={m.mediaUrl} controls className="pc-media-video" />}
              {m.mediaUrl && m.mediaType === "pdf" && (
                <a href={m.mediaUrl} download={m.mediaName || "document.pdf"} style={{ textDecoration: "none" }}>
                  <div className="pc-pdf-card">
                    <div className="pc-pdf-icon">📄</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pc-pdf-name">{m.mediaName || "Document.pdf"}</div>
                      <div className="pc-pdf-sub">PDF • Tap to download</div>
                    </div>
                  </div>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="pc-chat-foot">
        <div className="pc-chat-row">
          <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" style={{ display: "none" }} onChange={handleFile} />
          <button className="pc-attach" onClick={() => fileRef.current?.click()} title="Attach"><Ic n="Image" /></button>
          <input className="pc-ci" placeholder="Message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className={`pc-vo-icon-btn${viewOnce ? " on" : ""}`} onClick={() => setViewOnce(v => !v)} title={viewOnce ? "View once ON" : "View once OFF"}>
            <Ic n="ViewOnce" />
          </button>
          <button className="pc-send" onClick={send}><Ic n="Send" /></button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   KNOCK BANNER
───────────────────────────────────────── */
function KnockBanner({ knock, queueLen, onAccept, onDecline }: { knock: PendingApproval; queueLen: number; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="pc-knock-bar">
      <div className="pc-kav-sm"><span>{nameToEmoji(knock.name)}</span></div>
      <div className="pc-ktxt">
        <strong>{knock.name}</strong>
        <span>wants to join</span>
      </div>
      {queueLen > 1 && <span className="pc-knock-count">+{queueLen - 1} more</span>}
      <button className="pc-kaccept" onClick={onAccept}><Ic n="Check" />Admit</button>
      <button className="pc-kdecline" onClick={onDecline}><Ic n="X2" />Deny</button>
    </div>
  );
}

/* ─────────────────────────────────────────
   PROFILE MODAL
───────────────────────────────────────── */
function ProfileModal({ profile, onSave, onClose }: { profile: MyProfile; onSave: (p: MyProfile) => void; onClose: () => void }) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [isPhoto, setIsPhoto] = useState(profile.avatarIsPhoto);
  const photoRef = useRef<HTMLInputElement>(null);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let url = await fileToBase64(file);
    url = await compressImage(url, 80);
    setAvatar(url);
    setIsPhoto(true);
  };

  const currentEmoji = isPhoto ? "" : (avatar || nameToEmoji(name));

  return (
    <div className="pc-modal-ov" onClick={onClose}>
      <div className="pc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pc-modal-h">
          <h3>Edit Profile</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(240,238,255,.4)", display: "flex" }}><Ic n="X" /></button>
        </div>
        <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
        <div className="pc-photo-wrap" onClick={() => photoRef.current?.click()} title="Tap to change photo">
          <div className="pc-photo-preview">
            {isPhoto && avatar ? <img src={avatar} alt="" /> : <span style={{ fontSize: "1.9rem" }}>{currentEmoji || nameToEmoji(name)}</span>}
          </div>
          <div className="pc-cam-overlay"><Ic n="CamSmall" /></div>
        </div>
        <p style={{ fontSize: ".65rem", color: "rgba(240,238,255,.3)", marginBottom: 8, letterSpacing: ".1em", textTransform: "uppercase" }}>Or pick emoji</p>
        <div className="pc-avatar-row">
          {EMOJIS.map((e, i) => (
            <button key={i} className={`pc-av-opt${(!isPhoto && avatar === e) ? " sel" : ""}`} onClick={() => { setAvatar(e); setIsPhoto(false); }}>{e}</button>
          ))}
        </div>
        <p style={{ fontSize: ".65rem", color: "rgba(240,238,255,.3)", marginBottom: 6, letterSpacing: ".1em", textTransform: "uppercase" }}>Display Name</p>
        <div className="pc-iw" style={{ marginBottom: 16 }}>
          <span className="pc-iw-icon"><Ic n="User" /></span>
          <input className="pc-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Your name…" />
        </div>
        <button className="pc-btn-p" onClick={() => { onSave({ name: name || "User", avatar, avatarIsPhoto: isPhoto }); onClose(); }}>
          <Ic n="Check" /> Save Profile
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MOBILE PANEL
───────────────────────────────────────── */
function MobPanel({ open, tab, parts, myId, isAdmin, msgs, count, onKick, onForceMute, onForceCam, onDm, dmUnread, activeDm, onSend, onClose, onTab }: {
  open: boolean; tab: string; parts: Participant[]; myId: string; isAdmin: boolean;
  msgs: ChatMsg[]; count: number; onKick: (id: string, n: string) => void;
  onForceMute: (id: string) => void; onForceCam: (id: string) => void;
  onDm: (p: Participant) => void; dmUnread: Record<string, number>;
  activeDm: Participant | null;
  onSend: (text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => void;
  onClose: () => void; onTab: (t: string) => void;
}) {
  return (
    <>
      <div className={`pc-mob-back${open ? " open" : ""}`} onClick={onClose} />
      <div className={`pc-mob-panel${open ? " open" : ""}`}>
        <div className="pc-mob-handle" />
        <div className="pc-mob-head">
          <div style={{ display: "flex", gap: 7 }}>
            {["people", "chat"].map((t) => (
              <button key={t} onClick={() => onTab(t)} style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", fontSize: ".73rem", fontWeight: 600, background: tab === t ? "rgba(109,40,217,.25)" : "transparent", borderColor: tab === t ? "rgba(167,139,250,.4)" : "rgba(255,255,255,.09)", color: tab === t ? "#c4b5fd" : "rgba(240,238,255,.5)", cursor: "pointer" }}>
                {t === "people" ? `People (${count})` : "Chat"}
              </button>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(240,238,255,.3)", display: "flex" }}><Ic n="X" /></button>
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab === "people"
            ? <PeoplePanel parts={parts} myId={myId} isAdmin={isAdmin} onKick={onKick} onForceMute={onForceMute} onForceCam={onForceCam} onDm={onDm} dmUnread={dmUnread} />
            : <ChatPanel msgs={msgs} onSend={onSend} />
          }
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────
   RANDOM CHAT SCREEN
───────────────────────────────────────── */
function RandomChatScreen({ profile, onBack }: { profile: MyProfile; onBack: () => void }) {
  const [phase, setPhase] = useState<"idle" | "searching" | "connected">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const localVidRef = useRef<HTMLVideoElement>(null);
  const remoteVidRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  useLayoutEffect(() => {
    if (localVidRef.current && localRef.current) { localVidRef.current.srcObject = localRef.current; localVidRef.current.play().catch(() => {}); }
  }, [phase]);

  useLayoutEffect(() => {
    if (remoteVidRef.current && remoteRef.current) { remoteVidRef.current.srcObject = remoteRef.current; remoteVidRef.current.play().catch(() => {}); }
  }, [remoteRef.current]);

  function cleanup() {
    localRef.current?.getTracks().forEach(t => t.stop());
    callRef.current?.close();
    connRef.current?.close();
    peerRef.current?.destroy();
    localRef.current = null;
    remoteRef.current = null;
    callRef.current = null;
    connRef.current = null;
    peerRef.current = null;
  }

  function addMsg(text: string, type: ChatMsg["type"] = "system", sender = "") {
    if (!mountedRef.current) return;
    setMsgs(prev => [...prev, { id: uid(), text, type, sender, time: nowTime() }]);
  }

  async function startSearch() {
    setPhase("searching");
    setStatusMsg("Accessing camera…");

    try {
      localRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      try {
        localRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch {
        setStatusMsg("Could not access camera/mic");
        setPhase("idle");
        return;
      }
    }

    const slot = Math.floor(Date.now() / 45000);
    const peer = new Peer({ debug: 0 });
    peerRef.current = peer;

    peer.on("open", async () => {
      if (!mountedRef.current) return;
      setStatusMsg("Finding a match…");

      // Try to connect to someone in this time slot
      let found = false;
      for (let i = 0; i < 12 && !found; i++) {
        const targetId = `pc-rnd-${slot}-${i}`;
        if (targetId === peer.id) continue;
        try {
          await new Promise<void>((res, rej) => {
            const c = peer.connect(targetId, { reliable: true });
            const t = setTimeout(() => rej("timeout"), 1800);
            c.on("open", () => {
              clearTimeout(t);
              connRef.current = c;
              found = true;
              c.send({ type: "rc-hello", name: profile.name, avatar: profile.avatar });
              c.on("data", handleData);
              c.on("close", () => { if (mountedRef.current) { addMsg("Stranger disconnected", "system"); setPhase("idle"); } });
              // Call them
              const call = peer.call(targetId, localRef.current!);
              callRef.current = call;
              call.on("stream", (stream) => {
                remoteRef.current = stream;
                if (remoteVidRef.current) { remoteVidRef.current.srcObject = stream; remoteVidRef.current.play().catch(() => {}); }
              });
              setPhase("connected");
              addMsg("🎉 Connected to a stranger! Say hi.", "system");
              res();
            });
            c.on("error", () => { clearTimeout(t); rej("error"); });
          });
        } catch {}
      }

      if (!found) {
        // Become host — wait for connection
        setStatusMsg("Waiting for someone… (stays open for 45s)");
        const mySlotId = `pc-rnd-${slot}-${Math.floor(Math.random() * 12)}`;

        // Can't set custom ID with free PeerJS server, so just wait for incoming
        peer.on("connection", (c) => {
          connRef.current = c;
          c.on("open", () => {
            c.send({ type: "rc-hello", name: profile.name, avatar: profile.avatar });
            c.on("data", handleData);
            c.on("close", () => { if (mountedRef.current) { addMsg("Stranger disconnected", "system"); setPhase("idle"); } });
            if (mountedRef.current) {
              setPhase("connected");
              addMsg("🎉 Connected to a stranger! Say hi.", "system");
            }
          });
        });
        peer.on("call", (call) => {
          callRef.current = call;
          call.answer(localRef.current!);
          call.on("stream", (stream) => {
            remoteRef.current = stream;
            if (remoteVidRef.current) { remoteVidRef.current.srcObject = stream; remoteVidRef.current.play().catch(() => {}); }
          });
        });

        // Countdown to next slot
        let remaining = 45 - (Math.floor(Date.now() / 1000) % 45);
        setCountdown(remaining);
        const t = setInterval(() => {
          remaining--;
          if (!mountedRef.current) { clearInterval(t); return; }
          setCountdown(remaining);
          if (remaining <= 0) { clearInterval(t); setStatusMsg("Try again — new slot!"); }
        }, 1000);
        return () => clearInterval(t);
      }
    });

    peer.on("error", () => { if (mountedRef.current) { setStatusMsg("Connection error. Try again."); setPhase("idle"); } });
  }

  function handleData(raw: any) {
    if (!mountedRef.current) return;
    if (raw.type === "rc-hello") { /* already connected */ }
    else if (raw.type === "rc-chat") addMsg(raw.text, "them", "Stranger");
  }

  function sendChat() {
    if (!text.trim() || !connRef.current?.open) return;
    connRef.current.send({ type: "rc-chat", text: text.trim() });
    addMsg(text.trim(), "me", profile.name);
    setText("");
  }

  function disconnect() {
    cleanup();
    setPhase("idle");
    setMsgs([]);
    setStatusMsg("");
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "rgba(240,238,255,.5)", display: "flex", padding: 4 }}><Ic n="ArrowLeft" /></button>
        <span style={{ fontSize: ".85rem", fontWeight: 700, color: "#f0eeff" }}>⚡ Random Chat</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, background: phase === "connected" ? "rgba(74,222,128,.1)" : "rgba(255,255,255,.06)", border: `1px solid ${phase === "connected" ? "rgba(74,222,128,.3)" : "rgba(255,255,255,.1)"}`, fontSize: ".62rem", color: phase === "connected" ? "#4ade80" : "rgba(240,238,255,.4)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: phase === "connected" ? "#4ade80" : "rgba(255,255,255,.2)", display: "inline-block" }} />
          {phase === "connected" ? "Connected" : phase === "searching" ? "Searching…" : "Offline"}
        </div>
      </div>

      {phase !== "connected" ? (
        <div className="pc-rand-wrap">
          <div className="pc-amb" />
          <div className="pc-rand-orb">
            {phase === "searching" && <div className="pc-rand-ping" />}
            <div className="pc-rand-inner">⚡</div>
          </div>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontStyle: "italic", color: "#f0eeff", marginBottom: 8 }}>Random Chat</h2>
            <p style={{ fontSize: ".82rem", color: "rgba(240,238,255,.5)", lineHeight: 1.7, maxWidth: 300, margin: "0 auto" }}>
              {phase === "searching" ? statusMsg : "Connect with a random stranger for a private 1-on-1 video call."}
            </p>
            {phase === "searching" && countdown > 0 && (
              <p style={{ fontSize: ".75rem", color: "rgba(251,191,36,.6)", marginTop: 8 }}>Next slot in {countdown}s</p>
            )}
          </div>
          {phase === "idle" ? (
            <button className="pc-btn-rand" style={{ maxWidth: 280 }} onClick={startSearch}>
              <Ic n="Zap" /> Find a Stranger
            </button>
          ) : (
            <button className="pc-btn-s" style={{ maxWidth: 200 }} onClick={disconnect}>
              <Ic n="X" /> Cancel
            </button>
          )}
          <p style={{ fontSize: ".65rem", color: "rgba(240,238,255,.25)", lineHeight: 1.7 }}>
            🔒 P2P encrypted • No logs • No servers
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Video area */}
          <div style={{ flex: 1, background: "#050410", position: "relative", overflow: "hidden", minHeight: 0, display: "flex", gap: 4, padding: 4 }}>
            <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", background: "#0d0b1e", position: "relative" }}>
              <video ref={remoteVidRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: ".7rem", color: "#fff", fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>Stranger</div>
            </div>
            <div style={{ width: "28%", borderRadius: 10, overflow: "hidden", background: "#0d0b1e", position: "relative" }}>
              <video ref={localVidRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
              <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: ".7rem", color: "#fff", fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>You</div>
            </div>
          </div>
          {/* Chat */}
          <div style={{ height: "220px", display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255,255,255,.08)" }}>
            <div className="pc-msgs" style={{ flex: 1, minHeight: 0 }}>
              {msgs.map((m) => (
                <div key={m.id} className={`pc-msg ${m.type === "system" ? "sys" : m.type}`}>
                  {m.type !== "system" && <div className="pc-mmeta"><span style={{ fontWeight: 600, color: m.type === "me" ? "#c4b5fd" : "#93c5fd" }}>{m.sender}</span><span style={{ marginLeft: "auto" }}>{m.time}</span></div>}
                  <div className="pc-bubble">{m.text}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,.08)", alignItems: "center" }}>
              <input className="pc-ci" placeholder="Say something…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } }} />
              <button className="pc-send" onClick={sendChat}><Ic n="Send" /></button>
              <button className="pc-end" style={{ width: 36, height: 36 }} onClick={disconnect}><Ic n="Phone" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   HOME SCREEN
───────────────────────────────────────── */
function HomeScreen({ profile, onCreate, onJoin, onEditProfile, onRandom }: {
  profile: MyProfile;
  onCreate: (n: string) => void;
  onJoin: (n: string, l: string) => void;
  onEditProfile: () => void;
  onRandom: () => void;
}) {
  const [link, setLink] = useState("");
  useEffect(() => { const p = new URLSearchParams(window.location.search).get("room"); if (p) setLink(window.location.href); }, []);
  const avatarIsPhoto = profile.avatarIsPhoto && profile.avatar?.startsWith("data:image");
  return (
    <div className="pc-center">
      <div className="pc-amb" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="pc-orb">🛡️</div>
          <div className="pc-title">PrivateChat</div>
          <div style={{ display: "flex", gap: 7, justifyContent: "center", marginTop: 9, flexWrap: "wrap" }}>
            <span className="pc-badge">🔒 E2E Encrypted</span>
            <span className="pc-badge">👥 Multi-user</span>
            <span className="pc-badge">📡 P2P</span>
          </div>
        </div>
        <div className="pc-card">
          {/* Profile row — full width */}
          <div className="pc-profile-row" style={{ cursor: "default" }}>
            <div style={{ position: "relative", flexShrink: 0, cursor: "pointer" }} onClick={onEditProfile} title="Edit profile">
              <AvatarDisplay avatar={profile.avatar} name={profile.name} size={44} fontSize="1.35rem" />
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 17, height: 17, borderRadius: "50%", background: "rgba(109,40,217,.9)", border: "2px solid rgba(9,7,20,1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="CamSmall" style={{ color: "#fff" }} />
              </div>
            </div>
            <div style={{ flex: 1, cursor: "pointer" }} onClick={onEditProfile}>
              <div style={{ fontSize: ".88rem", fontWeight: 700, color: "#f0eeff" }}>{profile.name}</div>
              <div style={{ fontSize: ".65rem", color: "rgba(240,238,255,.35)", marginTop: 2 }}>Tap to edit profile</div>
            </div>
            <button className="pc-share-icon-btn" onClick={() => { navigator.clipboard.writeText(window.location.href); }} title="Share app link">
              <Ic n="ShareLink" />
            </button>
          </div>

          <p style={{ fontSize: ".62rem", letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(240,238,255,.28)", marginBottom: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 18, height: 1, background: "#a78bfa", opacity: 0.5, display: "inline-block" }} />
            Start a Session
          </p>
          <button className="pc-btn-p" onClick={() => onCreate(profile.name)} style={{ marginBottom: 10 }}>
            <Ic n="Plus" /> Create Private Room
          </button>
          <div className="pc-divider">or join existing</div>
          <div className="pc-iw">
            <span className="pc-iw-icon"><Ic n="Link" /></span>
            <input className="pc-input" placeholder="Paste invite link or Room ID…" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onJoin(profile.name, link)} />
          </div>
          <button className="pc-btn-s" onClick={() => onJoin(profile.name, link)} style={{ marginBottom: 10 }}>
            <Ic n="LogIn" /> Join Room
          </button>
          <button className="pc-btn-rand" onClick={onRandom}>
            <Ic n="Zap" /> Random Chat
          </button>
          <div className="pc-trust">
            {[["🔐","Encrypted"],["🚫","No Servers"],["📵","No Logs"],["👁️","Private"]].map(([ic,lbl]) => (
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
function WaitScreen({ link, onEnter, onCancel }: { link: string; onEnter: () => void; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }); };
  return (
    <div className="pc-center">
      <div className="pc-amb" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%", maxWidth: 440, textAlign: "center" }}>
        <div className="pc-wait-orb">🏠</div>
        <div>
          <h2 style={{ fontStyle: "italic", fontSize: "clamp(1.4rem,6vw,2rem)", color: "#f0eeff", marginBottom: 7 }}>Room Ready!</h2>
          <p style={{ fontSize: ".8rem", color: "rgba(240,238,255,.55)", lineHeight: 1.7, maxWidth: 320 }}>Share the invite link. Guests knock — you approve from inside the room.</p>
        </div>
        <div className="pc-link-box">{link || "Generating secure link…"}</div>
        <button className="pc-copy-btn" onClick={copy}><Ic n={copied ? "Check" : "Copy"} />{copied ? "Copied!" : "Copy Invite Link"}</button>
        <p style={{ fontSize: ".67rem", color: "rgba(240,238,255,.28)", lineHeight: 1.7 }}>🔒 Only you (admin) can approve or remove participants</p>
        <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 420 }}>
          <button className="pc-btn-p" onClick={onEnter} disabled={!link} style={{ flex: 1 }}><Ic n="Door" />Enter Room</button>
          <button className="pc-btn-s" onClick={onCancel} style={{ flex: 1 }}><Ic n="X" />Cancel</button>
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
        <div className="pc-spinner" />
        <h2 style={{ fontStyle: "italic", fontSize: "1.35rem", color: "#f0eeff" }}>Connecting…</h2>
        <p style={{ fontSize: ".8rem", color: "rgba(240,238,255,.55)" }}>{msg}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   ROOM SCREEN
───────────────────────────────────────── */
function RoomScreen({
  parts, myId, isAdmin, msgs, micOn, camOn, speakerOn, facingMode, isScreenSharing,
  pendingQ, dmChats, dmUnread, activeDm, roomLink,
  onMic, onCam, onFlip, onSpeaker, onScreenShare, onLeave,
  onKick, onForceMute, onForceCam, onSend, onDm, onDmSend, onCloseDm, onAccept, onDecline,
}: {
  parts: Participant[]; myId: string; isAdmin: boolean; msgs: ChatMsg[];
  micOn: boolean; camOn: boolean; speakerOn: boolean;
  facingMode: "user" | "environment"; isScreenSharing: boolean;
  pendingQ: PendingApproval[];
  dmChats: Record<string, ChatMsg[]>;
  dmUnread: Record<string, number>;
  activeDm: Participant | null;
  roomLink: string;
  onMic: () => void; onCam: () => void; onFlip: () => void;
  onSpeaker: () => void; onScreenShare: () => void; onLeave: () => void;
  onKick: (id: string, n: string) => void;
  onForceMute: (id: string) => void;
  onForceCam: (id: string) => void;
  onSend: (text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => void;
  onDm: (p: Participant) => void;
  onDmSend: (text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => void;
  onCloseDm: () => void;
  onAccept: () => void; onDecline: () => void;
}) {
  const [tab, setTab] = useState<"people" | "chat" | "dm">("people");
  const [mobOpen, setMobOpen] = useState(false);
  const [mobTab, setMobTab] = useState("people");
  const [unread, setUnread] = useState(0);
  const count = parts.length;
  const gridCls = count <= 6 ? `pc-vgrid pc-g${count}` : "pc-vgrid pc-gmany";

  useEffect(() => {
    if (tab !== "chat" && !mobOpen) {
      const last = msgs[msgs.length - 1];
      if (last?.type === "them") setUnread(u => u + 1);
    }
  }, [msgs]);
  useEffect(() => { if (tab === "chat" || (mobOpen && mobTab === "chat")) setUnread(0); }, [tab, mobOpen, mobTab]);

  const handleDm = (p: Participant) => { onDm(p); setTab("dm"); };
  const handleMobDm = (p: Participant) => { onDm(p); setMobTab("dm"); setMobOpen(true); };

  const totalDmUnread = Object.values(dmUnread).reduce((a, b) => a + b, 0);

  return (
    <div className="pc-room-wrap">
      {/* Video Area */}
      <div className="pc-video-area">
        <div className={gridCls}>
          {parts.map((p) => (
            <VideoTile key={p.peerId} p={p} isSelf={p.peerId === myId} isAdminUser={p.peerId === myId && isAdmin} isScreenSharing={p.peerId === myId && isScreenSharing} />
          ))}
        </div>
        <div className="pc-rh">
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div className="pc-enc-pill"><Ic n="Lock" />E2E Encrypted</div>
            <span className="pc-cnt-pill">{count} participant{count !== 1 ? "s" : ""}</span>
          </div>
          {isAdmin && <div className="pc-adm-pill"><Ic n="Crown" />Admin</div>}
        </div>
        <div className="pc-fabs">
          <button className="pc-fab" onClick={() => { setMobTab("people"); setMobOpen(true); }}><Ic n="Users" /><span className="pc-fab-bdg">{count}</span></button>
          <button className="pc-fab" onClick={() => { setMobTab("chat"); setMobOpen(true); }}>
            <Ic n="Chat" />{unread > 0 && <span className="pc-fab-bdg">{unread}</span>}
          </button>
        </div>
        <MobPanel open={mobOpen} tab={mobTab} parts={parts} myId={myId} isAdmin={isAdmin} msgs={msgs} count={count}
          onKick={onKick} onForceMute={onForceMute} onForceCam={onForceCam}
          onDm={handleMobDm} dmUnread={dmUnread} activeDm={activeDm}
          onSend={onSend} onClose={() => setMobOpen(false)} onTab={setMobTab} />
      </div>

      {/* Knock Banner */}
      {pendingQ.length > 0 && isAdmin && (
        <KnockBanner knock={pendingQ[0]} queueLen={pendingQ.length} onAccept={onAccept} onDecline={onDecline} />
      )}

      {/* Sidebar */}
      <div className="pc-sidebar">
        <div className="pc-tabs">
          <button className={`pc-tab${tab === "people" ? " act" : ""}`} onClick={() => setTab("people")}><Ic n="Users" />People<span className="pc-tab-bdg">{count}</span></button>
          <button className={`pc-tab${tab === "chat" ? " act" : ""}`} onClick={() => setTab("chat")}><Ic n="Chat" />Chat{unread > 0 && <span className="pc-tab-bdg">{unread}</span>}</button>
          <button className={`pc-tab${tab === "dm" ? " act" : ""}`} onClick={() => { setTab("dm"); }}>
            <Ic n="DM" />DMs{totalDmUnread > 0 && <span className="pc-tab-bdg">{totalDmUnread}</span>}
          </button>
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab === "people" && <PeoplePanel parts={parts} myId={myId} isAdmin={isAdmin} onKick={onKick} onForceMute={onForceMute} onForceCam={onForceCam} onDm={handleDm} dmUnread={dmUnread} roomLink={roomLink} />}
          {tab === "chat" && <ChatPanel msgs={msgs} onSend={onSend} />}
          {tab === "dm" && (
            activeDm
              ? <DmPanel peer={activeDm} msgs={dmChats[activeDm.peerId] ?? []} onSend={onDmSend} onClose={() => { onCloseDm(); }} />
              : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, opacity: .4 }}>
                  <Ic n="DM" style={{ fontSize: 24 }} />
                  <p style={{ fontSize: ".75rem" }}>Select a person to DM</p>
                </div>
              )
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="pc-ctrl">
        {[
          { n: micOn ? "Mic" : "MicOff", off: !micOn, fn: onMic, lbl: micOn ? "Mute" : "Muted" },
          { n: camOn ? "Cam" : "CamOff", off: !camOn, fn: onCam, lbl: camOn ? "Camera" : "Off" },
          { n: speakerOn ? "Vol" : "VolOff", off: !speakerOn, fn: onSpeaker, lbl: "Speaker" },
        ].map((b) => (
          <div key={b.lbl} className="pc-cw">
            <button className={`pc-cb${b.off ? " off" : ""}`} onClick={b.fn}><Ic n={b.n} /></button>
            <span className="pc-cl">{b.lbl}</span>
          </div>
        ))}
        <div className="pc-cw">
          <button className={`pc-cb${isScreenSharing ? " active" : ""}`} onClick={onScreenShare} title="Screen share">
            <Ic n="Screen" />
          </button>
          <span className="pc-cl" style={{ color: isScreenSharing ? "#4ade80" : undefined }}>Share</span>
        </div>
        <div className="pc-cw">
          <button className="pc-cb" onClick={onFlip} title="Flip camera" style={{ borderColor: "rgba(167,139,250,.3)", color: "#c4b5fd" }}>
            <Ic n="Flip" />
          </button>
          <span className="pc-cl">{facingMode === "user" ? "Front" : "Back"}</span>
        </div>
        <div className="pc-cw">
          <button className="pc-end" onClick={onLeave}><Ic n="Phone" /></button>
          <span className="pc-cl" style={{ color: "#f87171" }}>Leave</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN
───────────────────────────────────────── */
export default function PrivateChat() {
  useEffect(() => { injectStyles(); }, []);

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
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [dmChats, setDmChats] = useState<Record<string, ChatMsg[]>>({});
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});
  const [activeDm, setActiveDm] = useState<Participant | null>(null);

  const [profile, setProfile] = useState<MyProfile>(() => {
    const saved = localStorage.getItem("pc_profile_v2");
    if (saved) try { return JSON.parse(saved); } catch {}
    return { name: "You", avatar: "", avatarIsPhoto: false };
  });

  const peerRef = useRef<Peer | null>(null);
  const myIdRef = useRef("");
  const myNameRef = useRef(profile.name);
  const myAvatarRef = useRef(profile.avatar);
  const isAdminRef = useRef(false);
  const localRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestConns = useRef<Map<string, DataConnection>>(new Map());
  const guestCalls = useRef<Map<string, MediaConnection>>(new Map());
  const hostConn = useRef<DataConnection | null>(null);
  const outCalls = useRef<Map<string, MediaConnection>>(new Map());
  const partsRef = useRef<Participant[]>([]);
  const micRef = useRef(true);
  const camRef = useRef(true);
  const facingRef = useRef<"user" | "environment">("user");
  const screenSharingRef = useRef(false);

  useEffect(() => { partsRef.current = parts; }, [parts]);
  useEffect(() => { micRef.current = micOn; }, [micOn]);
  useEffect(() => { camRef.current = camOn; }, [camOn]);
  useEffect(() => { facingRef.current = facingMode; }, [facingMode]);
  useEffect(() => { screenSharingRef.current = isScreenSharing; }, [isScreenSharing]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const addMsg = useCallback((text: string, type: ChatMsg["type"] = "system", sender = "", senderPeerId?: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => {
    setMsgs(prev => [...prev, { id: uid(), text, type, sender, senderPeerId, time: nowTime(), mediaUrl, mediaType, mediaName, viewOnce }]);
  }, []);

  const addDmMsg = useCallback((peerId: string, msg: Omit<ChatMsg, "id" | "time">) => {
    setDmChats(prev => ({ ...prev, [peerId]: [...(prev[peerId] ?? []), { ...msg, id: uid(), time: nowTime() }] }));
  }, []);

  const upsertPart = useCallback((p: Participant) => {
    setParts(prev => {
      const i = prev.findIndex(x => x.peerId === p.peerId);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], ...p }; return n; }
      return [...prev, p];
    });
  }, []);

  const updatePart = useCallback((peerId: string, u: Partial<Participant>) => {
    setParts(prev => prev.map(p => p.peerId === peerId ? { ...p, ...u } : p));
  }, []);

  const removePart = useCallback((peerId: string) => {
    setParts(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  const broadcast = useCallback((data: object, exclude?: string) => {
    guestConns.current.forEach((conn, pid) => { if (pid !== exclude && conn.open) try { conn.send(data); } catch {} });
  }, []);

  const replaceVideoTrack = useCallback((track: MediaStreamTrack) => {
    const replace = (calls: Map<string, MediaConnection>) => {
      calls.forEach(call => {
        const pc = (call as any).peerConnection as RTCPeerConnection | undefined;
        pc?.getSenders().forEach(s => { if (s.track?.kind === "video") s.replaceTrack(track).catch(() => {}); });
      });
    };
    replace(outCalls.current);
    replace(guestCalls.current);
  }, []);

  const handleGuestData = useCallback((data: any, conn: DataConnection, gPeerId: string) => {
    if (data.type === "join-request") {
      if (partsRef.current.length >= 9) { conn.send({ type: "rejected", reason: "Room is full" }); return; }
      guestConns.current.set(gPeerId, conn);
      setPendingQ(q => [...q, { peerId: gPeerId, name: data.name, device: data.deviceId, conn }]);
    } else if (data.type === "chat") {
      addMsg(data.text, "them", data.name, gPeerId, data.mediaUrl, data.mediaType, data.mediaName, data.viewOnce);
      broadcast({ type: "relay-chat", text: data.text, name: data.name, senderPeerId: gPeerId, mediaUrl: data.mediaUrl, mediaType: data.mediaType, mediaName: data.mediaName, viewOnce: data.viewOnce }, gPeerId);
    } else if (data.type === "status-update") {
      updatePart(gPeerId, { micOn: data.micOn, camOn: data.camOn });
      broadcast({ type: "peer-status", peerId: gPeerId, micOn: data.micOn, camOn: data.camOn }, gPeerId);
    } else if (data.type === "dm") {
      // Guest DM — if for host, display it; if for another guest, forward
      if (data.to === myIdRef.current) {
        addDmMsg(gPeerId, { text: data.text, type: "them", sender: data.name, senderPeerId: gPeerId, mediaUrl: data.mediaUrl, mediaType: data.mediaType, mediaName: data.mediaName, viewOnce: data.viewOnce });
        setDmUnread(u => ({ ...u, [gPeerId]: (u[gPeerId] ?? 0) + 1 }));
      } else {
        const targetConn = guestConns.current.get(data.to);
        if (targetConn?.open) try { targetConn.send({ type: "dm-delivery", from: gPeerId, name: data.name, text: data.text, mediaUrl: data.mediaUrl, mediaType: data.mediaType, mediaName: data.mediaName, viewOnce: data.viewOnce }); } catch {}
      }
    }
  }, [addMsg, broadcast, updatePart, addDmMsg]);

  const acceptGuest = useCallback((ap: PendingApproval) => {
    const currentList = partsRef.current
      .filter(p => p.peerId !== myIdRef.current)
      .map(p => ({ peerId: p.peerId, name: p.name, isAdmin: p.isAdmin, avatar: p.avatar }));
    ap.conn.send({ type: "accepted", hostName: myNameRef.current, hostPeerId: myIdRef.current, hostAvatar: myAvatarRef.current, participants: currentList });
    broadcast({ type: "new-peer", peerId: ap.peerId, name: ap.name, avatar: ap.conn /* can't get avatar here */ }, ap.peerId);
    upsertPart({ peerId: ap.peerId, name: ap.name, isAdmin: false, stream: null, micOn: true, camOn: true });
    addMsg(`${ap.name} joined the room`, "system");
    showToast(`✓ ${ap.name} joined`);
  }, [broadcast, upsertPart, addMsg, showToast]);

  const handleKick = useCallback((targetId: string, targetName: string) => {
    const conn = guestConns.current.get(targetId);
    if (conn?.open) try { conn.send({ type: "kicked" }); } catch {}
    setTimeout(() => { guestConns.current.get(targetId)?.close(); guestConns.current.delete(targetId); }, 300);
    guestCalls.current.get(targetId)?.close();
    guestCalls.current.delete(targetId);
    removePart(targetId);
    broadcast({ type: "peer-left", peerId: targetId });
    addMsg(`${targetName} was removed`, "system");
    showToast(`Removed ${targetName}`);
  }, [broadcast, removePart, addMsg, showToast]);

  // Admin can only turn OFF (not back on)
  const handleForceMute = useCallback((targetId: string) => {
    const conn = guestConns.current.get(targetId);
    if (conn?.open) try { conn.send({ type: "force-mute" }); } catch {}
    updatePart(targetId, { micOn: false });
    const camOn = partsRef.current.find(p => p.peerId === targetId)?.camOn ?? true;
    broadcast({ type: "peer-status", peerId: targetId, micOn: false, camOn }, targetId);
    showToast("Muted participant");
  }, [updatePart, broadcast, showToast]);

  const handleForceCam = useCallback((targetId: string) => {
    const conn = guestConns.current.get(targetId);
    if (conn?.open) try { conn.send({ type: "force-cam" }); } catch {}
    updatePart(targetId, { camOn: false });
    const micOn = partsRef.current.find(p => p.peerId === targetId)?.micOn ?? true;
    broadcast({ type: "peer-status", peerId: targetId, micOn, camOn: false }, targetId);
    showToast("Camera disabled");
  }, [updatePart, broadcast, showToast]);

  function cleanup(notify = true) {
    localRef.current?.getTracks().forEach(t => t.stop());
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    outCalls.current.forEach(c => { try { c.close(); } catch {} }); outCalls.current.clear();
    guestCalls.current.forEach(c => { try { c.close(); } catch {} }); guestCalls.current.clear();
    guestConns.current.forEach(c => { try { c.close(); } catch {} }); guestConns.current.clear();
    try { hostConn.current?.close(); } catch {}
    hostConn.current = null;
    peerRef.current?.destroy(); peerRef.current = null;
    localRef.current = null;
    setParts([]); setMsgs([]); setPendingQ([]);
    setDmChats({}); setDmUnread({}); setActiveDm(null);
    setIsScreenSharing(false);
    setScreen("home");
    if (notify) showToast("Left the room");
  }

  async function getMedia(facing: "user" | "environment" = "user") {
    if (!navigator.mediaDevices?.getUserMedia) { showToast("⚠ Camera requires HTTPS or localhost"); return false; }
    try {
      try { localRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true }); setCamOn(true); camRef.current = true; }
      catch { localRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); setCamOn(false); camRef.current = false; showToast("No camera — mic only"); }
      return true;
    } catch { showToast("Could not access camera or mic"); return false; }
  }

  async function handleCreate(name: string) {
    myNameRef.current = name || "Host";
    myAvatarRef.current = profile.avatar;
    isAdminRef.current = true;
    setIsAdmin(true);
    const ok = await getMedia("user");
    if (!ok) return;
    setScreen("wait");
    const peer = new Peer({ debug: 0 });
    peerRef.current = peer;
    peer.on("open", (id) => {
      myIdRef.current = id;
      setRoomLink(`${window.location.origin}${window.location.pathname}?room=${id}`);
      peer.on("connection", (conn) => {
        const gPeerId = conn.peer;
        conn.on("data", (d) => handleGuestData(d as any, conn, gPeerId));
        conn.on("close", () => {
          guestConns.current.delete(gPeerId);
          const p = partsRef.current.find(x => x.peerId === gPeerId);
          if (p) { removePart(gPeerId); broadcast({ type: "peer-left", peerId: gPeerId }); addMsg(`${p.name} left`, "system"); }
        });
      });
      peer.on("call", (call) => {
        call.answer(localRef.current!);
        guestCalls.current.set(call.peer, call);
        call.on("stream", (stream) => updatePart(call.peer, { stream }));
        call.on("close", () => { guestCalls.current.delete(call.peer); updatePart(call.peer, { stream: null }); });
      });
    });
    peer.on("error", (e) => showToast(`Error: ${(e as any).type || e}`));
  }

  function enterRoom() {
    setParts([{ peerId: myIdRef.current, name: myNameRef.current, isAdmin: true, stream: localRef.current, micOn: true, camOn: camRef.current, avatar: profile.avatar }]);
    setScreen("room");
    addMsg("🔒 Room created — share the link to invite guests", "system");
  }

  async function handleJoin(name: string, link: string) {
    if (!link.trim()) { showToast("Paste an invite link or Room ID"); return; }
    let id = "";
    try { const u = new URL(link); id = u.searchParams.get("room") ?? ""; } catch {}
    if (!id) id = link.trim();
    if (!id) { showToast("Invalid link or Room ID"); return; }
    myNameRef.current = name || "Guest";
    myAvatarRef.current = profile.avatar;
    isAdminRef.current = false;
    setIsAdmin(false);
    const ok = await getMedia("user");
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
        conn.send({ type: "join-request", name: myNameRef.current, avatar: myAvatarRef.current, peerId: myId, deviceId: DEVICE_ID });
        setConnectMsg("Waiting for host approval…");
      });
      conn.on("data", (raw) => {
        const data = raw as any;
        if (data.type === "accepted") {
          const others: Participant[] = [
            { peerId: data.hostPeerId, name: data.hostName, isAdmin: true, stream: null, micOn: true, camOn: true, avatar: data.hostAvatar || "" },
            ...(data.participants as any[]).map(p => ({ ...p, stream: null, micOn: true, camOn: true, avatar: p.avatar || "" })),
          ].filter(p => p.peerId !== myId);
          const self: Participant = { peerId: myId, name: myNameRef.current, isAdmin: false, stream: localRef.current, micOn: true, camOn: camRef.current, avatar: myAvatarRef.current };
          setParts([self, ...others]);
          setScreen("room");
          addMsg("🔒 Encrypted call started", "system");
          others.forEach(p => {
            if (!peerRef.current) return;
            const call = peerRef.current.call(p.peerId, localRef.current!);
            outCalls.current.set(p.peerId, call);
            call.on("stream", (stream) => updatePart(p.peerId, { stream }));
            call.on("close", () => { outCalls.current.delete(p.peerId); updatePart(p.peerId, { stream: null }); });
          });
        } else if (data.type === "rejected") {
          showToast(`Request declined: ${data.reason ?? "by host"}`);
          localRef.current?.getTracks().forEach(t => t.stop());
          peerRef.current?.destroy();
          setScreen("home");
        } else if (data.type === "new-peer") {
          upsertPart({ peerId: data.peerId, name: data.name, isAdmin: false, stream: null, micOn: true, camOn: true, avatar: data.avatar || "" });
          addMsg(`${data.name} joined`, "system");
        } else if (data.type === "peer-left") {
          const p = partsRef.current.find(x => x.peerId === data.peerId);
          if (p) addMsg(`${p.name} left`, "system");
          removePart(data.peerId);
          outCalls.current.get(data.peerId)?.close();
          outCalls.current.delete(data.peerId);
        } else if (data.type === "relay-chat") {
          addMsg(data.text, "them", data.name, data.senderPeerId, data.mediaUrl, data.mediaType, data.mediaName, data.viewOnce);
        } else if (data.type === "peer-status") {
          updatePart(data.peerId, { micOn: data.micOn, camOn: data.camOn });
        } else if (data.type === "kicked") {
          showToast("You were removed by the admin");
          cleanup(false);
        } else if (data.type === "force-mute") {
          setMicOn(false); micRef.current = false;
          localRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
          updatePart(myId, { micOn: false });
          showToast("Admin muted your mic");
          try { hostConn.current?.send({ type: "status-update", micOn: false, camOn: camRef.current }); } catch {}
        } else if (data.type === "force-cam") {
          setCamOn(false); camRef.current = false;
          localRef.current?.getVideoTracks().forEach(t => { t.enabled = false; });
          updatePart(myId, { camOn: false });
          showToast("Admin disabled your camera");
          try { hostConn.current?.send({ type: "status-update", micOn: micRef.current, camOn: false }); } catch {}
        } else if (data.type === "dm-delivery") {
          addDmMsg(data.from, { text: data.text, type: "them", sender: data.name, senderPeerId: data.from, mediaUrl: data.mediaUrl, mediaType: data.mediaType, mediaName: data.mediaName, viewOnce: data.viewOnce });
          setDmUnread(u => ({ ...u, [data.from]: (u[data.from] ?? 0) + 1 }));
        }
      });
      conn.on("close", () => { showToast("Disconnected from room"); cleanup(false); });
    });
    peer.on("call", (call) => {
      call.answer(localRef.current!);
      outCalls.current.set(call.peer, call);
      call.on("stream", (stream) => updatePart(call.peer, { stream }));
      call.on("close", () => { outCalls.current.delete(call.peer); updatePart(call.peer, { stream: null }); });
    });
    peer.on("error", (e) => { showToast(`Error: ${(e as any).type || e}`); setScreen("home"); });
  }

  const handleSend = useCallback((text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => {
    const payload = { type: "chat", text, name: myNameRef.current, mediaUrl, mediaType, mediaName, viewOnce };
    if (isAdminRef.current) broadcast({ type: "relay-chat", text, name: myNameRef.current, senderPeerId: myIdRef.current, mediaUrl, mediaType, mediaName, viewOnce });
    else try { hostConn.current?.send(payload); } catch {}
    addMsg(text, "me", myNameRef.current, myIdRef.current, mediaUrl, mediaType, mediaName, viewOnce);
  }, [broadcast, addMsg]);

  const handleDmSend = useCallback((text: string, mediaUrl?: string, mediaType?: ChatMsg["mediaType"], mediaName?: string, viewOnce?: boolean) => {
    const dm = activeDm;
    if (!dm) return;
    const payload = { type: "dm", to: dm.peerId, name: myNameRef.current, text, mediaUrl, mediaType, mediaName, viewOnce };
    if (isAdminRef.current) {
      const conn = guestConns.current.get(dm.peerId);
      if (conn?.open) try { conn.send({ type: "dm-delivery", from: myIdRef.current, name: myNameRef.current, text, mediaUrl, mediaType, mediaName, viewOnce }); } catch {}
    } else {
      try { hostConn.current?.send(payload); } catch {}
    }
    addDmMsg(dm.peerId, { text, type: "me", sender: myNameRef.current, senderPeerId: myIdRef.current, mediaUrl, mediaType, mediaName, viewOnce });
  }, [activeDm, addDmMsg]);

  const handleDm = useCallback((p: Participant) => {
    setActiveDm(p);
    setDmUnread(u => ({ ...u, [p.peerId]: 0 }));
  }, []);

  const toggleMic = () => {
    const next = !micOn; setMicOn(next); micRef.current = next;
    localRef.current?.getAudioTracks().forEach(t => { t.enabled = next; });
    updatePart(myIdRef.current, { micOn: next });
    const s = { type: "status-update", micOn: next, camOn: camRef.current };
    if (isAdminRef.current) broadcast({ ...s, type: "peer-status", peerId: myIdRef.current });
    else try { hostConn.current?.send(s); } catch {}
    showToast(next ? "Mic on" : "Mic muted");
  };

  const toggleCam = () => {
    const next = !camOn; setCamOn(next); camRef.current = next;
    localRef.current?.getVideoTracks().forEach(t => { t.enabled = next; });
    updatePart(myIdRef.current, { camOn: next });
    const s = { type: "status-update", micOn: micRef.current, camOn: next };
    if (isAdminRef.current) broadcast({ ...s, type: "peer-status", peerId: myIdRef.current });
    else try { hostConn.current?.send(s); } catch {}
    showToast(next ? "Camera on" : "Camera off");
  };

  const flipCamera = async () => {
    const newFacing = facingMode === "user" ? "environment" : "user";
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing }, audio: false });
      const track = ns.getVideoTracks()[0];
      if (!track) return;
      localRef.current?.getVideoTracks().forEach(t => { t.stop(); localRef.current?.removeTrack(t); });
      localRef.current?.addTrack(track);
      replaceVideoTrack(track);
      updatePart(myIdRef.current, { stream: localRef.current });
      setFacingMode(newFacing); facingRef.current = newFacing;
      showToast(newFacing === "user" ? "Front camera" : "Back camera");
    } catch { showToast("Could not switch camera"); }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen share, restore camera
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      try {
        const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingRef.current }, audio: false });
        const camTrack = ns.getVideoTracks()[0];
        localRef.current?.getVideoTracks().forEach(t => { t.stop(); localRef.current?.removeTrack(t); });
        if (camTrack) { localRef.current?.addTrack(camTrack); replaceVideoTrack(camTrack); }
      } catch {}
      updatePart(myIdRef.current, { stream: localRef.current });
      setIsScreenSharing(false);
      showToast("Screen share stopped");
    } else {
      try {
        const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
        const screenTrack: MediaStreamTrack = displayStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;
        localRef.current?.getVideoTracks().forEach(t => { t.stop(); localRef.current?.removeTrack(t); });
        localRef.current?.addTrack(screenTrack);
        replaceVideoTrack(screenTrack);
        updatePart(myIdRef.current, { stream: localRef.current });
        setIsScreenSharing(true);
        screenTrack.onended = () => toggleScreenShare();
        showToast("Screen sharing started");
      } catch { showToast("Could not start screen share"); }
    }
  };

  const toggleSpeaker = () => {
    const next = !speakerOn; setSpeakerOn(next);
    document.querySelectorAll<HTMLVideoElement>(".pc-tile:not(.pc-self) video").forEach(v => { v.muted = !next; });
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
    try { first.conn.send({ type: "rejected", reason: "declined" }); } catch {}
    guestConns.current.delete(first.peerId);
    setPendingQ(rest);
    showToast("Request declined");
  };

  const saveProfile = (p: MyProfile) => {
    setProfile(p);
    localStorage.setItem("pc_profile_v2", JSON.stringify(p));
    myNameRef.current = p.name;
    myAvatarRef.current = p.avatar;
    if (screen === "room") updatePart(myIdRef.current, { name: p.name, avatar: p.avatar });
    showToast("Profile updated ✓");
  };

  return (
    <div id="pc-wrap">
      {showProfile && <ProfileModal profile={profile} onSave={saveProfile} onClose={() => setShowProfile(false)} />}

      {screen === "home" && (
        <HomeScreen profile={profile} onCreate={handleCreate} onJoin={handleJoin} onEditProfile={() => setShowProfile(true)} onRandom={() => setScreen("random")} />
      )}
      {screen === "random" && <RandomChatScreen profile={profile} onBack={() => setScreen("home")} />}
      {screen === "wait" && (
        <WaitScreen link={roomLink} onEnter={enterRoom} onCancel={() => { peerRef.current?.destroy(); localRef.current?.getTracks().forEach(t => t.stop()); setScreen("home"); }} />
      )}
      {screen === "connecting" && <ConnectingScreen msg={connectMsg} />}
      {screen === "room" && (
        <RoomScreen
          parts={parts} myId={myIdRef.current} isAdmin={isAdmin}
          msgs={msgs} micOn={micOn} camOn={camOn} speakerOn={speakerOn}
          facingMode={facingMode} isScreenSharing={isScreenSharing}
          pendingQ={pendingQ} dmChats={dmChats} dmUnread={dmUnread} activeDm={activeDm} roomLink={roomLink}
          onMic={toggleMic} onCam={toggleCam} onFlip={flipCamera}
          onSpeaker={toggleSpeaker} onScreenShare={toggleScreenShare}
          onLeave={() => cleanup(true)}
          onKick={handleKick} onForceMute={handleForceMute} onForceCam={handleForceCam}
          onSend={handleSend} onDm={handleDm} onDmSend={handleDmSend} onCloseDm={() => setActiveDm(null)}
          onAccept={handleAccept} onDecline={handleDecline}
        />
      )}
      <div className={`pc-toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
