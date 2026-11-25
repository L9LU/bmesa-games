import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './lib.js';

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [levels, setLevels] = useState([]);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const timer = useRef();

  useEffect(() => {
    api('/api/me').then((r) => { setUser(r.user); setLevels(r.levels); }).catch(() => {}).finally(() => setReady(true));
  }, []);

  const toast = useCallback((text, err = false) => {
    setToastMsg({ text, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const isStaff = ['organiser', 'admin'].includes(user?.role);
  return (
    <Ctx.Provider value={{ user, setUser, levels, ready, toast, isStaff }}>
      {children}
      {toastMsg && <div className={`toast ${toastMsg.err ? 'err' : ''}`} role="status">{toastMsg.text}</div>}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);

/**
 * Load data from the API. Re-fetches when `deps` change and, if `refreshSec` is set,
 * every few seconds while the tab is visible (used for live scores).
 */
export function useData(path, { refreshSec = 0, deps = [] } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await api(path), error: null, loading: false }); }
    catch (e) { setState((s) => ({ ...s, error: e.message, loading: false })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!refreshSec) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.modal')) load(true); }, refreshSec * 1000);
    return () => clearInterval(t);
  }, [load, refreshSec]);
  return { ...state, reload: () => load(true) };
}

/** Re-render every second (for countdowns). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}
