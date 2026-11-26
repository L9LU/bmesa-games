import { lazy, Suspense, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import GlareHover from '../vendor/react-bits/GlareHover.jsx';

// WebGL effects for the landing hero load after the page, so they never hold up first paint
const LightRays = lazy(() => import('../vendor/react-bits/LightRays.jsx'));
const Particles = lazy(() => import('../vendor/react-bits/Particles.jsx'));
const isSmallScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches;
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useData, useTick } from '../app-context.jsx';
import { FixtureRow, Loading, MedalsTable, Shirt, TeamLogo, TeamName } from '../components.jsx';
import { countdown, dayKey, fmtDay, fmtShort, teamSide } from '../lib.js';
import { prefersReducedMotion } from '../motion.js';
import AnimatedContent from '../vendor/react-bits/AnimatedContent.jsx';
import ShinyText from '../vendor/react-bits/ShinyText.jsx';
import SplitText from '../vendor/react-bits/SplitText.jsx';
import SpotlightCard from '../vendor/react-bits/SpotlightCard.jsx';

gsap.registerPlugin(useGSAP);

/** Scroll-in reveal used across the hub (React Bits AnimatedContent with house settings). */
const Reveal = ({ children, ...props }) => (
  <AnimatedContent distance={36} duration={0.7} ease="power3.out" threshold={0.12} {...props}>{children}</AnimatedContent>
);

const CATS = ['Football', 'Basketball', 'Volleyball', 'Badminton', 'Track', 'Indoor', 'Esports'];
const useHub = (refreshSec = 30) => useData('/api/hub', { refreshSec });

function Countdown({ to }) {
  useTick();
  const c = countdown(to);
  return (
    <div className="countdown">
      {[['d', 'Days'], ['h', 'Hours'], ['m', 'Mins'], ['s', 'Secs']].map(([k, l]) => (
        <div key={k}><b className="num">{String(c[k]).padStart(2, '0')}</b><span>{l}</span></div>
      ))}
    </div>
  );
}

// ---------- Home ----------
export function Home() {
  const { data: hub, error } = useHub();
  if (!hub) return <Loading error={error} />;
  const now = Date.now();
  const first = hub.fixtures.find((f) => f.starts_at)?.starts_at;
  const live = hub.fixtures.filter((f) => f.status === 'live');
  const upcoming = hub.fixtures.filter((f) => f.status === 'live' || (f.status !== 'finished' && new Date(f.starts_at) >= now - 3 * 3600e3)).slice(0, 4);
  const results = hub.fixtures.filter((f) => f.status === 'finished').slice(-6).reverse();
  const started = first && new Date(first) <= now;
  const allDone = hub.fixtures.length > 0 && hub.fixtures.every((f) => f.status === 'finished');
  const headline = allDone ? 'That’s a wrap!' : started ? (live.length ? `${live.length} live now` : 'The games are on') : 'Who takes the crown?';

  return (
    <>
      <Landing hub={hub} headline={headline} first={first} started={started} live={live} upcoming={upcoming} />
      <Reveal className={`updates-row ${hub.spotlights.length ? '' : 'solo'}`}>
        {hub.spotlights.length > 0 && <Spotlight hub={hub} />}
        <UpdatesFeed items={hub.announcements} />
      </Reveal>
      <Reveal className="crown-strip" stagger={0.08} distance={28}>
        {hub.medals.map((m) => {
          const t = hub.teams.find((x) => x.id === m.team_id);
          return (
            <SpotlightCard key={m.team_id} className="crown-card" theme="dark" spotlightColor="#f6d10f" intensity={0.35} spotlightSize={160} borderGlow={0.9}>
              <Link to="/teams" className="crown-team" title={t.name}>
                <TeamLogo team={t} lg />
                <b>{t.name}</b>
                <span className="small muted">{m.gold}G · {m.silver}S · {m.bronze}B</span>
              </Link>
            </SpotlightCard>
          );
        })}
      </Reveal>
      <Reveal className="grid g2" stagger={0.12}>
        <section className="card flush">
          <div className="card-h"><h2>Latest results</h2><Link className="small" to="/schedule">All fixtures</Link></div>
          {results.length ? results.map((f) => <FixtureRow key={f.id} f={f} hub={hub} />) : <div className="empty">Results appear here as soon as organisers enter them.</div>}
        </section>
        <section className="card flush">
          <div className="card-h"><h2>Medals table</h2><Link className="small" to="/medals">Full table</Link></div>
          <MedalsTable medals={hub.medals} teams={hub.teams} />
        </section>
      </Reveal>
    </>
  );
}

