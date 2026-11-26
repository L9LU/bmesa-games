import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp, useData } from '../app-context.jsx';
import { Loading, Modal, Shirt, TeamLogo } from '../components.jsx';
import { api, cheapestCompletion, dayKey, fmtDay, fmtShort, fromLocalInput, money, teamSide, toLocalInput } from '../lib.js';

const STATUS = ['scheduled', 'live', 'finished'];

function TeamSelect({ teams, value, onChange, blank = '— label —' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? +e.target.value : null)}>
      <option value="">{blank}</option>
      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

/** Wraps an async action with toast feedback. */
function useAction() {
  const { toast } = useApp();
  return async (fn, ok = 'Saved') => {
    try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(e.message, true); return false; }
  };
}

// ---------- Results ----------
function ResultRow({ f, hub, onEdit }) {
  const run = useAction();
  const [v, setV] = useState({ home_score: f.home_score ?? '', away_score: f.away_score ?? '', status: f.status });
  const ev = hub.events.find((e) => e.id === f.event_id);
  const h = teamSide(f, 'home', hub.teams), a = teamSide(f, 'away', hub.teams);
  const solo = !f.home_team_id && !f.away_team_id && !f.away_label;
  const save = () => run(() => api(`/api/admin/fixtures/${f.id}`, { method: 'PUT', body: { ...f, ...v } }));
  return (
    <tr>
      <td style={{ minWidth: 200 }}><b>{ev?.name}</b><div className="small muted">{f.round} · {fmtShort(f.starts_at)}</div></td>
      <td style={{ minWidth: 230 }}>
        {solo ? <span className="muted">{f.home_label}</span> : (
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {h.name}
            <input type="number" min="0" aria-label="Home score" value={v.home_score} onChange={(e) => setV({ ...v, home_score: e.target.value })} style={{ width: 56 }} />–
            <input type="number" min="0" aria-label="Away score" value={v.away_score} onChange={(e) => setV({ ...v, away_score: e.target.value })} style={{ width: 56 }} />
            {a.name}
          </span>
        )}
      </td>
      <td><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></td>
      <td className="r" style={{ whiteSpace: 'nowrap' }}>
        <button className="btn sm primary" onClick={save}>Save</button>{' '}
        <button className="btn sm" onClick={() => onEdit(f)}>Edit</button>
        {f.gameweek_id && <> <Link className="btn sm gold" to={`/admin/stats/${f.id}`}>Player stats</Link></>}
      </td>
    </tr>
  );
}

