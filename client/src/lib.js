// API client and formatting helpers. All times are shown in West Africa Time.
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const TZ = 'Africa/Lagos';
const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
export const fmtTime = (d) => (d ? fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)).replace(':00', '') : 'TBC');
export const fmtDay = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));
export const fmtShort = (d) => fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d));
export const dayKey = (d) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

export function toLocalInput(d) {
  if (!d) return '';
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export const fromLocalInput = (v) => (v ? `${v}:00+01:00` : null);

export function countdown(target) {
  const ms = Math.max(0, new Date(target) - Date.now());
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, done: ms === 0 };
}

export const money = (tenths) => `${(tenths / 10).toFixed(1)}m`;
export const POS = ['GK', 'DEF', 'MID', 'FWD'];
export const POS_NAME = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

/** Surname for pitch cards; full name when the last word is a number or initial. */
export function shortName(name) {
  const p = name.trim().split(/\s+/);
  const last = p[p.length - 1];
  return p.length > 1 && last.length >= 3 && !/^\d+$/.test(last) ? last : name;
}

/**
 * What a partly picked squad still needs: minimum places per position, the flexible
 * "any outfield" places left, and how many players are already taken from each team.
 */
export function squadNeeds(rules, picked) {
  const count = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const teamCount = {};
  for (const p of picked) { count[p.position]++; teamCount[p.team_id] = (teamCount[p.team_id] || 0) + 1; }
  const need = {};
  let overflow = 0; // outfield players beyond the minimum already use up flexible places
  for (const pos of Object.keys(count)) {
    need[pos] = Math.max(0, rules.composition[pos] - count[pos]);
    if (pos !== 'GK') overflow += Math.max(0, count[pos] - rules.composition[pos]);
  }
  return { need, extra: Math.max(0, (rules.extraOutfield || 0) - overflow), teamCount };
}

/**
 * Cheapest way to fill the remaining squad places.
 * pool: available players not already picked; need: { GK, DEF, MID, FWD } minimum places still to fill;
 * extra: flexible places that any outfield player can fill; teamCount: { team_id: already picked }.
 * Returns { cost, players } or null if the places can't be filled at all.
 * Branch-and-bound over players sorted by price, so it's fast for a few hundred players.
 */
export function cheapestCompletion(pool, need, extra, teamCount, maxPerTeam) {
  const list = [...pool].sort((a, b) => a.price - b.price);
  const cnt = { ...need };
  const team = { ...teamCount };
  const chosen = [];
  let flex = extra;
  let best = Infinity, bestSet = null, steps = 0;
  (function rec(i, cost, left) {
    if (++steps > 300000) return; // safety cap; result so far is still a valid squad
    if (left === 0) { if (cost < best) { best = cost; bestSet = [...chosen]; } return; }
    if (i + left > list.length) return;
    let bound = cost; // cheapest possible finish: the next `left` prices
    for (let j = i; j < i + left; j++) bound += list[j].price;
    if (bound >= best) return;
    const p = list[i];
    if ((team[p.team_id] || 0) < maxPerTeam) {
      // A player fills a required place for their position first, otherwise a flexible outfield place
      const usesNeed = cnt[p.position] > 0;
      const usesFlex = !usesNeed && p.position !== 'GK' && flex > 0;
      if (usesNeed || usesFlex) {
        if (usesNeed) cnt[p.position]--; else flex--;
        team[p.team_id] = (team[p.team_id] || 0) + 1; chosen.push(p);
        rec(i + 1, cost + p.price, left - 1);
        if (usesNeed) cnt[p.position]++; else flex++;
        team[p.team_id]--; chosen.pop();
      }
    }
    rec(i + 1, cost, left);
  })(0, 0, Object.values(cnt).reduce((s, n) => s + Math.max(0, n), 0) + extra);
  return bestSet ? { cost: best, players: bestSet } : null;
}

/** Resolve a fixture side to a team-like object (real team or placeholder label). */
export function teamSide(f, side, teams) {
  const id = f[`${side}_team_id`];
  const t = id && teams.find((x) => x.id === id);
  return t || { name: f[`${side}_label`] || 'TBD', short: '—', color: '#cbd5e1', placeholder: true };
}
