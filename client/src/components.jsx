import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './app-context.jsx';
import { scrollToTop, useSmoothScroll } from './motion.js';
import { api, fmtTime, teamSide } from './lib.js';

// ---------- Layout ----------
const SUB = {
  hub: [['/', 'Home'], ['/schedule', 'Schedule & results'], ['/medals', 'Medals table'], ['/events', 'Events'], ['/teams', 'Teams']],
  fantasy: [['/fantasy', 'Pick team'], ['/fantasy/points', 'Points'], ['/fantasy/leagues', 'Leagues'], ['/fantasy/stats', 'Player stats'], ['/fantasy/fixtures', 'Fixtures'], ['/fantasy/rules', 'Rules']],
  admin: [['/admin', 'Results'], ['/admin/medals', 'Medals'], ['/admin/news', 'Updates'], ['/admin/players', 'Players'], ['/admin/teams', 'Teams & kits'], ['/admin/gameweeks', 'Gameweeks'], ['/admin/users', 'Users']],
};

export function Layout() {
  const { user, setUser, isStaff, toast } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = pathname.startsWith('/admin') ? 'admin' : pathname.startsWith('/fantasy') || ['/login', '/signup'].includes(pathname) ? 'fantasy' : 'hub';
  const items = SUB[section].filter(([to]) => to !== '/admin/users' || user?.role === 'admin');
  const active = items.filter(([to]) => pathname === to || pathname.startsWith(to + '/')).sort((a, b) => b[0].length - a[0].length)[0]?.[0];

  useSmoothScroll();
  useEffect(() => { scrollToTop(); }, [pathname]);

  async function logout() {
    await api('/api/auth/logout', { body: {} });
    setUser(null); toast('Logged out'); navigate('/');
  }

  return (
    <>
      {/* Site-wide backdrop: the poster's stadium, text removed, blurred and darkened, slowly drifting */}
      <div className="site-bg" aria-hidden="true"><div className="site-bg__img" /><div className="site-bg__shade" /></div>
      <header className="top">
        <div className="wrap top-row">
          <Link className="brand" to="/">
            <img className="brand-logo" src="/bmesa-logo.png" alt="BMESA logo" />
            <span><b>BMESA</b> Games</span>
          </Link>
          <nav className="main-tabs">
            <Link to="/" className={section === 'hub' ? 'on' : ''}><span className="long">Games </span>Hub</Link>
            <Link to="/fantasy" className={section === 'fantasy' ? 'on' : ''}>Fantasy</Link>
            {isStaff && <Link to="/admin" className={section === 'admin' ? 'on' : ''}>Admin</Link>}
          </nav>
          <div className="account">
            {user ? (<><span className="who">{user.name}</span><button className="btn sm ghost" onClick={logout}>Log out</button></>)
              : (<><Link className="btn sm ghost" to="/login">Log in</Link><Link className="btn sm gold" to="/signup">Sign up</Link></>)}
          </div>
        </div>
        <nav className="sub-tabs wrap">
          {items.map(([to, label]) => <Link key={to} to={to} className={active === to ? 'on' : ''}>{label}</Link>)}
        </nav>
      </header>
      <main className="wrap"><Suspense fallback={<Loading />}><Outlet /></Suspense></main>
      <footer className="wrap foot">BMESA Games · Biomedical Engineering Department · 4–11 December 2026 · All times West Africa Time (WAT)</footer>
    </>
  );
}

// ---------- Generic bits ----------
export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" data-lenis-prevent onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box ${wide ? 'wide' : ''}`}>
        <div className="modal-h"><h2>{title}</h2><button className="x" aria-label="Close" onClick={onClose}>&times;</button></div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

export function Loading({ error }) {
  return <div className={`empty ${error ? 'card error' : ''}`}>{error || 'Loading…'}</div>;
}

export function StatusPill({ status }) {
  if (status === 'live') return <span className="pill live">LIVE</span>;
  if (status === 'finished') return <span className="pill ft">FT</span>;
  return null;
}