/** Poster hero with a GSAP entrance: poster rises in, logo spins in, headline splits in, the rest staggers. */
/** The poster leans towards the mouse in 3D (GSAP quickTo); still for touch and reduced motion. */
function PosterTilt({ children }) {
  const ref = useRef(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !window.matchMedia('(hover: hover)').matches) return undefined;
    gsap.set(el, { transformPerspective: 900 });
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });
    const move = (e) => {
      const r = el.getBoundingClientRect();
      ry(((e.clientX - r.left) / r.width - 0.5) * 14);
      rx(-((e.clientY - r.top) / r.height - 0.5) * 10);
    };
    const leave = () => { rx(0); ry(0); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, { scope: ref });
  return <div ref={ref} className="poster-tilt">{children}</div>;
}

function Landing({ hub, headline, first, started, live, upcoming }) {
  const scope = useRef(null);
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    // clearProps only what we animate, so React's inline styles (e.g. the label colour) survive
    gsap.timeline({ defaults: { ease: 'power3.out', clearProps: 'transform,opacity' } })
      .from('.landing-fx', { opacity: 0, duration: 1.8, ease: 'power1.out' }, 0)
      .from('.landing-poster', { y: 40, scale: 0.94, opacity: 0, duration: 0.9 }, 0)
      .from('.hero-logo', { scale: 0, rotation: -120, opacity: 0, duration: 0.8, ease: 'back.out(1.6)' }, '-=0.6')
      .from('.landing-side .cat', { y: 12, opacity: 0, duration: 0.5 }, '-=0.5')
      .from('.landing-side > p, .countdown > div, .landing-side .row .btn', { y: 18, opacity: 0, duration: 0.5, stagger: 0.06 }, '-=0.1')
      .from('.landing-side .side-h, .landing-side .fx', { x: 28, opacity: 0, duration: 0.5, stagger: 0.07 }, '-=0.3');
  }, { scope });

  return (
    <section className="landing" ref={scope}>
      {/* Floodlights and drifting gold sparkles behind the content (React Bits LightRays + Particles) */}
      <div className="landing-fx" aria-hidden="true">
        <Suspense fallback={null}>
          <Particles particleCount={isSmallScreen() ? 60 : 130} particleSpread={11} speed={0.06}
            particleColors={['#f6d10f', '#ffffff', '#ffd27a']} particleBaseSize={80} sizeRandomness={1.2}
            alphaParticles moveParticlesOnHover particleHoverFactor={0.5} glow={0.7} twinkle={0.6} clickBurst={false} />
          <div className="landing-rays">
            <LightRays raysOrigin="top-center" raysColor="#fff1c4" raysSpeed={0.8} lightSpread={1.1} rayLength={2.4} intensity={1.35} saturation={1.2}
              followMouse mouseInfluence={0.1} noiseAmount={0.05} distortion={0.04} glow={0.85} haze={0.35}
              cursorShadow={false} clickPulse={false} opacity={1} maxDevicePixelRatio={isSmallScreen() ? 1.25 : 1.75} />
          </div>
        </Suspense>
      </div>
      <PosterTilt>
        <GlareHover mode="loop" interval={4} glareColor="#fff6d6" glareOpacity={0.45} glareSize={35} glareAngle={-35}
          borderRadius="12px" background="transparent" className="poster-glare">
          <img className="landing-poster" src="/games-poster.webp" alt="BMESA Games ’27 — 4th to 11th December 2026. 5 classes, 1 crown." />
        </GlareHover>
      </PosterTilt>
      <div className="landing-side">
        <div className="hero-title">
          <img className="hero-logo sm" src="/bmesa-logo.png" alt="Biomedical Engineering Department logo" />
          <div>
            <div className="cat" style={{ color: 'var(--gold)' }}>BMESA Games ’27 · 5 classes, 1 crown</div>
            <SplitText tag="h1" className="landing-h1" text={headline} splitType="chars" effect="rise" trigger="load"
              delay={35} duration={0.9} textAlign="left" />
          </div>
        </div>
        <p>4–11 December · {hub.events.length} events · Football at Staff School, indoor games and esports at the BME Year 5 class.</p>
        {!started && first && <Countdown to={first} />}
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn gold" to="/fantasy">Play fantasy football</Link>
          <Link className="btn ghost" to="/schedule">Full schedule</Link>
        </div>
        <div className="dark" style={{ marginTop: 22 }}>
          <h3 className="side-h">{live.length ? 'Live & next' : 'Next up'}</h3>
          <div className="card flush" style={{ background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.12)' }}>
            {upcoming.length ? upcoming.map((f) => <FixtureRow key={f.id} f={f} hub={hub} />) : <div className="empty">No more fixtures.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Athlete of the day: the newest spotlight, with earlier ones as thumbnails to flip through. */
function Spotlight({ hub }) {
  const [i, setI] = useState(0);
  const all = hub.spotlights;
  const s = all[Math.min(i, all.length - 1)];
  const team = hub.teams.find((t) => t.id === s.team_id);
  const ev = hub.events.find((e) => e.id === s.event_id);
  return (
    <section className="card spotlight">
      {s.image_url
        ? <img className="spot-photo" src={s.image_url} alt={s.athlete} />
        : <div className="spot-photo spot-empty"><TeamLogo team={team} lg /></div>}
      <div className="spot-body">
        <div className="cat">⭐ <ShinyText text={i === 0 ? 'Athlete of the day' : 'Athlete spotlight'} color="#16248a" shineColor="#f6d10f" speed={2.4} delay={1.8} /></div>
        <h2 className="spot-name">{s.athlete}</h2>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          {team && <span className="pill"><TeamLogo team={team} /> {team.name}</span>}
          {ev && <Link className="pill" to={`/event/${ev.slug}`}>{ev.name}</Link>}
        </div>
        {s.headline && <p className="spot-headline">{s.headline}</p>}
        {s.body && <p className="spot-text">{s.body}</p>}
        <div className="small muted">{fmtShort(s.created_at)}</div>
        {all.length > 1 && (
          <div className="spot-thumbs" aria-label="Earlier spotlights">
            {all.map((x, k) => (
              <button key={x.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} title={x.athlete}>
                {x.image_url ? <img src={x.image_url} alt={x.athlete} /> : <span>{x.athlete.slice(0, 1)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function UpdatesFeed({ items }) {
  return (
    <section className="card flush updates-feed" data-lenis-prevent>
      <div className="card-h"><h2>Updates</h2></div>
      {items.length ? items.slice(0, 8).map((a) => (
        <article className="news" key={a.id}>
          <h3>{a.title}</h3>{a.body && <p>{a.body}</p>}
          <div className="small muted">{fmtShort(a.created_at)}{a.author && ` · ${a.author}`}</div>
        </article>
      )) : <div className="empty">No updates yet.</div>}
    </section>
  );
}

// ---------- Schedule ----------
export function Schedule() {
  const { data: hub, error } = useHub();
  const [params] = useSearchParams();
  if (!hub) return <Loading error={error} />;
  const cat = params.get('cat') || 'All';
  const evCat = Object.fromEntries(hub.events.map((e) => [e.id, e.category]));
  const days = new Map();
  for (const f of hub.fixtures.filter((x) => cat === 'All' || evCat[x.event_id] === cat)) {
    const k = f.starts_at ? dayKey(f.starts_at) : 'TBC';
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(f);
  }
  return (
    <>
      <h1>Schedule & results</h1>
      <div className="chips">
        {['All', ...CATS].map((c) => <Link key={c} className={`chip ${c === cat ? 'on' : ''}`} to={c === 'All' ? '/schedule' : `/schedule?cat=${c}`}>{c}</Link>)}
      </div>
      {days.size === 0 && <div className="empty">Nothing scheduled.</div>}
      {[...days.values()].map((fx) => (
        <Reveal className="day" key={fx[0].id} distance={28}>
          <div className="day-h"><h2>Day {fx[0].day ?? '?'}</h2><span className="muted">{fx[0].starts_at ? fmtDay(fx[0].starts_at) : 'Date TBC'}</span></div>
          <div className="card flush">{fx.map((f) => <FixtureRow key={f.id} f={f} hub={hub} />)}</div>
        </Reveal>
      ))}
    </>
  );
}

// ---------- Medals ----------
export function Medals() {
  const { data: hub, error } = useHub(60);
  if (!hub) return <Loading error={error} />;
  const byEvent = (id) => hub.placements.filter((p) => p.event_id === id);
  const team = (id) => hub.teams.find((t) => t.id === id);
  const done = hub.events.filter((e) => byEvent(e.id).length).length;
  const Cell = ({ ev, pos }) => {
    const p = byEvent(ev.id).find((x) => x.position === pos);
    return p ? <span className="row" style={{ gap: 6 }}><TeamName team={team(p.team_id)} />{p.note && <span className="muted small">({p.note})</span>}</span> : <span className="muted">—</span>;
  };
  return (
    <>
      <div className="row spread"><h1>Medals table</h1><span className="muted">{done} of {hub.events.length} events decided</span></div>
      <p className="muted" style={{ marginTop: -4 }}>The level with the most golds wins the main trophy (then silvers, then bronzes). Each event counts once, however many medals are handed to players.</p>
      <div className="card flush"><MedalsTable medals={hub.medals} teams={hub.teams} /></div>
      <h2 style={{ marginTop: 26 }}>Results by event</h2>
      <div className="card flush scroll-x">
        <table className="t">
          <thead><tr><th>Event</th><th><span className="medal g">G</span></th><th><span className="medal s">S</span></th><th><span className="medal b">B</span></th></tr></thead>
          <tbody>{hub.events.map((e) => (
            <tr key={e.id}><td><Link to={`/event/${e.slug}`}>{e.name}</Link></td><td><Cell ev={e} pos={1} /></td><td><Cell ev={e} pos={2} /></td><td><Cell ev={e} pos={3} /></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Events ----------
export function Events() {
  const { data: hub, error } = useHub(0);
  if (!hub) return <Loading error={error} />;
  return (
    <>
      <h1>Events</h1>
      {CATS.map((c) => {
        const evs = hub.events.filter((e) => e.category === c);
        if (!evs.length) return null;
        return (
          <div key={c}>
            <h2 style={{ marginTop: 20 }}>{c}</h2>
            <Reveal className="grid g3" stagger={0.05} distance={24}>{evs.map((e) => {
              const gold = hub.placements.find((p) => p.event_id === e.id && p.position === 1);
              const gt = gold && hub.teams.find((t) => t.id === gold.team_id);
              return (
                <Link key={e.id} className="card event-card" to={`/event/${e.slug}`}>
                  <div className="cat">{e.category}</div>
                  <h3 style={{ margin: '4px 0' }}>{e.name}</h3>
                  <div className="small muted">{e.format}</div>
                  <div className="small" style={{ marginTop: 8 }}>{gt ? <span className="row" style={{ gap: 6 }}><span className="medal g" style={{ width: 20, height: 20, fontSize: 11 }}>1</span><b>{gt.name}</b></span> : <span className="muted">{e.awards}</span>}</div>
                </Link>
              );
            })}</Reveal>
          </div>
        );
      })}
    </>
  );
}

function Bracket({ hub, ev }) {
  const fx = hub.fixtures.filter((f) => f.event_id === ev.id);
  const by = (r) => fx.filter((f) => (f.round || '').startsWith(r));
  const side = (f, s) => teamSide(f, s, hub.teams);
  const Single = ({ f }) => {
    if (!f) return null;
    const done = f.status === 'finished' && f.home_score != null;
    return (
      <div className="tie">
        {['home', 'away'].map((s) => {
          const mine = f[`${s}_score`], theirs = f[`${s === 'home' ? 'away' : 'home'}_score`];
          return <div key={s} className={`tie-row ${done && mine > theirs ? 'win' : ''}`}><TeamName team={side(f, s)} /><b className="num">{done ? mine : ''}</b></div>;
        })}
        <div className="tie-foot">{f.round} · {fmtShort(f.starts_at)}</div>
      </div>
    );
  };
  const TwoLeg = ({ label }) => {
    const legs = by(label);
    if (!legs.length) return null;
    const l1 = legs[0];
    const ids = [l1.home_team_id, l1.away_team_id];
    const agg = [0, 0];
    let complete = true;
    for (const l of legs) {
      if (l.status !== 'finished' || l.home_score == null) { complete = false; continue; }
      ids.forEach((id, i) => { if (!id) return; if (l.home_team_id === id) agg[i] += l.home_score; if (l.away_team_id === id) agg[i] += l.away_score; });
    }
    const any = legs.some((l) => l.status === 'finished');
    return (
      <div className="tie">
        {['home', 'away'].map((s, i) => <div key={s} className={`tie-row ${complete && agg[i] > agg[1 - i] ? 'win' : ''}`}><TeamName team={side(l1, s)} /><b className="num">{any ? agg[i] : ''}</b></div>)}
        <div className="tie-foot">{label} · {legs.map((l) => (l.status === 'finished' ? `${l.home_score}–${l.away_score}` : fmtShort(l.starts_at))).join(' · ')}{any && ' · aggregate'}</div>
      </div>
    );
  };
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Bracket</h2>
      <div className="bracket">
        <div className="col"><h3>Playoff</h3><Single f={by('Playoff')[0]} /></div>
        <div className="col"><h3>Semi-finals</h3><TwoLeg label="Semi-final 1" /><TwoLeg label="Semi-final 2" /></div>
        <div className="col"><h3>Final day</h3><Single f={by('Final')[0]} /><Single f={by('3rd place')[0]} /></div>
      </div>
    </section>
  );
}

export function Event() {
  const { slug } = useParams();
  const { data: hub, error } = useHub();
  if (!hub) return <Loading error={error} />;
  const ev = hub.events.find((e) => e.slug === slug);
  if (!ev) return <div className="empty">Event not found.</div>;
  const fx = hub.fixtures.filter((f) => f.event_id === ev.id);
  const pl = hub.placements.filter((p) => p.event_id === ev.id);
  return (
    <>
      <Link to="/events" className="small">← All events</Link>
      <div className="cat" style={{ marginTop: 10 }}>{ev.category}</div>
      <h1>{ev.name}</h1>
      <div className="grid g2">
        <section className="card">
          <dl className="kv">
            <dt>Format</dt><dd>{ev.format || 'TBC'}</dd>
            <dt>Players</dt><dd>{ev.players_info || 'TBC'}</dd>
            <dt>Awards</dt><dd>{ev.awards}</dd>
            {ev.venue && <><dt>Venue</dt><dd>{ev.venue}</dd></>}
            {ev.notes && <><dt>Notes</dt><dd>{ev.notes}</dd></>}
          </dl>
        </section>
        <section className="card">
          <h3>Podium</h3>
          {pl.length ? <div className="podium">{pl.map((p) => (
            <div key={p.position}><span className={`medal ${['', 'g', 's', 'b'][p.position]}`}>{p.position}</span><TeamName team={hub.teams.find((t) => t.id === p.team_id)} />{p.note && <span className="muted small">{p.note}</span>}</div>
          ))}</div> : <p className="muted">Not decided yet.</p>}
        </section>
      </div>
      {ev.slug === 'male-football' && <Bracket hub={hub} ev={ev} />}
      <section className="card flush" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Fixtures</h2></div>
        {fx.length ? fx.map((f) => <FixtureRow key={f.id} f={f} hub={hub} showEvent={false} />) : <div className="empty">No fixtures yet.</div>}
      </section>
    </>
  );
}

// ---------- Teams ----------
export function Teams() {
  const { data: hub, error } = useHub(0);
  if (!hub) return <Loading error={error} />;
  const levels = hub.teams.filter((t) => t.is_level);
  const others = hub.teams.filter((t) => !t.is_level);
  const medal = (id) => hub.medals.find((m) => m.team_id === id);
  const Card = ({ t }) => {
    const m = medal(t.id);
    return (
      <div className="card team-card">
        <TeamLogo team={t} lg />
        <h2 style={{ margin: 0 }}>{t.name}</h2>
        <div className="kit"><Shirt color={t.color} jersey={t.jersey_url} /><Shirt isGk gkJersey={t.gk_jersey_url} /></div>
        {m && <div className="small muted"><span className="medal g" style={{ width: 20, height: 20, fontSize: 11 }}>{m.gold}</span> <span className="medal s" style={{ width: 20, height: 20, fontSize: 11 }}>{m.silver}</span> <span className="medal b" style={{ width: 20, height: 20, fontSize: 11 }}>{m.bronze}</span> · Rank {m.rank}</div>}
      </div>
    );
  };
  return (
    <>
      <h1>Teams</h1>
      <p className="muted">Five levels battling for the main trophy.</p>
      <Reveal className="grid g3" stagger={0.08}>{levels.map((t) => <Card key={t.id} t={t} />)}</Reveal>
      {others.length > 0 && <><h2 style={{ marginTop: 24 }}>Other teams</h2><Reveal className="grid g3" stagger={0.08}>{others.map((t) => <Card key={t.id} t={t} />)}</Reveal></>}
    </>
  );
}
