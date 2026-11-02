// 共通ユーティリティ
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (a, s) => Math.exp(-(a / s) * (a / s));

export const Ease = {
  lin: t => t,
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  in2: t => t * t,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outBounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export function randId(n = 6) {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(n);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 1e9); }
  let s = '';
  for (let i = 0; i < n; i++) s += ch[a[i] % ch.length];
  return s;
}
export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
export function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿-]/g, '').trim().slice(0, 12);
}

export const CARD_LABEL = { A: 'A', K: 'K', Q: 'Q', J: 'JOKER' };
export const CARD_JP = { A: 'エース', K: 'キング', Q: 'クイーン', J: 'ジョーカー' };
export const BOT_NAMES = ['CPU ドク', 'CPU サリー', 'CPU ボリス', 'CPU ネル', 'CPU オットー', 'CPU イヴ'];

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function dieHTML(v, cls = '') {
  let h = `<span class="die ${v === 1 ? 'one' : ''} ${cls}">`;
  for (let i = 0; i < 9; i++) h += PIPS[v] && PIPS[v].includes(i) ? '<i></i>' : '<b></b>';
  return h + '</span>';
}
export function cardHTML(t, cls = '') {
  const lab = t === 'J' ? 'JOKER' : t;
  return `<span class="mini-card ${t === 'J' ? 'joker' : ''} ${t === 'Q' ? 'red' : ''} ${cls}"><b>${t === 'J' ? '★' : t}</b><small>${lab}</small></span>`;
}
