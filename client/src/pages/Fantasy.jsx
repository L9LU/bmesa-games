import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useData } from '../app-context.jsx';
import { Loading, Modal, Shirt, StatusPill, TeamLogo, TeamName } from '../components.jsx';
import { api, countdown, fmtShort, fmtTime, money, POS, POS_NAME, shortName, teamSide } from '../lib.js';

const nextGw = (b) => b.gameweeks.find((g) => g.state === 'next');
const useBoot = () => useData('/api/fantasy/bootstrap');
const playerTeam = (p) => ({ id: p.team_id, name: p.team, short: p.team_short, color: p.team_color, logo_url: p.team_logo });

function teamsFromPlayers(b) {
  const m = new Map();
  for (const p of b.players) m.set(p.team_id, playerTeam(p));
  return [...m.values()].sort((a, c) => a.name.localeCompare(c.name));
}

/** "v Y4" style opponent text for a team in a gameweek. */
function oppText(b, teamId, gwId) {
  const fx = b.fixtures.filter((f) => f.gameweek_id === gwId && (f.home_team_id === teamId || f.away_team_id === teamId));
  if (!fx.length) return 'No match';
  const teams = teamsFromPlayers(b);
  return fx.map((f) => {
    const home = f.home_team_id === teamId;
    const opp = teams.find((t) => t.id === (home ? f.away_team_id : f.home_team_id));
    return `${home ? 'v' : '@'} ${opp ? opp.short : (home ? f.away_label : f.home_label) || 'TBD'}`;
  }).join(', ');
}

function PlayerShirt({ p }) {
  return <Shirt color={p.team_color} jersey={p.team_jersey} gkJersey={p.team_gk_jersey} isGk={p.position === 'GK'} />;
}

