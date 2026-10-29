import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BriefcaseBusiness, ChevronDown, CircleUserRound, ClipboardList, Cog, Compass, Hammer, House, LogOut, Menu, PackageSearch, Sprout, Tractor, UserRoundSearch, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../lib/api';
import { Brand } from './ui';
import { useToast } from './Toast';

const navConfig = [
  { to: '/app', label: 'dashboard', icon: House, roles: [] },
  { to: '/app/jobs', label: 'jobs', icon: ClipboardList, roles: ['farmer'] },
  { to: '/app/applications', label: 'applications', icon: BriefcaseBusiness, roles: ['farmer', 'labourer'] },
  { to: '/app/invitations', label: 'invitations', icon: Bell, roles: ['farmer', 'labourer'] },
  { to: '/app/assignments', label: 'assignments', icon: Sprout, roles: ['farmer', 'labourer'] },
  { to: '/app/machinery', label: 'machinery', icon: Tractor, roles: ['machinery_provider'] },
  { to: '/app/bookings', label: 'bookings', icon: PackageSearch, roles: ['farmer', 'machinery_provider'] },
  { to: '/app/notifications', label: 'notifications', icon: Bell, roles: [] },
  { to: '/app/profile', label: 'profile', icon: Cog, roles: [] },
  { to: '/app/admin', label: 'admin', icon: Users, roles: ['admin'] },
];

export function LanguageSelect({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const setLang = async (language: string) => {
    await i18n.changeLanguage(language);
    localStorage.setItem('ks.language', language);
    queryClient.setQueryData(['me'], (old: any) => old?.data?.user ? { ...old, data: { user: { ...old.data.user, preferredLanguage: language } } } : old);
    const current = queryClient.getQueryData<{ data: { user: User } }>(['me']);
    if (current?.data?.user) {
      try {
        const updated = await api<{ data: { user: User } }>('/auth/me', { method: 'PATCH', body: { preferredLanguage: language } });
        queryClient.setQueryData(['me'], updated);
      } catch { /* keep local language selection even if profile persistence is temporarily unavailable */ }
    }
  };
  return <label className={`inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink ${className}`}><span className="sr-only">{t('language')}</span><span aria-hidden="true">文</span><select value={i18n.language.slice(0, 2)} onChange={(event) => void setLang(event.target.value)} className="bg-transparent outline-none" aria-label={t('language')}><option value="en">English</option><option value="mr">मराठी</option><option value="hi">हिन्दी</option></select></label>;
}

export function PublicHeader() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<{ data: { user: User } }>('/auth/me'), retry: false, staleTime: 30000 });
  const user = data?.data?.user;
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/90 backdrop-blur-lg"><div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"><Link to="/" aria-label="Kisan Sahayak home"><Brand /></Link><nav className="hidden items-center gap-7 lg:flex"><Link className="nav-link" to="/labourers">{t('findLabour')}</Link><Link className="nav-link" to="/jobs">{t('findWork')}</Link><Link className="nav-link" to="/machinery">{t('machinery')}</Link><a className="nav-link" href="/#how-it-works">{t('howItWorks')}</a></nav><div className="hidden items-center gap-3 lg:flex"><LanguageSelect />{user ? <Link to="/app" className="inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white hover:bg-forest-dark"><CircleUserRound size={17}/>{t('dashboard')}</Link> : <><Link to="/login" className="rounded-xl px-3 py-2.5 text-sm font-bold text-ink hover:bg-white">{t('login')}</Link><Link to="/register" className="rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-forest-dark">{t('getStarted')}</Link></>}</div><div className="flex items-center gap-2 lg:hidden"><LanguageSelect className="!px-2"/><button className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button></div></div>{menuOpen && <div className="border-t border-line bg-white px-4 pb-4 pt-3 lg:hidden"><nav className="flex flex-col gap-1"><Link onClick={() => setMenuOpen(false)} className="mobile-nav-link" to="/labourers">{t('findLabour')}</Link><Link onClick={() => setMenuOpen(false)} className="mobile-nav-link" to="/jobs">{t('findWork')}</Link><Link onClick={() => setMenuOpen(false)} className="mobile-nav-link" to="/machinery">{t('machinery')}</Link><a onClick={() => setMenuOpen(false)} className="mobile-nav-link" href="/#how-it-works">{t('howItWorks')}</a>{user ? <Link onClick={() => setMenuOpen(false)} className="mobile-nav-link font-bold text-forest" to="/app">{t('dashboard')}</Link> : <div className="mt-2 grid grid-cols-2 gap-2"><Link onClick={() => setMenuOpen(false)} to="/login" className="rounded-xl border border-line py-3 text-center text-sm font-bold">{t('login')}</Link><Link onClick={() => setMenuOpen(false)} to="/register" className="rounded-xl bg-forest py-3 text-center text-sm font-bold text-white">{t('getStarted')}</Link></div>}</nav></div>}</header>;
}