/** Team logo when uploaded, otherwise a coloured dot. Falls back to the dot if the image is missing. */
export function TeamLogo({ team, lg }) {
  const [broken, setBroken] = useState(false);
  if (team?.logo_url && !broken) return <img className={`team-logo ${lg ? 'lg' : ''}`} src={team.logo_url} alt="" onError={() => setBroken(true)} />;
  return <i className="dot" style={{ background: team?.color || '#cbd5e1', ...(lg ? { width: 40, height: 40 } : {}) }} />;
}

export function TeamName({ team }) {
  return <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><TeamLogo team={team} /><span>{team?.name}</span></span>;
}

/** Jersey: the team's kit image when uploaded, otherwise a coloured SVG shirt. */
export function Shirt({ color, jersey, gkJersey, isGk }) {
  const [broken, setBroken] = useState(false);
  const src = isGk ? gkJersey || null : jersey;
  if (src && !broken) return <img src={src} alt="" onError={() => setBroken(true)} />;
  const c = isGk ? '#facc15' : color || '#64748b';
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M22 6l-14 8 5 13 6-3v34h26V24l6 3 5-13-14-8c-1 5-5 8-10 8s-9-3-10-8z" fill={c} stroke="rgba(0,0,0,.25)" strokeWidth="1.5" />
      <path d="M22 6c1 5 5 8 10 8s9-3 10-8" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="2" />
    </svg>
  );
}

// ---------- Fixtures ----------
export function FixtureRow({ f, hub, showEvent = true }) {
  const ev = hub.events.find((e) => e.id === f.event_id);
  const solo = !f.home_team_id && !f.away_team_id && !f.away_label;
  const to = `/event/${ev?.slug}`;
  if (solo) {
    return (
      <Link className="fx solo" to={to}>
        <div><div className="ev">{ev?.name}</div><div className="small muted">{f.round}{` · ${f.home_label || 'All levels'}`}{f.venue && ` · ${f.venue}`}</div></div>
        <div className="mid">{f.status === 'scheduled' ? <div className="time">{fmtTime(f.starts_at)}</div> : <StatusPill status={f.status} />}</div>
      </Link>
    );
  }
  const h = teamSide(f, 'home', hub.teams), a = teamSide(f, 'away', hub.teams);
  const scored = f.home_score != null && f.away_score != null && f.status !== 'scheduled';
  return (
    <Link className="fx" to={to}>
      <div className="side"><TeamLogo team={h} /><span>{h.name}</span></div>
      <div className="mid">{scored ? <div className="score num">{f.home_score} – {f.away_score}</div> : <div className="time">{fmtTime(f.starts_at)}</div>}</div>
      <div className="side away"><span>{a.name}</span><TeamLogo team={a} /></div>
      <div className="fx-meta"><StatusPill status={f.status} />{showEvent && <><b>{ev?.name}</b> ·</>} {f.round}{f.venue && ` · ${f.venue}`}{f.notes && ` · ${f.notes}`}</div>
    </Link>
  );
}

export function MedalsTable({ medals, teams }) {
  const team = (id) => teams.find((t) => t.id === id);
  return (
    <table className="t medals-t">
      <thead><tr><th>#</th><th>Level</th><th className="r"><span className="medal g">G</span></th><th className="r"><span className="medal s">S</span></th><th className="r"><span className="medal b">B</span></th><th className="r">Total</th></tr></thead>
      <tbody>{medals.map((m) => (
        <tr key={m.team_id} className={m.rank === 1 && m.total ? 'lead' : ''}>
          <td className="num">{m.rank}</td><td><b><TeamName team={team(m.team_id) || m} /></b></td>
          <td className="m num">{m.gold}</td><td className="m num">{m.silver}</td><td className="m num">{m.bronze}</td><td className="m num">{m.total}</td>
        </tr>))}
      </tbody>
    </table>
  );
}

export function NavChip({ to, on, children }) {
  return <NavLink className={`chip ${on ? 'on' : ''}`} to={to}>{children}</NavLink>;
}