export function Results() {
  const { data: hub, error, reload } = useData('/api/hub');
  const [editing, setEditing] = useState(null); // fixture, or {} for new
  if (!hub) return <Loading error={error} />;
  const days = new Map();
  for (const f of hub.fixtures) { const k = f.starts_at ? dayKey(f.starts_at) : 'TBC'; if (!days.has(k)) days.set(k, []); days.get(k).push(f); }
  return (
    <>
      <div className="row spread"><h1>Results</h1><button className="btn primary" onClick={() => setEditing({})}>+ Add fixture</button></div>
      <p className="muted">Enter scores and set status to <b>live</b> or <b>finished</b>. Use <b>Player stats</b> on men’s football matches to award fantasy points. For races and indoor games, record the winners on the <Link to="/admin/medals">Medals</Link> page.</p>
      {[...days.values()].map((fx) => (
        <section className="day" key={fx[0].id}>
          <div className="day-h"><h2>Day {fx[0].day ?? '?'}</h2><span className="muted">{fx[0].starts_at && fmtDay(fx[0].starts_at)}</span></div>
          <div className="card flush scroll-x"><table className="t admin-fx"><tbody>
            {fx.map((f) => <ResultRow key={`${f.id}-${f.status}-${f.home_score}-${f.away_score}-${f.home_team_id}-${f.away_team_id}`} f={f} hub={hub} onEdit={setEditing} />)}
          </tbody></table></div>
        </section>
      ))}
      {editing && <FixtureEditor hub={hub} f={editing.id ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function FixtureEditor({ hub, f, onClose, onDone }) {
  const run = useAction();
  const isNew = !f;
  const { data: boot } = useData(isNew ? '/api/fantasy/bootstrap' : null);
  const [v, setV] = useState(() => ({
    event_id: hub.events[0].id, round: '', day: '', venue: '', home_label: '', away_label: '', notes: '', status: 'scheduled', gameweek_id: '',
    ...(f || {}), starts_at: toLocalInput(f?.starts_at),
  }));
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    const body = { ...v, starts_at: fromLocalInput(v.starts_at) };
    const ok = await run(() => (isNew ? api('/api/admin/fixtures', { body }) : api(`/api/admin/fixtures/${f.id}`, { method: 'PUT', body })));
    if (ok) onDone();
  }
  async function del() {
    if (!confirm('Delete this fixture and any player stats for it? This can’t be undone.')) return;
    if (await run(() => api(`/api/admin/fixtures/${f.id}`, { method: 'DELETE' }), 'Deleted')) onDone();
  }
  return (
    <Modal title={isNew ? 'Add fixture' : 'Edit fixture'} onClose={onClose}>
      <form onSubmit={submit}>
        {isNew && <div className="field"><label>Event</label><select value={v.event_id} onChange={set('event_id')}>{hub.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>}
        <div className="grid g2" style={{ gap: 10 }}>
          <div className="field"><label>Round</label><input value={v.round || ''} onChange={set('round')} placeholder="e.g. Final" /></div>
          <div className="field"><label>Day number</label><input type="number" min="1" max="10" value={v.day ?? ''} onChange={set('day')} /></div>
          <div className="field"><label>Start (WAT)</label><input type="datetime-local" value={v.starts_at} onChange={set('starts_at')} /></div>
          <div className="field"><label>Venue</label><input value={v.venue || ''} onChange={set('venue')} /></div>
          <div className="field"><label>Home team</label><TeamSelect teams={hub.teams} value={v.home_team_id} onChange={(id) => setV({ ...v, home_team_id: id })} />
            <input value={v.home_label || ''} onChange={set('home_label')} placeholder="…or label, e.g. Winner Playoff / All levels" style={{ marginTop: 6 }} /></div>
          <div className="field"><label>Away team</label><TeamSelect teams={hub.teams} value={v.away_team_id} onChange={(id) => setV({ ...v, away_team_id: id })} />
            <input value={v.away_label || ''} onChange={set('away_label')} placeholder="…or label" style={{ marginTop: 6 }} /></div>
        </div>
        {isNew ? (
          <div className="field"><label>Fantasy gameweek (men’s football only)</label>
            <select value={v.gameweek_id} onChange={set('gameweek_id')}><option value="">None</option>{(boot?.gameweeks || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        ) : (
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field"><label>Home score</label><input type="number" min="0" value={v.home_score ?? ''} onChange={set('home_score')} /></div>
            <div className="field"><label>Away score</label><input type="number" min="0" value={v.away_score ?? ''} onChange={set('away_score')} /></div>
            <div className="field"><label>Status</label><select value={v.status} onChange={set('status')}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></div>
          </div>
        )}
        <div className="field"><label>Notes</label><input value={v.notes || ''} onChange={set('notes')} placeholder="e.g. Walkover — Year 2 didn’t show" /></div>
        <div className="row spread"><div>{!isNew && <button type="button" className="btn danger" onClick={del}>Delete fixture</button>}</div><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

// ---------- Player stats for one fixture ----------
const STAT_COLS = [['goals', 'Goals'], ['assists', 'Assists'], ['saves', 'Saves'], ['pen_saved', 'Pen saved'], ['pen_missed', 'Pen missed'], ['own_goals', 'OG'], ['yellow', 'Yellow'], ['red', 'Red']];

export function FixtureStats() {
  const { id } = useParams();
  const run = useAction();
  const { data, error } = useData(`/api/admin/fixtures/${id}/stats`);
  const { data: hub } = useData('/api/hub');
  const [rows, setRows] = useState(null);
  if (!data || !hub) return <Loading error={error} />;
  const f = data.fixture;
  const state = rows || Object.fromEntries(data.players.map((p) => [p.id, { played: !!p.played, mvp: !!p.mvp, ...Object.fromEntries(STAT_COLS.map(([k]) => [k, p[k] || 0])) }]));
  const set = (pid, k, val) => {
    const next = { ...state };
    if (k === 'mvp') for (const key of Object.keys(next)) next[key] = { ...next[key], mvp: false };
    next[pid] = { ...next[pid], [k]: val };
    if (['goals', 'assists', 'mvp'].includes(k) && val) next[pid].played = true;
    setRows(next);
  };
  const save = () => run(() => api(`/api/admin/fixtures/${f.id}/stats`, {
    method: 'PUT', body: { rows: Object.entries(state).map(([pid, r]) => ({ player_id: +pid, ...r })) },
  }), 'Player stats saved');
  const h = teamSide(f, 'home', hub.teams), a = teamSide(f, 'away', hub.teams);
  const TeamTable = ({ teamId, team }) => {
    if (!teamId) return <p className="muted">{team.name}: set the real team on the <Link to="/admin">Results</Link> page first.</p>;
    const list = data.players.filter((p) => p.team_id === teamId);
    return (
      <>
        <h3 style={{ marginTop: 16 }} className="row"><TeamLogo team={team} /> {team.name}</h3>
        <div className="card flush scroll-x">
          <table className="t stats-grid">
            <thead><tr><th>Player</th><th>Played</th>{STAT_COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>MVP</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={11} className="empty">No players for {team.name}. Add them on the Players page.</td></tr>}
              {list.map((p) => (
                <tr key={p.id}>
                  <td><span className={`pos-tag pos-${p.position}`}>{p.position}</span> {p.name}</td>
                  <td><input type="checkbox" checked={state[p.id].played} onChange={(e) => set(p.id, 'played', e.target.checked)} /></td>
                  {STAT_COLS.map(([k]) => (
                    <td key={k}><input type="number" min="0" max={k === 'yellow' || k === 'red' ? 1 : 20} value={state[p.id][k]} disabled={k === 'saves' && p.position !== 'GK'}
                      onChange={(e) => set(p.id, k, Math.max(0, +e.target.value || 0))} /></td>
                  ))}
                  <td><input type="radio" name="mvp" checked={state[p.id].mvp} onChange={() => set(p.id, 'mvp', true)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };
  return (
    <>
      <Link className="small" to="/admin">← Results</Link>
      <h1 style={{ marginTop: 8 }}>{h.name} {f.home_score ?? '-'} – {f.away_score ?? '-'} {a.name}</h1>
      <p className="muted">{f.round} · {fmtShort(f.starts_at)}. Tick everyone who got on the pitch. Clean sheets and goals conceded are worked out from the match score, so save the score on the Results page too.</p>
      {TeamTable({ teamId: f.home_team_id, team: h })}
      {TeamTable({ teamId: f.away_team_id, team: a })}
      <div className="save-bar"><span className="msg">Saving replaces all stats for this match.</span><button className="btn gold" onClick={save}>Save player stats</button></div>
    </>
  );
}

// ---------- Medals ----------
function MedalRow({ ev, hub }) {
  const run = useAction();
  const init = (pos) => { const p = hub.placements.find((x) => x.event_id === ev.id && x.position === pos); return { team_id: p?.team_id ?? null, note: p?.note || '' }; };
  const [v, setV] = useState({ 1: init(1), 2: init(2), 3: init(3) });
  const save = () => run(() => api(`/api/admin/events/${ev.id}/placements`, { method: 'PUT', body: { placements: [1, 2, 3].map((pos) => ({ position: pos, ...v[pos] })) } }), 'Medals saved');
  return (
    <tr>
      <td><b>{ev.name}</b><div className="small muted">{ev.awards}</div></td>
      {[1, 2, 3].map((pos) => (
        <td key={pos}>
          <TeamSelect teams={hub.teams} value={v[pos].team_id} blank="—" onChange={(id) => setV({ ...v, [pos]: { ...v[pos], team_id: id } })} />
          <input placeholder="note" value={v[pos].note} onChange={(e) => setV({ ...v, [pos]: { ...v[pos], note: e.target.value } })} style={{ width: 110, marginTop: 4, display: 'block' }} />
        </td>
      ))}
      <td><button className="btn sm primary" onClick={save}>Save</button></td>
    </tr>
  );
}

export function AdminMedals() {
  const { data: hub, error } = useData('/api/hub');
  if (!hub) return <Loading error={error} />;
  return (
    <>
      <h1>Medals</h1>
      <p className="muted">Record 1st, 2nd and 3rd for each event. Only level teams (Year 1–5) count on the medals table. The note is optional — e.g. the winner’s name.</p>
      <div className="card flush scroll-x">
        <table className="t">
          <thead><tr><th>Event</th><th>Gold</th><th>Silver</th><th>Bronze</th><th /></tr></thead>
          <tbody>{hub.events.map((e) => <MedalRow key={e.id} ev={e} hub={hub} />)}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Updates & athlete spotlight ----------
/** Shrink a photo in the browser (longest side `size` px, JPEG) and return it as a data URL. */
function resizePhoto(file, size = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

function SpotlightAdmin({ hub, reload }) {
  const run = useAction();
  const blank = { athlete: '', team_id: null, event_id: '', headline: '', body: '', photo: null };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const team = (id) => hub.teams.find((t) => t.id === id);
  const ev = (id) => hub.events.find((x) => x.id === id);

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { const photo = await resizePhoto(file); setV((x) => ({ ...x, photo })); }
    catch (er) { alert(er.message); e.target.value = ''; }
  }
  async function post(e) {
    e.preventDefault();
    const form = e.target;
    setBusy(true);
    if (await run(() => api('/api/admin/spotlights', { body: v }), 'Spotlight posted')) { setV(blank); form.reset(); reload(); }
    setBusy(false);
  }
  async function del(id) {
    if (!confirm('Delete this spotlight?')) return;
    if (await run(() => api(`/api/admin/spotlights/${id}`, { method: 'DELETE' }), 'Deleted')) reload();
  }

  return (
    <div className="pick-layout" style={{ marginBottom: 28 }}>
      <section className="card flush">
        <div className="card-h"><h2>Athlete spotlight</h2><span className="small muted">The newest one is featured on the home page</span></div>
        {hub.spotlights.length === 0 && <div className="empty">No spotlights yet.</div>}
        {hub.spotlights.map((s, i) => (
          <article key={s.id} className="news row spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              {s.image_url && <img src={s.image_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />}
              <div>
                <h3>{s.athlete}{i === 0 && <span className="pill ft" style={{ marginLeft: 8 }}>Featured</span>}</h3>
                <div className="small muted">{[team(s.team_id)?.name, ev(s.event_id)?.name].filter(Boolean).join(' · ')}</div>
                {s.headline && <p style={{ margin: '4px 0' }}><b>{s.headline}</b></p>}
                <div className="small muted">{fmtShort(s.created_at)}</div>
              </div>
            </div>
            <button className="btn sm danger" onClick={() => del(s.id)}>Delete</button>
          </article>
        ))}
      </section>
      <section className="card">
        <h3>Post a spotlight</h3>
        <form onSubmit={post}>
          <div className="field"><label>Athlete</label><input required maxLength={80} value={v.athlete} onChange={set('athlete')} placeholder="e.g. Mishell" /></div>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field"><label>Class</label><TeamSelect teams={hub.teams} value={v.team_id} blank="—" onChange={(id) => setV({ ...v, team_id: id })} /></div>
            <div className="field"><label>Event</label>
              <select value={v.event_id} onChange={set('event_id')}><option value="">—</option>{hub.events.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          </div>
          <div className="field"><label>Headline</label><input maxLength={200} value={v.headline} onChange={set('headline')} placeholder="e.g. Hat-trick to send Year 5 to the final" /></div>
          <div className="field"><label>Their feats</label><textarea rows={4} maxLength={1500} value={v.body} onChange={set('body')} placeholder="A short brief: what they did, scores, records…" /></div>
          <div className="field">
            <label>Photo</label>
            <input type="file" accept="image/*" onChange={pick} />
            {v.photo && <img src={v.photo} alt="Preview" style={{ display: 'block', marginTop: 8, maxWidth: '100%', maxHeight: 220, borderRadius: 10 }} />}
            <div className="small muted">Portrait or square photos work best. It’s resized automatically.</div>
          </div>
          <button className="btn primary" disabled={busy}>{busy ? 'Posting…' : 'Post spotlight'}</button>
        </form>
      </section>
    </div>
  );
}

export function News() {
  const run = useAction();
  const { data: hub, error, reload } = useData('/api/hub');
  const [v, setV] = useState({ title: '', body: '' });
  if (!hub) return <Loading error={error} />;
  async function post(e) {
    e.preventDefault();
    if (await run(() => api('/api/admin/announcements', { body: v }), 'Posted')) { setV({ title: '', body: '' }); reload(); }
  }
  async function del(id) {
    if (!confirm('Delete this update?')) return;
    if (await run(() => api(`/api/admin/announcements/${id}`, { method: 'DELETE' }), 'Deleted')) reload();
  }
  return (
    <>
      <h1>Updates</h1>
      <SpotlightAdmin hub={hub} reload={reload} />
      <h2>General updates</h2>
      <div className="pick-layout">
        <section className="card flush">
          {hub.announcements.length === 0 && <div className="empty">No updates.</div>}
          {hub.announcements.map((a) => (
            <article key={a.id} className="news row spread" style={{ alignItems: 'flex-start' }}>
              <div><h3>{a.title}</h3><p>{a.body}</p><div className="small muted">{fmtShort(a.created_at)}{a.author && ` · ${a.author}`}</div></div>
              <button className="btn sm danger" onClick={() => del(a.id)}>Delete</button>
            </article>
          ))}
        </section>
        <section className="card">
          <h3>Post an update</h3>
          <form onSubmit={post}>
            <div className="field"><label>Title</label><input maxLength={120} required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
            <div className="field"><label>Message</label><textarea rows={5} maxLength={2000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></div>
            <button className="btn primary">Post</button>
          </form>
        </section>
      </div>
    </>
  );
}

// ---------- Players ----------
/**
 * Media-day bulk upload: pick many photos at once; each file is matched to a player by its file name.
 * "Mishell.jpg" matches Mishell; add the class when names clash: "Adams Y3.jpg", "Y3 Adams.png", "Adams Year 3.jpg".
 */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
function matchPlayer(fileName, players) {
  const key = norm(fileName.replace(/\.[^.]+$/, ''));
  const exact = players.filter((p) => norm(p.name) === key);
  if (exact.length === 1) return { player: exact[0] };
  const withTeam = players.filter((p) => [p.team_short, p.team].some((t) => key === norm(p.name) + norm(t) || key === norm(t) + norm(p.name)));
  if (withTeam.length === 1) return { player: withTeam[0] };
  if (exact.length > 1) return { error: `matches ${exact.length} players — add the class, e.g. "${exact[0].name} ${exact[0].team_short}"` };
  return { error: 'no player with this name' };
}

function BulkPhotos({ players, onDone }) {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    const out = [];
    for (const f of files) {
      const m = matchPlayer(f.name, players);
      if (m.error) { out.push({ file: f.name, ok: false, msg: m.error }); setLog([...out]); continue; }
      try {
        await api(`/api/admin/players/${m.player.id}/photo`, { body: { photo: await resizePhoto(f, 700) } });
        out.push({ file: f.name, ok: true, msg: `${m.player.name} (${m.player.team_short})` });
      } catch (er) { out.push({ file: f.name, ok: false, msg: er.message }); }
      setLog([...out]);
    }
    setBusy(false);
    onDone();
  }
  const done = log.filter((l) => l.ok).length;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row spread">
        <div><h3 style={{ margin: 0 }}>Media day photos</h3><p className="small muted" style={{ margin: '4px 0 0' }}>Choose many photos at once. Name each file after the player — <code>Mishell.jpg</code>, or <code>Adams Y3.jpg</code> when two players share a name. Portrait photos work best.</p></div>
        <label className="btn primary">{busy ? `Uploading… ${log.length}` : 'Choose photos'}<input type="file" accept="image/*" multiple hidden disabled={busy} onChange={pick} /></label>
      </div>
      {log.length > 0 && (
        <div className="bulk-log">
          <p className="small"><b>{done}</b> uploaded{log.length - done ? <>, <b className="error">{log.length - done}</b> need attention</> : ''}.</p>
          <ul>{log.map((l) => <li key={l.file} className={l.ok ? 'ok' : 'bad'}>{l.ok ? '✓' : '✗'} <code>{l.file}</code> → {l.msg}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function PlayerRow({ p, teams, onPhoto }) {
  const run = useAction();
  const [v, setV] = useState({ name: p.name, team_id: p.team_id, position: p.position, price: (p.price / 10).toFixed(1), active: p.active });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (await run(async () => api(`/api/admin/players/${p.id}/photo`, { body: { photo: await resizePhoto(file, 700) } }), 'Photo saved')) onPhoto();
  }
  async function remove() {
    if (!confirm(`Remove ${p.name}'s photo?`)) return;
    if (await run(() => api(`/api/admin/players/${p.id}/photo`, { method: 'DELETE' }), 'Photo removed')) onPhoto();
  }
  return (
    <tr>
      <td>
        <div className="photo-cell">
          {p.photo_url ? <img src={p.photo_url} alt="" /> : <span className="photo-none" aria-hidden="true">—</span>}
          <label className="btn sm">{p.photo_url ? 'Change' : 'Upload'}<input type="file" accept="image/*" hidden onChange={upload} /></label>
          {p.photo_url && <button className="btn sm danger" onClick={remove} aria-label={`Remove ${p.name}'s photo`}>×</button>}
        </div>
      </td>
      <td><input value={v.name} onChange={set('name')} /></td>
      <td><select value={v.team_id} onChange={set('team_id')}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
      <td><select value={v.position} onChange={set('position')}>{['GK', 'DEF', 'MID', 'FWD'].map((x) => <option key={x}>{x}</option>)}</select></td>
      <td><input type="number" step="0.5" min="3" max="20" value={v.price} onChange={set('price')} style={{ width: 76 }} /></td>
      <td><input type="checkbox" checked={v.active} onChange={set('active')} /></td>
      <td className="r num">{p.total_points}</td>
      <td><button className="btn sm" onClick={() => run(() => api(`/api/admin/players/${p.id}`, { method: 'PUT', body: v }))}>Save</button></td>
    </tr>
  );
}

/** Warns organisers when no valid squad fits the budget (so managers can't build a team). */
function BudgetCheck({ players, rules }) {
  const active = players.filter((p) => p.active);
  const best = useMemo(() => cheapestCompletion(active, rules.composition, rules.extraOutfield || 0, {}, rules.maxPerTeam), [players, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = Object.entries(rules.composition).map(([pos, n]) => `${n} ${pos}`).join(', ') + (rules.extraOutfield ? ` + ${rules.extraOutfield} extra outfield` : '');
  const box = (ok, children) => (
    <div className="deadline" style={{ margin: '12px 0 16px', ...(ok ? { background: '#ecfdf5', borderColor: '#a7f3d0' } : { background: '#fef2f2', borderColor: '#fecaca' }) }}>{children}</div>
  );
  if (!best) {
    return box(false, <span>⚠ <b>Managers can’t build a squad yet.</b> A squad needs {need}, with at most {rules.maxPerTeam} players from one class — there aren’t enough available players for that. Keep adding squads.</span>);
  }
  if (best.cost > rules.budget) {
    return box(false, (
      <span>⚠ <b>Cheapest valid squad: {money(best.cost)} — over the {money(rules.budget)} budget.</b> Nobody can afford a team. Add cheaper players (full squads, not just the stars) or lower some prices.
        <span className="small muted" style={{ display: 'block', marginTop: 4 }}>Cheapest squad: {best.players.map((p) => `${p.name} (${p.team_short} ${p.position} ${money(p.price)})`).join(', ')}</span>
      </span>
    ));
  }
  return box(true, <span>✓ Cheapest valid squad: <b>{money(best.cost)}</b> of the {money(rules.budget)} budget — managers can build a team.</span>);
}

export function Players() {
  const run = useAction();
  const { data: b, error, reload } = useData('/api/fantasy/bootstrap');
  const { data: hub } = useData('/api/hub');
  const [one, setOne] = useState({ name: '', team_id: '', position: 'MID', price: '5.5' });
  const [bulk, setBulk] = useState('');
  if (!b || !hub) return <Loading error={error} />;
  const teams = hub.teams.filter((t) => t.is_level);
  async function addOne(e) {
    e.preventDefault();
    if (await run(() => api('/api/admin/players', { body: { ...one, team_id: one.team_id || teams[0].id } }), 'Player added')) { setOne({ ...one, name: '' }); reload(); }
  }
  async function addBulk(e) {
    e.preventDefault();
    let added = 0;
    if (await run(async () => { added = (await api('/api/admin/players/bulk', { body: { text: bulk } })).added; }, null)) { setBulk(''); reload(); alert(`Added ${added} players.`); }
  }
  return (
    <>
      <h1>Fantasy players</h1>
      <p className="muted">Add the men’s football squads. Price is in millions (e.g. 6.5). Untick “Available” to stop new managers picking a player.</p>
      <BudgetCheck players={b.players} rules={b.rules} />
      <BulkPhotos players={b.players} onDone={reload} />
      <div className="grid g2">
        <section className="card">
          <h3>Add one player</h3>
          <form className="row" onSubmit={addOne}>
            <input placeholder="Full name" required value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <select value={one.team_id || teams[0]?.id} onChange={(e) => setOne({ ...one, team_id: e.target.value })}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select value={one.position} onChange={(e) => setOne({ ...one, position: e.target.value })}>{['GK', 'DEF', 'MID', 'FWD'].map((x) => <option key={x}>{x}</option>)}</select>
            <input type="number" step="0.5" min="3" max="20" value={one.price} onChange={(e) => setOne({ ...one, price: e.target.value })} style={{ width: 80 }} />
            <button className="btn primary">Add</button>
          </form>
        </section>
        <section className="card">
          <h3>Bulk add</h3>
          <p className="small muted">One per line: <code>Name, Team, Position, Price</code> — e.g. <code>Tobi Ade, Year 3, FWD, 7.5</code></p>
          <form onSubmit={addBulk}>
            <textarea rows={4} style={{ width: '100%' }} placeholder="Tobi Ade, Year 3, FWD, 7.5" value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <button className="btn primary" style={{ marginTop: 8 }}>Import</button>
          </form>
        </section>
      </div>
      <section className="card flush scroll-x" style={{ marginTop: 16 }}>
        <div className="card-h"><h3>{b.players.length} players</h3></div>
        <table className="t">
          <thead><tr><th>Photo</th><th>Name</th><th>Team</th><th>Pos</th><th>Price</th><th>Available</th><th className="r">Pts</th><th /></tr></thead>
          <tbody>{b.players.map((p) => <PlayerRow key={`${p.id}-${p.photo_url}`} p={p} teams={teams} onPhoto={reload} />)}</tbody>
        </table>
      </section>
    </>
  );
}

// ---------- Teams & kits ----------
function ImageField({ label, value, onChange, hint }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="img-input">
        {value ? <img src={value} alt="" /> : null}
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={hint} style={{ flex: 1 }} />
      </div>
    </div>
  );
}

function TeamEditor({ t, onSaved }) {
  const run = useAction();
  const [v, setV] = useState({ ...t });
  const set = (k) => (val) => setV({ ...v, [k]: val });
  const slug = t.short.toLowerCase();
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <TeamLogo team={v} lg />
        <div style={{ flex: 1 }}><h3 style={{ margin: 0 }}>{t.name}</h3><div className="small muted">{t.is_level ? 'Level team · counts for medals' : 'Guest team'}</div></div>
        <div className="kit row" style={{ gap: 4 }}>
          <span style={{ width: 48, height: 48, display: 'inline-block' }}><Shirt color={v.color} jersey={v.jersey_url} /></span>
          <span style={{ width: 48, height: 48, display: 'inline-block' }}><Shirt isGk gkJersey={v.gk_jersey_url} /></span>
        </div>
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field"><label>Name</label><input value={v.name} onChange={(e) => set('name')(e.target.value)} /></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ width: 90 }}><label>Short</label><input value={v.short} maxLength={4} onChange={(e) => set('short')(e.target.value)} /></div>
          <div className="field"><label>Colour</label><input type="color" value={v.color} onChange={(e) => set('color')(e.target.value)} style={{ width: 60, padding: 2 }} /></div>
        </div>
      </div>
      <ImageField label="Logo" value={v.logo_url} onChange={set('logo_url')} hint={`/kits/${slug}-logo.png`} />
      <ImageField label="Jersey" value={v.jersey_url} onChange={set('jersey_url')} hint={`/kits/${slug}-jersey.png`} />
      <ImageField label="Goalkeeper jersey" value={v.gk_jersey_url} onChange={set('gk_jersey_url')} hint={`/kits/${slug}-gk.png`} />
      <button className="btn primary" onClick={async () => { if (await run(() => api(`/api/admin/teams/${t.id}`, { method: 'PUT', body: v }))) onSaved(); }}>Save team</button>
    </section>
  );
}

export function TeamsAdmin() {
  const run = useAction();
  const { data: hub, error, reload } = useData('/api/hub');
  const [nt, setNt] = useState({ name: '', short: '', color: '#64748b', is_level: false });
  if (!hub) return <Loading error={error} />;
  return (
    <>
      <h1>Teams & kits</h1>
      <p className="muted">Logos and jerseys show across the hub, the pitch view and the Teams page. Put image files in <code>client/public/kits/</code> and enter their path (e.g. <code>/kits/y1-logo.png</code>), or paste an https:// image link. Transparent PNGs look best. Without a jersey image, a shirt in the team colour is shown.</p>
      <div className="grid g2">{hub.teams.map((t) => <TeamEditor key={t.id} t={t} onSaved={reload} />)}</div>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Add a team</h3>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/api/admin/teams', { body: nt }), 'Team added')) { setNt({ ...nt, name: '', short: '' }); reload(); } }}>
          <input placeholder="Team name" required value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
          <input placeholder="Short" maxLength={4} value={nt.short} onChange={(e) => setNt({ ...nt, short: e.target.value })} style={{ width: 90 }} />
          <input type="color" value={nt.color} onChange={(e) => setNt({ ...nt, color: e.target.value })} />
          <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={nt.is_level} onChange={(e) => setNt({ ...nt, is_level: e.target.checked })} /> Counts for medals</label>
          <button className="btn">Add team</button>
        </form>
      </section>
    </>
  );
}

// ---------- Gameweeks ----------
function GameweekRow({ g, onSaved }) {
  const run = useAction();
  const [val, setVal] = useState(toLocalInput(g.deadline));
  return (
    <tr>
      <td><b>{g.name}</b></td>
      <td><input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} /></td>
      <td><span className="pill">{g.state}</span></td>
      <td><button className="btn sm primary" onClick={async () => { if (await run(() => api(`/api/admin/gameweeks/${g.id}`, { method: 'PUT', body: { deadline: fromLocalInput(val), finished: false } }))) onSaved(); }}>Save</button></td>
    </tr>
  );
}

export function Gameweeks() {
  const { data: b, error, reload } = useData('/api/fantasy/bootstrap');
  if (!b) return <Loading error={error} />;
  return (
    <>
      <h1>Gameweeks</h1>
      <p className="muted">Deadlines are in West Africa Time. Squads lock at the deadline. Changing a deadline after it has passed can change who has which team, so be careful.</p>
      <div className="card flush">
        <table className="t">
          <thead><tr><th>Gameweek</th><th>Deadline (WAT)</th><th>State</th><th /></tr></thead>
          <tbody>{b.gameweeks.map((g) => <GameweekRow key={`${g.id}-${g.deadline}`} g={g} onSaved={reload} />)}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Users ----------
export function Users() {
  const { user } = useApp();
  const run = useAction();
  const { data, error, reload } = useData(user?.role === 'admin' ? '/api/admin/users' : null);
  if (user?.role !== 'admin') return <div className="card empty">Only admins can manage organisers.</div>;
  if (!data) return <Loading error={error} />;
  return (
    <>
      <h1>Users & organisers</h1>
      <p className="muted">Organisers can enter results, stats, medals, teams and updates. Admins can also manage roles.</p>
      <div className="card flush scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th>Email</th><th>Level</th><th>Role</th></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b></td><td>{u.email}</td><td>{u.level}</td>
              <td><select defaultValue={u.role} onChange={async (e) => { if (!(await run(() => api(`/api/admin/users/${u.id}/role`, { method: 'PUT', body: { role: e.target.value } }), 'Role updated'))) reload(); }}>
                {['user', 'organiser', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
