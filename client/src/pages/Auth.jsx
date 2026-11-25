import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api } from '../lib.js';

export function AuthForm({ mode }) {
  const { user, setUser, levels, toast } = useApp();
  const navigate = useNavigate();
  const [v, setV] = useState({ name: '', email: '', password: '', level: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const su = mode === 'signup';
  if (user) return <Navigate to="/fantasy" replace />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { user: u } = await api(`/api/auth/${mode}`, { body: v });
      setUser(u);
      toast(su ? `Welcome, ${u.name.split(' ')[0]}!` : 'Logged in');
      navigate('/fantasy');
    } catch (er) { setErr(er.message); }
    setBusy(false);
  }

  return (
    <div className="card auth">
      <div style={{ textAlign: 'center', marginBottom: 10 }}><img className="hero-logo" style={{ width: 84, height: 84 }} src="/bmesa-logo.png" alt="BMESA logo" /></div>
      <h1 style={{ textAlign: 'center' }}>{su ? 'Create your account' : 'Log in'}</h1>
      <form onSubmit={submit}>
        {su && <div className="field"><label htmlFor="n">Full name</label><input id="n" required maxLength={60} autoComplete="name" value={v.name} onChange={set('name')} /></div>}
        <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" required autoComplete="email" value={v.email} onChange={set('email')} /></div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" type="password" required minLength={su ? 8 : 1} autoComplete={su ? 'new-password' : 'current-password'} value={v.password} onChange={set('password')} />
          {su && <div className="small muted">At least 8 characters.</div>}
        </div>
        {su && (
          <div className="field">
            <label htmlFor="l">Your level</label>
            <select id="l" required value={v.level} onChange={set('level')}><option value="">Choose…</option>{levels.map((l) => <option key={l}>{l}</option>)}</select>
            <div className="small muted">Puts you in your level’s fantasy league.</div>
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Please wait…' : su ? 'Sign up' : 'Log in'}</button>
      </form>
      <p className="small muted" style={{ marginTop: 14 }}>
        {su ? <>Already have an account? <Link to="/login">Log in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
      </p>
    </div>
  );
}
