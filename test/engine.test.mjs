// エンジンの自動テスト: node test/engine.test.mjs （または npm test）
import { Engine } from '../js/engine.js';

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };
const stats = { card: { games: 0, rounds: 0, deaths: 0, forced: 0 }, dice: { games: 0, rounds: 0, deaths: 0 } };

for (let g = 0; g < 300; g++) {
  const mode = g % 2 ? 'dice' : 'card';
  let t = 0;
  const e = new Engine({ rng: seeded(g + 1), now: () => t });
  const n = 2 + (g % 3);
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, true);
  e.setMode(mode);
  ok(e.start(), 'start');
  let steps = 0, seen = 0;
  const leaveAt = g % 7 === 0 ? 40 : -1;
  while (e.phase !== 'over') {
    t += 100; e.update(); steps++;
    if (steps === leaveAt) e.removePlayer('p1');
    if (steps > 200000) { ok(false, 'game did not finish'); break; }
    if (e.phase === 'turn') {
      const s = e.seats[e.turn];
      ok(s && s.alive, 'turn on dead seat');
      if (mode === 'card') {
        ok(!(e.forced && (!e.lastPlay || e.lastPlay.seat === e.turn)), 'bad forced state');
        ok(e.forced || s.hand.length > 0, 'empty-handed turn');
      }
    }
    for (const ev of e.events) {
      if (ev.i <= seen) continue; seen = ev.i;
      if (ev.t === 'round' || ev.t === 'roll') stats[mode].rounds++;
      if ((ev.t === 'shot' || ev.t === 'drink') && ev.fatal) stats[mode].deaths++;
      if (ev.t === 'liar' && ev.fz) stats.card.forced++;
      if (ev.t === 'dliar') {
        let c = 0; for (const d of ev.dice) if (d) for (const v of d) if (v === ev.f || (ev.f !== 1 && v === 1)) c++;
        ok(c === ev.cnt, 'dice count');
      }
    }
    ok(JSON.stringify(e.publicState()).length < 3000, 'state size');
  }
  stats[mode].games++;
  e.toLobby(); ok(e.phase === 'lobby', 'toLobby');
}
// 個別ルール
const e = new Engine({ now: () => 0 });
e.addPlayer('a', 'a'); e.addPlayer('b', 'b'); e.setMode('dice'); e.start(); e.beginTurn(e.turn);
const t0 = e.turn;
ok(e.act(t0, { t: 'bid', q: 3, f: 4 }) === null, 'bid');
const t1 = e.turn;
ok(e.act(t1, { t: 'bid', q: 3, f: 3 }) === 'invalid', 'lower bid rejected');
ok(e.act(t1, { t: 'bid', q: 3, f: 5 }) === null, 'same count higher face');
ok(e.act(t1, { t: 'bid', q: 5, f: 5 }) === 'turn', 'wrong turn rejected');
// リボルバー: 6回以内に必ず死亡
for (let k = 0; k < 50; k++) {
  const r = new Engine({ rng: seeded(k + 99), now: () => 0 });
  r.addPlayer('a', 'a'); r.addPlayer('b', 'b'); r.start();
  const s = r.seats[0]; let shots = 0;
  while (s.alive && shots < 7) { r.loser = 0; r.phase = 'reveal'; r.penalty(); shots++; r.phase = 'turn'; }
  ok(!s.alive && shots <= 6, 'revolver kills within 6 pulls');
}
console.log(JSON.stringify(stats));
if (fail) { console.error(fail + ' failures'); process.exit(1); }
console.log('すべてのテストに合格しました');