export function PlayerModal({ b, p, onClose }) {
  const { data, error } = useData(`/api/fantasy/player/${p.id}`);
  const teams = teamsFromPlayers(b);
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pos-tag pos-${p.position}`}>{p.position}</span><b><TeamName team={playerTeam(p)} /></b>
        <span className="muted">{money(p.price)} · {p.total_points} pts · selected by {p.selected_by}%</span>
      </div>
      {!data ? <Loading error={error} /> : data.matches.length === 0 ? <p className="muted">No matches played yet.</p> : (
        <table className="t">
          <thead><tr><th>Match</th><th>Breakdown</th><th className="r">Pts</th></tr></thead>
          <tbody>{data.matches.map((x) => {
            const home = x.home_team_id === p.team_id;
            const opp = teams.find((t) => t.id === (home ? x.away_team_id : x.home_team_id));
            return (
              <tr key={x.fixture_id}>
                <td><b>{home ? 'v' : '@'} {opp?.short || 'TBD'}</b> <span className="muted small">{x.home_score ?? '-'}–{x.away_score ?? '-'}</span><div className="small muted">{x.round}</div></td>
                <td className="small">{x.breakdown.map((i) => `${i.label} ${i.pts > 0 ? '+' : ''}${i.pts}`).join(' · ') || '—'}</td>
                <td className="r"><b>{x.total}</b></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </Modal>
  );
}

// ======================================================================
// Pick team
// ======================================================================
const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
const OUT_SLOTS = [2, 3, 4, 5, 6];
const isGkSlot = (s) => s === 1 || s === 7;
const canSwap = (a, c) => (a >= 7) !== (c >= 7) && isGkSlot(a) === isGkSlot(c);

function savedState(me) {
  const s = { squad: {}, cap: null, vice: null };
  for (const p of me?.picks || []) { s.squad[p.slot] = p.player_id; if (p.is_captain) s.cap = p.player_id; if (p.is_vice) s.vice = p.player_id; }
  return s;
}

export function PickTeam() {
  const { user, toast } = useApp();
  const { data: b, error, reload } = useBoot();
  if (!b) return <Loading error={error} />;
  if (!user) return <Landing b={b} />;
  if (!b.players.length) return <><h1>Fantasy football</h1><div className="card empty">Organisers haven’t added the football players yet. Check back soon.</div></>;
  return <Picker b={b} reload={reload} toast={toast} />;
}

function Picker({ b, reload, toast }) {
  const R = b.rules;
  const gw = nextGw(b);
  const byId = useMemo(() => new Map(b.players.map((p) => [p.id, p])), [b]);
  const [S, setS] = useState(() => savedState(b.me));
  const [name, setName] = useState(b.me.team_name || '');
  const [sel, setSel] = useState(null);       // empty slot being filled
  const [swap, setSwap] = useState(null);     // slot waiting for a swap partner
  const [menu, setMenu] = useState(null);     // slot whose menu is open
  const [info, setInfo] = useState(null);     // player whose stats modal is open
  const [f, setF] = useState({ pos: 'ALL', team: 'ALL', sort: 'points', q: '', max: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { setS(savedState(b.me)); }, [b.me]);

  const ids = Object.values(S.squad).filter(Boolean);
  const players = ids.map((id) => byId.get(id));
  const cost = players.reduce((s, p) => s + p.price, 0);
  const counts = (squad = S.squad) => { const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 }; for (const id of Object.values(squad)) if (id) c[byId.get(id).position]++; return c; };
  const perTeam = (squad = S.squad) => { const c = {}; for (const id of Object.values(squad)) if (id) { const t = byId.get(id).team_id; c[t] = (c[t] || 0) + 1; } return c; };
  const fits = (p, slot, squad = S.squad) => {
    if (Object.values(squad).includes(p.id)) return false;
    if (isGkSlot(slot) !== (p.position === 'GK')) return false;
    const cur = squad[slot] && byId.get(squad[slot]);
    const c = counts(squad); if (cur) c[cur.position]--;
    if (c[p.position] >= R.composition[p.position]) return false;
    const t = perTeam(squad); if (cur) t[cur.team_id]--;
    return (t[p.team_id] || 0) < R.maxPerTeam;
  };
  const emptySlotFor = (p, squad = S.squad) => ALL_SLOTS.find((s) => !squad[s] && fits(p, s, squad));
  const first = !b.me.previous_ids.length;
  const transfers = first ? 0 : ids.filter((id) => !b.me.previous_ids.includes(id)).length;
  const hit = Math.max(0, transfers - R.freeTransfers) * R.hitCost;
  const bank = R.budget - cost;

  function addPlayer(p) {
    const slot = sel && fits(p, sel) ? sel : emptySlotFor(p);
    if (!slot) return toast('No free slot for that player.', true);
    setS((prev) => {
      const n = { ...prev, squad: { ...prev.squad, [slot]: p.id } };
      if (slot > 1 && slot <= 6) { if (!n.cap) n.cap = p.id; else if (!n.vice) n.vice = p.id; }
      return n;
    });
    setSel(null);
  }

  function doSwap(a, c) {
    setS((prev) => {
      const squad = { ...prev.squad, [a]: prev.squad[c], [c]: prev.squad[a] };
      const n = { ...prev, squad };
      // Armbands must stay on the pitch: give them to whoever came on
      for (const role of ['cap', 'vice']) {
        for (const [benchSlot, pitchSlot] of [[a, c], [c, a]]) {
          if (benchSlot >= 7 && n[role] && n[role] === squad[benchSlot] && squad[pitchSlot]) n[role] = squad[pitchSlot];
        }
      }
      return n;
    });
    setSwap(null);
  }

  function menuAction(slot, action) {
    const id = S.squad[slot];
    setMenu(null);
    if (action === 'cap') setS((p) => ({ ...p, vice: p.vice === id ? p.cap : p.vice, cap: id }));
    if (action === 'vice') setS((p) => ({ ...p, cap: p.cap === id ? p.vice : p.cap, vice: id }));
    if (action === 'out') {
      setS((p) => { const squad = { ...p.squad }; delete squad[slot]; return { squad, cap: p.cap === id ? null : p.cap, vice: p.vice === id ? null : p.vice }; });
      setSel(slot); setF((x) => ({ ...x, pos: 'ALL' }));
    }
    if (action === 'sub') {
      const options = ALL_SLOTS.filter((s) => s !== slot && canSwap(slot, s));
      if (options.length === 1) doSwap(slot, options[0]); else setSwap(slot);
    }
    if (action === 'info') setInfo(byId.get(id));
  }

  function clickSlot(slot) {
    if (swap) { if (slot !== swap && canSwap(swap, slot)) doSwap(swap, slot); else if (slot === swap) setSwap(null); return; }
    if (!S.squad[slot]) { if (gw) setSel(sel === slot ? null : slot); return; }
    setMenu(slot);
  }

  function autoPick() {
    const free = ALL_SLOTS.filter((s) => !S.squad[s]);
    if (!free.length) return toast('Your squad is already full.');
    const active = b.players.filter((p) => p.active);
    const cheapest = Math.min(...active.map((p) => p.price));
    for (let attempt = 0; attempt < 300; attempt++) {
      const squad = { ...S.squad };
      let ok = true;
      for (const [i, s] of free.entries()) {
        const spent = Object.values(squad).reduce((sum, id) => sum + (id ? byId.get(id).price : 0), 0);
        const budgetLeft = R.budget - spent - (free.length - i - 1) * cheapest;
        const opts = active.filter((p) => fits(p, s, squad) && p.price <= budgetLeft);
        if (!opts.length) { ok = false; break; }
        squad[s] = opts[Math.floor(Math.random() * opts.length)].id;
      }
      if (!ok) continue;
      const starters = OUT_SLOTS.map((s) => squad[s]);
      const byPrice = [...starters].sort((x, y) => byId.get(y).price - byId.get(x).price);
      setS((prev) => {
        const cap = prev.cap && starters.includes(prev.cap) ? prev.cap : byPrice[0];
        const vice = prev.vice && prev.vice !== cap && starters.includes(prev.vice) ? prev.vice : byPrice.find((x) => x !== cap);
        return { squad, cap, vice };
      });
      setSel(null);
      return;
    }
    toast('Could not fit a squad in your budget. Try removing an expensive player.', true);
  }

  async function save() {
    if (ids.length < R.squadSize) return toast(`Pick all ${R.squadSize} players first.`, true);
    if (!name.trim()) return toast('Give your team a name.', true);
    const picks = Object.entries(S.squad).map(([slot, id]) => ({ player_id: id, slot: +slot, is_captain: id === S.cap, is_vice: id === S.vice }));
    setSaving(true);
    try {
      const r = await api('/api/fantasy/team', { body: { team_name: name.trim(), picks } });
      toast(r.hit ? `Team saved. ${r.transfers} transfers (−${r.hit} pts).` : 'Team saved!');
      reload();
    } catch (e) { toast(e.message, true); }
    setSaving(false);
  }

  // ----- render helpers -----
  const Card = ({ slot }) => {
    const id = S.squad[slot];
    if (!id) {
      return (
        <button className={`pcard empty ${sel === slot ? 'sel' : ''}`} onClick={() => clickSlot(slot)}>
          <div className="shirt">+</div><div className="nm">{isGkSlot(slot) ? 'GK' : 'Outfield'}</div><div className="sub">Add</div>
        </button>
      );
    }
    const p = byId.get(id);
    const target = swap && swap !== slot && canSwap(swap, slot);
    return (
      <button className={`pcard ${target ? 'target' : ''} ${swap === slot ? 'sel' : ''}`} onClick={() => clickSlot(slot)} title={p.name}>
        {S.cap === id ? <span className="badge">C</span> : S.vice === id ? <span className="badge v">V</span> : null}
        <div className="shirt"><PlayerShirt p={p} /></div>
        <div className="nm">{shortName(p.name)}</div>
        <div className="sub">{gw ? oppText(b, p.team_id, gw.id) : money(p.price)}</div>
      </button>
    );
  };

  const filled = OUT_SLOTS.filter((s) => S.squad[s]);
  const rows = ['DEF', 'MID', 'FWD'].map((pos) => filled.filter((s) => byId.get(S.squad[s]).position === pos)).filter((r) => r.length);
  const empties = OUT_SLOTS.filter((s) => !S.squad[s]);

  let list = b.players.filter((p) => p.active);
  if (sel) list = list.filter((p) => (isGkSlot(sel) ? p.position === 'GK' : p.position !== 'GK'));
  if (f.pos !== 'ALL') list = list.filter((p) => p.position === f.pos);
  if (f.team !== 'ALL') list = list.filter((p) => p.team_id === +f.team);
  if (f.q) list = list.filter((p) => p.name.toLowerCase().includes(f.q.toLowerCase()));
  if (f.max) list = list.filter((p) => p.price <= Math.round(+f.max * 10));
  list.sort(f.sort === 'price' ? (x, y) => y.price - x.price : f.sort === 'selected' ? (x, y) => y.selected_by - x.selected_by : (x, y) => y.total_points - x.total_points || y.price - x.price);
  const setFilter = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const d = gw && countdown(gw.deadline);
  const menuPlayer = menu && byId.get(S.squad[menu]);

  return (
    <>
      <div className="fant-head">
        <div><div className="cat">Fantasy football · Male football</div><h1 style={{ margin: 0 }}>{b.me.team_name || 'Pick your squad'}</h1></div>
        <div className="stat-strip">
          <div className="stat"><b className="num">{ids.length}/{R.squadSize}</b><span>Players</span></div>
          <div className={`stat ${bank < 0 ? 'warn' : ''}`}><b className="num">{money(bank)}</b><span>In the bank</span></div>
          <div className="stat"><b className="num">{first ? '∞' : `${transfers}/${R.freeTransfers}`}</b><span>{first ? 'Free transfers' : 'Transfers'}</span></div>
          <div className={`stat ${hit ? 'warn' : ''}`}><b className="num">{hit ? `-${hit}` : 0}</b><span>Points cost</span></div>
        </div>
      </div>
      {gw ? (
        <div className="deadline" style={{ marginBottom: 14 }}>
          ⏱ <span><b>{gw.name}</b> deadline: <b>{fmtShort(gw.deadline)}</b></span><span className="muted">({d.d}d {d.h}h {d.m}m left)</span>
          <span className="muted">· {first ? 'Unlimited free changes until your first deadline.' : `${R.freeTransfers} free transfers, then −${R.hitCost} pts each.`}</span>
        </div>
      ) : <div className="deadline" style={{ marginBottom: 14 }}>All deadlines have passed. Your team is locked — see <Link to="/fantasy/points">Points</Link>.</div>}

      <div className="pick-layout">
        <div>
          {swap && <div className="deadline" style={{ marginBottom: 10, background: '#eef2ff', borderColor: '#c7d2fe' }}>Pick the player to swap with. <button className="btn sm" onClick={() => setSwap(null)}>Cancel</button></div>}
          <div className="pitch">
            <div className="prow"><Card slot={1} /></div>
            {rows.map((r, i) => <div className="prow" key={i}>{r.map((s) => <Card key={s} slot={s} />)}</div>)}
            {empties.length > 0 && <div className="prow">{empties.map((s) => <Card key={s} slot={s} />)}</div>}
          </div>
          <div className="bench"><h4>Substitutes</h4><div className="prow"><Card slot={7} /><Card slot={8} /></div></div>
          {gw && (
            <div className="save-bar">
              <div style={{ flex: 1, minWidth: 180 }}><input aria-label="Team name" maxLength={30} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} /></div>
              <div className="row">
                <button className="btn sm ghost" onClick={autoPick}>Auto-pick</button>
                <button className="btn sm ghost" onClick={() => { setS(savedState(b.me)); setSel(null); setSwap(null); }}>Reset</button>
                <button className="btn gold" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save team'}</button>
              </div>
            </div>
          )}
          <p className="small muted">Squad of {R.squadSize}: 2 goalkeepers, 2 defenders, 2 midfielders, 2 forwards. Max {R.maxPerTeam} from one level. Budget {money(R.budget)}. Tap a player to captain, substitute or transfer them.</p>
        </div>

        <div className="card flush">
          <div className="card-h"><h3>{sel ? `Choose a ${isGkSlot(sel) ? 'goalkeeper' : 'outfield player'}` : 'Players'}</h3>{sel && <button className="btn sm" onClick={() => setSel(null)}>Show all</button>}</div>
          <div className="filters">
            <input type="search" placeholder="Search players" value={f.q} onChange={setFilter('q')} />
            <select value={f.pos} onChange={setFilter('pos')}><option value="ALL">All positions</option>{POS.map((x) => <option key={x} value={x}>{POS_NAME[x]}s</option>)}</select>
            <select value={f.team} onChange={setFilter('team')}><option value="ALL">All teams</option>{teamsFromPlayers(b).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select value={f.sort} onChange={setFilter('sort')}><option value="points">Sort: points</option><option value="price">Sort: price</option><option value="selected">Sort: selected</option></select>
            <input type="number" step="0.5" min="3" placeholder="Max price" value={f.max} onChange={setFilter('max')} style={{ width: 110 }} />
          </div>
          <div className="plist">
            <table className="t">
              <thead><tr><th></th><th>Player</th><th className="r">Price</th><th className="r">Pts</th><th className="r">Sel</th><th></th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={6} className="empty">No players match.</td></tr>}
                {list.map((p) => {
                  const inSquad = ids.includes(p.id);
                  const ok = !inSquad && (sel ? fits(p, sel) : !!emptySlotFor(p));
                  return (
                    <tr key={p.id}>
                      <td><span className={`pos-tag pos-${p.position}`}>{p.position}</span></td>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setInfo(p); }}>{p.name}</a><div className="small muted">{p.team}{gw && ` · ${oppText(b, p.team_id, gw.id)}`}</div></td>
                      <td className="r num">{money(p.price)}</td><td className="r num"><b>{p.total_points}</b></td><td className="r num small muted">{p.selected_by}%</td>
                      <td className="r">{inSquad ? <span className="pill">In team</span> : <button className={`btn sm ${ok ? 'primary' : ''}`} disabled={!ok || !gw} onClick={() => addPlayer(p)}>Add</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {menuPlayer && (
        <Modal title={menuPlayer.name} onClose={() => setMenu(null)}>
          <div className="row" style={{ marginBottom: 14 }}><span className={`pos-tag pos-${menuPlayer.position}`}>{menuPlayer.position}</span><b>{menuPlayer.team}</b><span className="muted">{money(menuPlayer.price)} · {menuPlayer.total_points} pts</span></div>
          <div className="menu-list">
            {gw && menu <= 6 && <>
              <button className="btn" disabled={S.cap === menuPlayer.id} onClick={() => menuAction(menu, 'cap')}>Make captain</button>
              <button className="btn" disabled={S.vice === menuPlayer.id} onClick={() => menuAction(menu, 'vice')}>Make vice-captain</button>
            </>}
            {gw && <>
              <button className="btn" onClick={() => menuAction(menu, 'sub')}>{menu <= 6 ? 'Move to bench' : 'Bring onto pitch'}</button>
              <button className="btn danger" onClick={() => menuAction(menu, 'out')}>Transfer out</button>
            </>}
            <button className="btn" onClick={() => menuAction(menu, 'info')}>View stats</button>
          </div>
        </Modal>
      )}
      {info && <PlayerModal b={b} p={info} onClose={() => setInfo(null)} />}
    </>
  );
}

function Landing({ b }) {
  const gw = nextGw(b);
  const { data } = useData('/api/fantasy/standings');
  const top = data?.rows.slice(0, 5) || [];
  return (
    <>
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="hero-title"><img className="hero-logo" src="/bmesa-logo.png" alt="" /><div><div className="cat" style={{ color: 'var(--gold)' }}>BMESA Fantasy</div><h1>Pick your 8. Back your level.</h1></div></div>
          <p style={{ marginTop: 12 }}>Build a squad from the male football teams, captain your star player and score points for goals, assists, clean sheets and MVP awards across {b.gameweeks.length} gameweeks.</p>
          {gw && <p><b style={{ color: '#fff' }}>{gw.name} deadline:</b> {fmtShort(gw.deadline)}</p>}
          <div className="row"><Link className="btn gold" to="/signup">Create account</Link><Link className="btn ghost" to="/login">Log in</Link></div>
        </div>
        <div className="hero-side">
          <h3>How it works</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1' }}>
            <li>{money(b.rules.budget)} budget, squad of {b.rules.squadSize}</li><li>2 GK · 2 DEF · 2 MID · 2 FWD</li>
            <li>Max {b.rules.maxPerTeam} players per level</li><li>Captain scores double</li><li>{b.rules.freeTransfers} free transfers per gameweek</li>
          </ul>
          <p style={{ marginTop: 12 }}><Link to="/fantasy/rules" style={{ color: 'var(--gold)' }}>Full rules & scoring →</Link></p>
        </div>
      </section>
      {top.length > 0 && <section className="card flush"><div className="card-h"><h2>Top managers</h2><Link className="small" to="/fantasy/leagues">Full table</Link></div><StandingsTable rows={top} /></section>}
    </>
  );
}

// ======================================================================
// Points
// ======================================================================
export function Points() {
  const { user } = useApp();
  const { userId } = useParams();
  const [params] = useSearchParams();
  const uid = userId ? +userId : user?.id;
  const gwq = params.get('gw');
  const { data: b } = useBoot();
  const { data, error } = useData(uid ? `/api/fantasy/points/${uid}${gwq ? `?gw=${gwq}` : ''}` : null);
  const [info, setInfo] = useState(null);
  if (!uid) return <div className="card empty">Log in to see your points. <Link to="/login">Log in</Link></div>;
  if (error) return <div className="card empty">{error === 'Manager not found.' ? 'No team picked yet.' : error} <Link to="/fantasy">Pick your team</Link></div>;
  if (!data || !b) return <Loading />;
  if (!data.gw) return <><h1>{data.manager.team_name}</h1><div className="card empty">Points appear once the first gameweek deadline passes{nextGw(b) ? ` (${fmtShort(nextGw(b).deadline)})` : ''}.</div></>;

  const byId = new Map(b.players.map((p) => [p.id, p]));
  const gws = data.gameweeks;
  const idx = gws.findIndex((g) => g.id === data.gw.id);
  const base = `/fantasy/points/${uid}`;
  const sc = data.score;

  const PCard = ({ l }) => {
    const p = byId.get(l.player_id);
    const pts = l.slot >= 7 && !l.subIn ? l.points : l.points * l.multiplier;
    const dim = (l.slot <= 6 && l.subOut) || (l.slot >= 7 && !l.subIn);
    return (
      <button className={`pcard ${dim ? 'dim' : ''}`} onClick={() => setInfo(p)}>
        {l.is_captain ? <span className="badge">C</span> : l.is_vice ? <span className="badge v">V</span> : null}
        {l.subIn ? <span className="flag in">↑</span> : l.subOut ? <span className="flag out">↓</span> : null}
        <div className="shirt"><PlayerShirt p={p} /></div><div className="nm">{shortName(p.name)}</div><div className="sub num">{pts}</div>
      </button>
    );
  };

  let body = <div className="card empty">This manager had no team for this gameweek.</div>;
  if (sc) {
    const out = sc.lineup.filter((l) => l.slot > 1 && l.slot <= 6);
    const rows = ['DEF', 'MID', 'FWD'].map((pos) => out.filter((l) => byId.get(l.player_id).position === pos)).filter((r) => r.length);
    body = (
      <div className="pick-layout">
        <div>
          <div className="pitch">
            <div className="prow"><PCard l={sc.lineup.find((l) => l.slot === 1)} /></div>
            {rows.map((r, i) => <div className="prow" key={i}>{r.map((l) => <PCard key={l.slot} l={l} />)}</div>)}
          </div>
          <div className="bench"><h4>Substitutes</h4><div className="prow">{sc.lineup.filter((l) => l.slot >= 7).map((l) => <PCard key={l.slot} l={l} />)}</div></div>
        </div>
        <div className="card flush">
          <div className="card-h"><h3>Breakdown</h3></div>
          <table className="t">
            <thead><tr><th>Player</th><th className="r">Pts</th><th className="r">×</th><th className="r">Total</th></tr></thead>
            <tbody>
              {sc.lineup.map((l) => {
                const p = byId.get(l.player_id);
                return (
                  <tr key={l.slot}>
                    <td><span className={`pos-tag pos-${p.position}`}>{p.position}</span> {p.name}{l.is_captain && <b> (C)</b>}{l.is_vice && <span className="muted"> (V)</span>}
                      {l.subIn && <> <span className="pill ft">sub on</span></>}{l.subOut && <> <span className="pill">subbed off</span></>}</td>
                    <td className="r num">{l.points}</td><td className="r num">{l.multiplier}</td><td className="r num"><b>{l.points * l.multiplier}</b></td>
                  </tr>
                );
              })}
              {sc.hit > 0 && <tr><td>Transfer cost</td><td /><td /><td className="r num error">−{sc.hit}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="fant-head">
        <div><div className="cat">{data.manager.name} · {data.manager.level}</div><h1 style={{ margin: 0 }}>{data.manager.team_name}</h1></div>
        <div className="row">
          <div className="gw-nav">
            {idx > 0 && <Link className="btn sm" to={`${base}?gw=${gws[idx - 1].id}`}>‹</Link>}
            <b>{data.gw.name}</b>
            {idx < gws.length - 1 && <Link className="btn sm" to={`${base}?gw=${gws[idx + 1].id}`}>›</Link>}
          </div>
          <div className="big-points"><b className="num">{sc ? sc.total : 0}</b><span className="small">points</span></div>
        </div>
      </div>
      {body}
      <p className="small muted">Auto-subs happen once a player’s matches for the gameweek are finished and he didn’t play. If the captain doesn’t play, the vice-captain scores double.</p>
      {info && <PlayerModal b={b} p={info} onClose={() => setInfo(null)} />}
    </>
  );
}

// ======================================================================
// Leagues
// ======================================================================
export function StandingsTable({ rows }) {
  const { user } = useApp();
  return (
    <div className="scroll-x">
      <table className="t">
        <thead><tr><th>#</th><th>Team & manager</th><th className="r">GW</th><th className="r">Total</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="empty">No managers yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.user_id} className={user?.id === r.user_id ? 'me' : ''}>
              <td className="num">{r.rank}</td>
              <td><Link to={`/fantasy/points/${r.user_id}`}>{r.team_name}</Link><div className="small muted">{r.manager}{r.level && ` · ${r.level}`}</div></td>
              <td className="r num">{r.gw_points ?? '—'}</td><td className="r num"><b>{r.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Leagues() {
  const { user, toast } = useApp();
  const { key = 'overall' } = useParams();
  const navigate = useNavigate();
  const { data: table, error } = useData(`/api/fantasy/standings?league=${encodeURIComponent(key)}`);
  const { data: mine, reload } = useData(user ? '/api/fantasy/leagues' : null);
  const [newName, setNewName] = useState('');
  const [code, setCode] = useState('');

  async function go(e, url, body) {
    e.preventDefault();
    try { const r = await api(url, { body }); reload(); navigate(`/fantasy/leagues/${r.league.id}`); toast('Done!'); }
    catch (er) { toast(er.message, true); }
  }
  const chip = (k, label) => <Link key={k} className={`chip ${k === key ? 'on' : ''}`} to={`/fantasy/leagues/${encodeURIComponent(k)}`}>{label}</Link>;
  return (
    <>
      <h1>Leagues</h1>
      <div className="chips">
        {chip('overall', 'Overall')}
        {user?.level && chip(`level:${user.level}`, user.level)}
        {(mine?.leagues || []).map((l) => chip(String(l.id), `${l.name} · ${l.members}`))}
      </div>
      <div className="pick-layout">
        <section className="card flush">
          {!table ? <Loading error={error} /> : <>
            <div className="card-h"><h2>{table.title}</h2>{table.code && <span className="small">Invite code: <b className="pill">{table.code}</b></span>}</div>
            <StandingsTable rows={table.rows} />
          </>}
        </section>
        {user ? (
          <section className="card">
            <h3>Private leagues</h3>
            <p className="small muted">Make a league for your class, hostel or friends, then share the code.</p>
            <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => go(e, '/api/fantasy/leagues', { name: newName })}>
              <input placeholder="League name" maxLength={40} required value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
              <button className="btn primary">Create</button>
            </form>
            <form className="row" onSubmit={(e) => go(e, '/api/fantasy/leagues/join', { code })}>
              <input placeholder="Invite code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ flex: 1 }} />
              <button className="btn">Join</button>
            </form>
            <p className="small muted" style={{ marginTop: 14 }}>You’re automatically in the Overall league and your level’s league.</p>
          </section>
        ) : <section className="card"><p><Link to="/login">Log in</Link> to create or join private leagues.</p></section>}
      </div>
    </>
  );
}

// ======================================================================
// Player stats
// ======================================================================
export function Stats() {
  const { data: b, error } = useBoot();
  const [f, setF] = useState({ pos: 'ALL', team: 'ALL', sort: 'total_points' });
  const [info, setInfo] = useState(null);
  if (!b) return <Loading error={error} />;
  let list = [...b.players];
  if (f.pos !== 'ALL') list = list.filter((p) => p.position === f.pos);
  if (f.team !== 'ALL') list = list.filter((p) => p.team_id === +f.team);
  list.sort((x, y) => y[f.sort] - x[f.sort] || y.price - x.price);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <h1>Player stats</h1>
      <div className="card flush">
        <div className="filters">
          <select value={f.pos} onChange={set('pos')}><option value="ALL">All positions</option>{POS.map((x) => <option key={x} value={x}>{POS_NAME[x]}s</option>)}</select>
          <select value={f.team} onChange={set('team')}><option value="ALL">All teams</option>{teamsFromPlayers(b).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select value={f.sort} onChange={set('sort')}><option value="total_points">Sort: total points</option><option value="price">Sort: price</option><option value="selected_by">Sort: selected by</option></select>
        </div>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th></th><th>Player</th><th>Team</th><th className="r">Price</th><th className="r">Selected</th><th className="r">Points</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="empty">No players yet.</td></tr>}
              {list.map((p) => (
                <tr key={p.id}>
                  <td><span className={`pos-tag pos-${p.position}`}>{p.position}</span></td>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setInfo(p); }}>{p.name}</a>{!p.active && <> <span className="pill">unavailable</span></>}</td>
                  <td><TeamName team={playerTeam(p)} /></td>
                  <td className="r num">{money(p.price)}</td><td className="r num">{p.selected_by}%</td><td className="r num"><b>{p.total_points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {info && <PlayerModal b={b} p={info} onClose={() => setInfo(null)} />}
    </>
  );
}

// ======================================================================
// Fixtures
// ======================================================================
export function Fixtures() {
  const { data: b, error } = useBoot();
  const { data: hub } = useData('/api/hub');
  if (!b || !hub) return <Loading error={error} />;
  return (
    <>
      <h1>Gameweeks & fixtures</h1>
      {b.gameweeks.map((g) => {
        const fx = b.fixtures.filter((f) => f.gameweek_id === g.id);
        return (
          <section className="day" key={g.id}>
            <div className="day-h">
              <h2>{g.name}</h2><span className="muted">Deadline {fmtShort(g.deadline)}</span>
              {g.state === 'next' && <span className="pill" style={{ background: 'var(--gold)' }}>Next deadline</span>}
              {g.state === 'current' && <span className="pill live">In progress</span>}
            </div>
            <div className="card flush">
              {fx.length === 0 && <div className="empty">No fixtures.</div>}
              {fx.map((f) => {
                const h = teamSide(f, 'home', hub.teams), a = teamSide(f, 'away', hub.teams);
                const scored = f.status !== 'scheduled' && f.home_score != null;
                return (
                  <div className="fx" key={f.id}>
                    <div className="side"><TeamLogo team={h} /><span>{h.name}</span></div>
                    <div className="mid">{scored ? <div className="score num">{f.home_score} – {f.away_score}</div> : <div className="time">{fmtTime(f.starts_at)}</div>}</div>
                    <div className="side away"><span>{a.name}</span><TeamLogo team={a} /></div>
                    <div className="fx-meta"><StatusPill status={f.status} /> {f.round} · {fmtShort(f.starts_at)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

// ======================================================================
// Rules
// ======================================================================
export function Rules() {
  const { data: b, error } = useBoot();
  if (!b) return <Loading error={error} />;
  const P = b.points, R = b.rules;
  const rows = [
    ['Plays in the match', `+${P.played}`], ['Goal by a goalkeeper or defender', `+${P.goal.GK}`], ['Goal by a midfielder', `+${P.goal.MID}`], ['Goal by a forward', `+${P.goal.FWD}`],
    ['Assist', `+${P.assist}`], ['Clean sheet — goalkeeper or defender', `+${P.cleanSheet.GK}`], ['Clean sheet — midfielder', `+${P.cleanSheet.MID}`],
    ['Every 2 goals conceded — goalkeeper or defender', P.concededPer2.GK], ['Every 3 saves — goalkeeper', `+${P.savesPer3}`],
    ['Penalty saved', `+${P.penSaved}`], ['Penalty missed', P.penMissed], ['Own goal', P.ownGoal], ['Yellow card', P.yellow], ['Red card', P.red], ['Match MVP', `+${P.mvp}`],
  ];
  return (
    <>
      <h1>Rules & scoring</h1>
      <div className="grid g2">
        <section className="card">
          <h2>Your squad</h2>
          <ul>
            <li>Pick <b>{R.squadSize} players</b> from the male football teams: 2 goalkeepers, 2 defenders, 2 midfielders, 2 forwards.</li>
            <li>Your budget is <b>{money(R.budget)}</b>. Prices are set by the organisers and don’t change.</li>
            <li>Max <b>{R.maxPerTeam}</b> players from any one level.</li>
            <li>6 start (1 goalkeeper + 5 outfield, matching the 6-a-side format), 2 sit on the bench.</li>
            <li>Your <b>captain scores double</b>. If he doesn’t play, your vice-captain scores double instead.</li>
            <li>If a starter doesn’t play, your bench player in the same role (GK or outfield) comes on automatically, if he played.</li>
          </ul>
          <h2>Gameweeks & transfers</h2>
          <ul>
            <li>Each gameweek is a football match day. Teams lock at the deadline, 1 hour before the first kick-off.</li>
            <li>Before your first deadline you can change your team as much as you like.</li>
            <li>After that you get <b>{R.freeTransfers} free transfers</b> per gameweek. Each extra transfer costs <b>{R.hitCost} points</b>. Unused transfers don’t roll over.</li>
            <li>It’s a knockout: players from eliminated teams score nothing, so transfer them out!</li>
          </ul>
        </section>
        <section className="card flush">
          <div className="card-h"><h2>Points</h2></div>
          <table className="t"><tbody>{rows.map(([l, v]) => <tr key={l}><td>{l}</td><td className="r num"><b>{v}</b></td></tr>)}</tbody></table>
        </section>
      </div>
    </>
  );
}
