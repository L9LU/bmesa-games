import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './app-context.jsx';
import { Layout, Loading } from './components.jsx';
import * as Hub from './pages/Hub.jsx';
import { AuthForm } from './pages/Auth.jsx';

// Fantasy and Admin pages load on demand, so the home page downloads less on mobile data
const lazyPages = (load, names) => Object.fromEntries(names.map((n) => [n, lazy(() => load().then((m) => ({ default: m[n] })))]));
const Fantasy = lazyPages(() => import('./pages/Fantasy.jsx'), ['PickTeam', 'Transfers', 'Points', 'Leagues', 'JoinLeague', 'PlayerPage', 'Stats', 'Fixtures', 'Rules']);
const Admin = lazyPages(() => import('./pages/Admin.jsx'), ['Results', 'FixtureStats', 'AdminMedals', 'News', 'Players', 'TeamsAdmin', 'Gameweeks', 'Users']);

function StaffOnly({ children }) {
  const { isStaff, ready } = useApp();
  if (!ready) return <Loading />;
  if (!isStaff) return <div className="card empty">This page is for organisers. <Link to="/login">Log in</Link> with an organiser account.</div>;
  return children;
}

function App() {
  const { ready } = useApp();
  if (!ready) return null;
  const staff = (el) => <StaffOnly>{el}</StaffOnly>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Hub.Home />} />
        <Route path="schedule" element={<Hub.Schedule />} />
        <Route path="medals" element={<Hub.Medals />} />
        <Route path="events" element={<Hub.Events />} />
        <Route path="event/:slug" element={<Hub.Event />} />
        <Route path="teams" element={<Hub.Teams />} />

        <Route path="fantasy" element={<Fantasy.PickTeam />} />
        <Route path="fantasy/transfers" element={<Fantasy.Transfers />} />
        <Route path="fantasy/player/:id" element={<Fantasy.PlayerPage />} />
        <Route path="fantasy/points" element={<Fantasy.Points />} />
        <Route path="fantasy/points/:userId" element={<Fantasy.Points />} />
        <Route path="fantasy/leagues" element={<Fantasy.Leagues />} />
        <Route path="fantasy/leagues/:key" element={<Fantasy.Leagues />} />
        <Route path="fantasy/join/:code" element={<Fantasy.JoinLeague />} />
        <Route path="fantasy/stats" element={<Fantasy.Stats />} />
        <Route path="fantasy/fixtures" element={<Fantasy.Fixtures />} />
        <Route path="fantasy/rules" element={<Fantasy.Rules />} />

        <Route path="login" element={<AuthForm mode="login" />} />
        <Route path="signup" element={<AuthForm mode="signup" />} />

        <Route path="admin" element={staff(<Admin.Results />)} />
        <Route path="admin/stats/:id" element={staff(<Admin.FixtureStats />)} />
        <Route path="admin/medals" element={staff(<Admin.AdminMedals />)} />
        <Route path="admin/news" element={staff(<Admin.News />)} />
        <Route path="admin/players" element={staff(<Admin.Players />)} />
        <Route path="admin/teams" element={staff(<Admin.TeamsAdmin />)} />
        <Route path="admin/gameweeks" element={staff(<Admin.Gameweeks />)} />
        <Route path="admin/users" element={staff(<Admin.Users />)} />

        <Route path="*" element={<div className="empty">Page not found. <Link to="/">Go home</Link></div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter><App /></BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