export function PublicFooter() {
  const { t } = useTranslation();
  return <footer className="mt-20 border-t border-line bg-white"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_.8fr] lg:px-8"><div><Brand/><p className="mt-3 max-w-md text-sm leading-6 text-muted">Connecting farmers, agricultural workers and equipment providers through clear, practical work agreements.</p><p className="mt-3 text-xs text-muted">© {new Date().getFullYear()} Kisan Sahayak. Demo examples are clearly labelled.</p></div><div className="grid grid-cols-2 gap-5 text-sm"><div className="space-y-3"><p className="font-bold text-ink">Explore</p><Link className="block text-muted hover:text-forest" to="/jobs">{t('findWork')}</Link><Link className="block text-muted hover:text-forest" to="/labourers">{t('findLabour')}</Link><Link className="block text-muted hover:text-forest" to="/machinery">{t('machinery')}</Link></div><div className="space-y-3"><p className="font-bold text-ink">Information</p><a className="block text-muted hover:text-forest" href="/#how-it-works">{t('howItWorks')}</a><Link className="block text-muted hover:text-forest" to="/privacy">{t('privacy')}</Link><Link className="block text-muted hover:text-forest" to="/terms">{t('terms')}</Link></div></div></div></footer>;
}

export function AppLayout() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api<{ data: { user: User } }>('/auth/me'), retry: false, staleTime: 30000 });
  const user = data?.data?.user;
  const [mobileNav, setMobileNav] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<User['roles'][number] | null>(() => {
    const saved = localStorage.getItem('ks.activeRole');
    return saved ? saved as User['roles'][number] : null;
  });
  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem('ks.activeRole') as User['roles'][number] | null;
    // Admin is a permission workspace, while the three marketplace roles are stored server-side.
    const next = saved === 'admin' && user.roles.includes('admin')
      ? 'admin'
      : user.activeRole && user.roles.includes(user.activeRole)
        ? user.activeRole
        : user.roles[0] ?? 'farmer';
    setActiveRole(next);
    localStorage.setItem('ks.activeRole', next);
  }, [user?._id, user?.activeRole, user?.roles.join('|')]);
  if (isLoading) return <div className="grid min-h-screen place-items-center bg-paper"><div className="flex items-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-forest/25 border-t-forest"/>Loading your account…</div></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  const currentRole = activeRole && user.roles.includes(activeRole) ? activeRole : user.roles[0] ?? 'farmer';
  const visibleNav = navConfig.filter((item) => !item.roles.length || item.roles.includes(currentRole));
  const switchRole = async (role: 'farmer' | 'labourer' | 'machinery_provider' | 'admin') => {
    try {
      if (role === 'admin') {
        if (!user.roles.includes('admin')) throw new Error('Administrator access is required.');
      } else {
        const alreadyEnabled = user.roles.includes(role);
        const endpoint = alreadyEnabled ? '/auth/active-role' : '/auth/activate-role';
        const response = await api<{ data: { user: User } }>(endpoint, { method: 'POST', body: { role } });
        queryClient.setQueryData(['me'], response);
      }
      setActiveRole(role); localStorage.setItem('ks.activeRole', role);
      setAccountOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showToast(`Active role: ${roleNameFor(role)}.`);
    } catch (err) { showToast(err instanceof Error ? err.message : 'Could not switch role.', 'error'); }
  };
  const roleNameFor = (role: string) => ({ farmer: t('farmer'), labourer: t('labourer'), machinery_provider: t('provider'), admin: 'Administrator' } as Record<string, string>)[role] ?? role;
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } finally { queryClient.setQueryData(['me'], null); await queryClient.invalidateQueries(); navigate('/'); } };
  const roleName: Record<string, string> = { farmer: t('farmer'), labourer: t('labourer'), machinery_provider: t('provider'), admin: 'Administrator' };
  return <div className="min-h-screen bg-paper"><div className="flex min-h-screen"><aside className={`fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-line bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${mobileNav ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}><div className="flex h-[76px] items-center justify-between border-b border-line px-5"><Link to="/"><Brand/></Link><button onClick={() => setMobileNav(false)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-paper lg:hidden" aria-label="Close navigation"><X size={18}/></button></div><div className="border-b border-line p-4"><div className="rounded-2xl bg-forest-light/70 p-3.5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-white text-forest"><span className="font-extrabold">{user.name.slice(0,1).toUpperCase()}</span></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{user.name}</p><p className="mt-0.5 truncate text-xs capitalize text-muted">{roleName[currentRole]}</p></div></div><button onClick={() => setAccountOpen((v) => !v)} className="mt-3 flex w-full items-center justify-between rounded-lg bg-white/75 px-3 py-2 text-xs font-bold text-forest-dark">Switch or add role <ChevronDown size={14}/></button>{accountOpen && <div className="mt-2 grid gap-1">{(['farmer','labourer','machinery_provider'] as const).map((role) => <button key={role} onClick={() => void switchRole(role)} aria-pressed={currentRole === role} className={`rounded-lg px-3 py-2 text-left text-xs text-ink hover:bg-white ${currentRole === role ? 'bg-white font-extrabold text-forest' : ''}`}>{currentRole === role ? '✓ ' : user.roles.includes(role) ? '○ ' : '+ '}{roleName[role]}</button>)}{user.roles.includes('admin') && <button onClick={() => void switchRole('admin')} aria-pressed={currentRole === 'admin'} className={`rounded-lg px-3 py-2 text-left text-xs text-ink hover:bg-white ${currentRole === 'admin' ? 'bg-white font-extrabold text-forest' : ''}`}>{currentRole === 'admin' ? '✓ ' : '○ '}{roleName.admin}</button>}</div>}</div></div><nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">{visibleNav.map((item) => { const Icon = item.icon; return <NavLink key={item.to} end={item.to === '/app'} to={item.to} onClick={() => setMobileNav(false)} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}><Icon size={18} strokeWidth={1.9}/><span>{t(item.label)}</span></NavLink>; })}<div className="my-4 border-t border-line"/><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-muted">Marketplace</p><NavLink to="/jobs" onClick={() => setMobileNav(false)} className="sidebar-link"><Compass size={18}/>{t('browseJobs')}</NavLink><NavLink to="/labourers" onClick={() => setMobileNav(false)} className="sidebar-link"><UserRoundSearch size={18}/>{t('browseLabour')}</NavLink><NavLink to="/machinery" onClick={() => setMobileNav(false)} className="sidebar-link"><Tractor size={18}/>{t('machinery')}</NavLink></nav><div className="border-t border-line p-3"><LanguageSelect className="w-full justify-center"/><button onClick={() => void logout()} className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-red-50 hover:text-red-800"><LogOut size={17}/>{t('logout')}</button></div></aside>{mobileNav && <button className="fixed inset-0 z-40 bg-ink/30 lg:hidden" aria-label="Close navigation overlay" onClick={() => setMobileNav(false)}/>}<main className="min-w-0 flex-1"><div className="sticky top-0 z-30 flex h-[70px] items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6 lg:px-8"><div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} aria-label="Open navigation" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white lg:hidden"><Menu size={18}/></button><div className="hidden text-xs text-muted sm:block"><span className="font-bold text-ink">Kisan Sahayak</span><span className="mx-2">/</span>{roleName[currentRole]}</div><span className="text-xs text-muted sm:hidden">{roleName[currentRole]}</span></div><div className="flex items-center gap-2"><Link to="/app/notifications" className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-muted hover:text-forest" aria-label={t('notifications')}><Bell size={18}/></Link><Link to="/app/profile" className="grid h-10 w-10 place-items-center rounded-xl bg-forest text-sm font-bold text-white" aria-label={t('profile')}>{user.name.slice(0,1).toUpperCase()}</Link></div></div><div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8"><Outlet context={{ user, activeRole: currentRole }}/></div><div className="px-5 pb-5 text-center text-[11px] text-muted">Kisan Sahayak · Work offers are agreements between participants. Payments are recorded outside the platform.</div></main></div></div>;
}
