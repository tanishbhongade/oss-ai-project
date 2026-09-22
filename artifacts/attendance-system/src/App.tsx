import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3,
  LayoutDashboard, LogOut, Menu, Plus, QrCode, RefreshCw,
  School, Users, X, XCircle,
} from 'lucide-react';
import {
  getGetClassQueryKey, getGetDashboardSummaryQueryKey, getGetLectureAttendanceQueryKey,
  getGetMeQueryKey, getListClassesQueryKey, getListLecturesQueryKey,
  useCreateClass, useCreateLecture, useGetClass, useGetDashboardSummary,
  useGetLectureAttendance, useGetMe, useJoinClass, useListClasses, useListLectures, useMarkAttendance,
  useUpsertMe,
} from '@workspace/api-client-react';
import type {
  AttendanceRecord, Class as AcademicClass, ClassDetail, Lecture, Profile, ProfileRole,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsVariant: 'blockButton' as const,
  },
  variables: {
    colorPrimary: '#202A40',
    colorForeground: '#202A40',
    colorMutedForeground: '#69707F',
    colorDanger: '#B7433D',
    colorBackground: '#FFFCF4',
    colorInput: '#FFFDF8',
    colorInputForeground: '#202A40',
    colorNeutral: '#DCD5C8',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
};

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function fmtDate(value?: string, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function fmtTime(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function initials(name = 'Student') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
      <img src={`${basePath}/logo.svg`} alt="Rollcall logo" className="size-9 rounded-xl" data-testid="img-brand-logo" />
      <span className={`display text-lg font-bold tracking-tight ${light ? 'text-sidebar-foreground' : 'text-foreground'}`}>rollcall<span className="text-accent">.</span></span>
    </Link>
  );
}

function Button({
  children, variant = 'primary', className = '', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-md',
    secondary: 'bg-accent text-accent-foreground hover:-translate-y-0.5 hover:shadow-md',
    ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-destructive text-destructive-foreground hover:brightness-95',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-55 ${styles[variant]} ${className}`} />;
}

function Card({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-2xl border bg-card shadow-sm ${className}`}>{children}</div>;
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'live' | 'closed' | 'accent' | 'danger' }) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground',
    live: 'bg-[#D8EFE9] text-[#17675C]',
    closed: 'bg-muted text-muted-foreground',
    accent: 'bg-[#FFF0C6] text-[#765510]',
    danger: 'bg-[#F8DFDC] text-[#963F39]',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.16em] text-[#887741]">{eyebrow}</p>
        <h1 className="display text-3xl font-bold text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function SkeletonPage() {
  return <div className="space-y-6 page-enter"><div className="skeleton h-10 w-64 rounded-lg" /><div className="grid gap-4 sm:grid-cols-3"><div className="skeleton h-32 rounded-2xl" /><div className="skeleton h-32 rounded-2xl" /><div className="skeleton h-32 rounded-2xl" /></div><div className="skeleton h-72 rounded-2xl" /></div>;
}

function ErrorState({ onRetry, message = 'We could not load this workspace.' }: { onRetry?: () => void; message?: string }) {
  return <Card className="flex flex-col items-center justify-center border-dashed px-6 py-16 text-center page-enter"><XCircle className="mb-4 size-10 text-destructive" /><h2 className="display text-xl font-bold">A small detour</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">{message}</p>{onRetry && <Button onClick={onRetry} variant="secondary" className="mt-6"><RefreshCw className="size-4" />Try again</Button>}</Card>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <Card className="flex flex-col items-center justify-center border-dashed px-6 py-16 text-center page-enter"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-primary"><BookOpen className="size-5" /></div><h2 className="display text-xl font-bold">{title}</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>{action && <div className="mt-6">{action}</div>}</Card>;
}

function AppShell({ children, profile }: { children: React.ReactNode; profile?: Profile }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut } = useClerk();
  const [location] = useLocation();
  const nav = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/classes', label: 'Classes', icon: School },
  ];
  return (
    <div className="noise flex min-h-[100dvh] bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar p-5 text-sidebar-foreground transition-transform md:static md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-12 flex items-center justify-between"><Logo light /><button className="text-sidebar-foreground/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X className="size-5" /></button></div>
        <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</div>
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${location.startsWith(href) ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} data-testid={`link-nav-${label.toLowerCase()}`}><Icon className="size-[18px]" />{label}{location.startsWith(href) && <ChevronRight className="ml-auto size-4 text-accent" />}</Link>)}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/55 p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent text-xs font-bold text-accent-foreground">{initials(profile?.name)}</div>
          <p className="truncate text-sm font-bold">{profile?.name || 'Your profile'}</p>
          <p className="mt-0.5 truncate text-xs text-sidebar-foreground/55">{profile?.role === 'teacher' ? 'Teacher account' : 'Student account'}</p>
          <button onClick={() => signOut({ redirectUrl: basePath || '/' })} className="mt-4 flex items-center gap-2 text-xs font-semibold text-sidebar-foreground/60 transition-colors hover:text-accent" data-testid="button-sign-out"><LogOut className="size-3.5" />Sign out</button>
        </div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-primary/20 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" data-testid="button-menu-overlay" />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/90 px-5 backdrop-blur-md md:px-10">
          <button className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu className="size-5" /></button>
          <div className="hidden text-xs font-semibold text-muted-foreground md:block">Academic workspace <span className="mx-2 text-border">/</span> {profile?.role === 'teacher' ? 'Teacher view' : 'Student view'}</div>
          <div className="ml-auto flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-xl bg-secondary text-xs font-bold text-primary">{initials(profile?.name)}</div><span className="hidden text-sm font-semibold sm:block" data-testid="text-user-name">{profile?.name}</span></div>
        </header>
        <main className="mx-auto max-w-[1440px] p-5 md:p-10">{children}</main>
      </div>
    </div>
  );
}

function Home() {
  const { isLoaded, isSignedIn } = useUser();
  if (isLoaded && isSignedIn) return <Redirect to="/dashboard" />;
  return <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground">
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10"><Logo /><div className="flex items-center gap-3"><Link href="/sign-in" className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="link-home-sign-in">Sign in</Link><Link href="/sign-up" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-home-sign-up">Create account <ArrowRight className="ml-1 inline size-4" /></Link></div></header>
    <main>
      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 pb-20 pt-14 lg:grid-cols-[1.02fr_.98fr] lg:px-10 lg:pb-28 lg:pt-24">
        <div className="relative z-10 page-enter"><Badge tone="accent"><span className="size-1.5 rounded-full bg-[#A97E1B]" />A calmer way to take attendance</Badge><h1 className="display mt-6 max-w-3xl text-5xl font-bold leading-[.98] tracking-tight sm:text-7xl">Know who’s<br /><span className="text-[#B5851E]">in the room.</span></h1><p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">Rollcall keeps every class, lecture, and check-in in one focused academic workspace—so teachers can teach and students can simply show up.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5" data-testid="link-hero-start">Start your workspace <ArrowRight className="size-4" /></Link><Link href="/sign-in" className="inline-flex items-center rounded-xl border bg-card px-5 py-3.5 text-sm font-bold hover:bg-muted" data-testid="link-hero-sign-in">I already have an account</Link></div></div>
        <div className="relative page-enter stagger-2"><div className="absolute -right-10 -top-10 size-52 rounded-full bg-accent/30 blur-3xl" /><div className="relative rounded-[2rem] border border-[#E2D7BC] bg-[#F7EFD9] p-4 shadow-lg sm:p-7"><div className="rounded-2xl bg-primary p-5 text-primary-foreground sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-primary-foreground/55">Tuesday · 09:00</p><h2 className="display mt-2 text-2xl font-bold">Human Biology</h2></div><div className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary"><Check className="size-5" /></div></div><div className="mt-10 grid grid-cols-2 gap-3"><div className="rounded-xl bg-primary-foreground/10 p-4"><p className="text-3xl font-bold">42</p><p className="mt-1 text-xs text-primary-foreground/55">Present today</p></div><div className="rounded-xl bg-primary-foreground/10 p-4"><p className="text-3xl font-bold text-accent">45</p><p className="mt-1 text-xs text-primary-foreground/55">Enrolled</p></div></div><div className="mt-3 rounded-xl bg-primary-foreground/10 p-4"><div className="mb-3 flex justify-between text-xs"><span className="text-primary-foreground/70">Attendance rate</span><span className="font-bold text-accent">93.3%</span></div><div className="h-2 rounded-full bg-primary-foreground/15"><div className="h-2 w-[93%] rounded-full bg-accent" /></div></div></div></div><div className="absolute -bottom-5 -left-5 rounded-2xl border bg-card px-4 py-3 shadow-md sm:-left-10"><div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-full bg-[#D8EFE9] text-[#17675C]"><CheckCircle2 className="size-4" /></div><div><p className="text-xs font-bold">Check-in saved</p><p className="text-[11px] text-muted-foreground">09:02 · Present</p></div></div></div></div>
      </section>
      <section className="border-y bg-[#F1E9D6]/55"><div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:grid-cols-3 lg:px-10"><div className="flex gap-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent"><CalendarDays className="size-5 text-primary" /></div><div><h3 className="font-bold">A clear class rhythm</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Classes, lectures, and attendance windows stay in their natural order.</p></div></div><div className="flex gap-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary"><Users className="size-5 text-primary" /></div><div><h3 className="font-bold">Made for the room</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Fast check-ins for students. A reliable roster for teachers.</p></div></div><div className="flex gap-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#D8EFE9]"><QrCode className="size-5 text-[#17675C]" /></div><div><h3 className="font-bold">Trust the record</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Every mark has a time, a status, and a place in the lecture.</p></div></div></div></section>
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-28"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#887741]">Built for attention</p><h2 className="display mt-4 text-4xl font-bold leading-tight sm:text-5xl">Less admin.<br />More actual class.</h2></div><div className="grid gap-5 sm:grid-cols-2"><Card className="p-6"><p className="display text-4xl font-bold text-[#B5851E]">01</p><h3 className="mt-8 text-lg font-bold">Set the window</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Publish the lecture and decide exactly when attendance opens and closes.</p></Card><Card className="p-6"><p className="display text-4xl font-bold text-[#17675C]">02</p><h3 className="mt-8 text-lg font-bold">Students check in</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">One deliberate action records their place, with late status handled automatically.</p></Card><Card className="p-6 sm:col-span-2"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="display text-4xl font-bold text-primary">03</p><h3 className="mt-4 text-lg font-bold">See the pattern</h3><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">A dashboard that keeps the week visible without turning your class into a spreadsheet.</p></div><Link href="/sign-up" className="inline-flex items-center gap-2 self-start rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground" data-testid="link-bottom-start">Build your workspace <ArrowRight className="size-4" /></Link></div></Card></div></div></section>
    </main>
    <footer className="mx-auto flex max-w-7xl justify-between border-t px-6 py-8 text-xs text-muted-foreground lg:px-10"><Logo /><span>Attendance, with a little more calm.</span></footer>
  </div>;
}

function RoleSetup({ user, onComplete }: { user: NonNullable<ReturnType<typeof useUser>['user']>; onComplete: (profile: Profile) => void }) {
  const [role, setRole] = useState<ProfileRole>('student');
  const [name, setName] = useState(user.fullName || user.firstName || '');
  const upsert = useUpsertMe();
  return <div className="min-h-[100dvh] bg-background px-5 py-10"><div className="mx-auto max-w-lg"><Logo /><Card className="mt-12 p-7 sm:p-10"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#887741]">One quick setup</p><h1 className="display mt-3 text-3xl font-bold">How will you use Rollcall?</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">This helps us shape your first view. You can always join a class or create one later.</p><label className="mt-8 block text-sm font-bold">Your name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border bg-background px-4 py-3 outline-none ring-accent transition focus:ring-2" data-testid="input-profile-name" /></label><div className="mt-6 grid gap-3 sm:grid-cols-2">{(['teacher', 'student'] as const).map((option) => <button key={option} onClick={() => setRole(option)} className={`rounded-2xl border p-4 text-left transition-all ${role === option ? 'border-accent bg-accent/15 shadow-sm' : 'hover:bg-muted'}`} data-testid={`button-role-${option}`}><div className="flex items-center justify-between"><span className="font-bold capitalize">{option}</span>{role === option && <CheckCircle2 className="size-5 text-[#A97E1B]" />}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{option === 'teacher' ? 'Create classes, publish lectures, and keep the room moving.' : 'Join classes and keep your attendance record close.'}</p></button>)}</div><Button className="mt-8 w-full" disabled={!name.trim() || upsert.isPending} onClick={() => upsert.mutate({ data: { name: name.trim(), email: user.primaryEmailAddress?.emailAddress || '', role } }, { onSuccess: onComplete })} data-testid="button-save-profile">{upsert.isPending ? 'Saving your workspace…' : 'Continue to Rollcall'}<ArrowRight className="size-4" /></Button>{upsert.isError && <p className="mt-3 text-center text-sm text-destructive">We could not save that yet. Please try again.</p>}</Card></div></div>;
}

function Dashboard({ profile }: { profile: Profile }) {
  const summaryQuery = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const summary = summaryQuery.data;
  const upcoming = summary?.recentLectures?.filter((lecture) => lecture.status !== 'closed').slice(0, 3) || [];
  if (summaryQuery.isLoading) return <SkeletonPage />;
  if (summaryQuery.isError) return <ErrorState onRetry={() => summaryQuery.refetch()} />;
  const rawRate = summary?.attendanceRate || 0;
  const rate = Math.round((rawRate <= 1 ? rawRate * 100 : rawRate) * 10) / 10;
  return <div className="page-enter"><PageTitle eyebrow={profile.role === 'teacher' ? 'Teacher overview' : 'Your week'} title={profile.role === 'teacher' ? `Good to see you, ${profile.name.split(' ')[0]}.` : `Welcome back, ${profile.name.split(' ')[0]}.`} description={profile.role === 'teacher' ? 'A quick read on your classes and the sessions ahead.' : 'Your attendance, your classes, your next check-in.'} action={<Link href="/classes" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-dashboard-classes">View classes <ArrowRight className="size-4" /></Link>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={profile.role === 'teacher' ? 'Classes you lead' : 'Classes joined'} value={summary?.totalClasses ?? 0} icon={<School className="size-5" />} />
      <StatCard label="Lectures this term" value={summary?.totalLectures ?? 0} icon={<CalendarDays className="size-5" />} />
      <StatCard label="Attendance rate" value={`${rate}%`} icon={<CheckCircle2 className="size-5" />} accent />
      <StatCard label={profile.role === 'teacher' ? 'Upcoming lectures' : 'Next check-ins'} value={summary?.upcomingLectures ?? 0} icon={<Clock3 className="size-5" />} />
    </div>
    <div className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b px-6 py-5"><div><h2 className="display text-lg font-bold">Coming up</h2><p className="mt-1 text-xs text-muted-foreground">The sessions closest to now.</p></div><CalendarDays className="size-5 text-muted-foreground" /></div>{upcoming.length ? <div className="divide-y">{upcoming.map((lecture) => <LectureRow key={lecture.id} lecture={lecture} />)}</div> : <div className="p-8"><EmptyState title="A clear stretch ahead" body="Upcoming lectures will appear here once they are scheduled." /></div>}</Card><Card className="p-6"><p className="text-xs font-bold uppercase tracking-[.15em] text-[#887741]">Your record</p><div className="mt-6 flex items-end justify-between"><div><p className="display text-5xl font-bold">{summary?.presentCount ?? 0}</p><p className="mt-1 text-sm text-muted-foreground">Present marks</p></div><div className="text-right"><p className="display text-3xl font-bold text-[#B5851E]">{summary?.lateCount ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Late marks</p></div></div><div className="mt-8 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(rate, 100)}%` }} /></div><p className="mt-3 text-xs text-muted-foreground">{rate >= 90 ? 'A dependable rhythm.' : rate >= 75 ? 'There is room to build consistency.' : 'Keep the next check-in close.'}</p></Card></div>
  </div>;
}

function StatCard({ label, value, icon, accent = false }: { label: string; value: string | number; icon: React.ReactNode; accent?: boolean }) {
  return <Card className={`p-5 ${accent ? 'bg-[#FFF6D9]' : ''}`}><div className="flex items-start justify-between"><div className={`flex size-10 items-center justify-center rounded-xl ${accent ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground'}`}>{icon}</div><span className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Live</span></div><p className="display mt-6 text-3xl font-bold" data-testid={`text-stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></Card>;
}

function LectureRow({ lecture }: { lecture: Lecture }) {
  const tone = lecture.status === 'live' ? 'live' : lecture.status === 'upcoming' ? 'accent' : 'closed';
  return <Link href={`/lectures/${lecture.id}?classId=${lecture.classId}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/70" data-testid={`link-lecture-${lecture.id}`}><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><CalendarDays className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{lecture.title}</p><p className="mt-1 text-xs text-muted-foreground">{fmtDate(lecture.startsAt, true)} · {lecture.attendanceCount}/{lecture.totalStudents} marked</p></div><Badge tone={tone}>{lecture.status === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-[#17675C]" />}{statusLabel(lecture.status)}</Badge><ChevronRight className="hidden size-4 text-muted-foreground sm:block" /></Link>;
}

function Classes({ profile }: { profile: Profile }) {
  const classesQuery = useListClasses({ query: { queryKey: getListClassesQueryKey() } });
  const create = useCreateClass();
  const join = useJoinClass();
  const client = useQueryClient();
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const classes = classesQuery.data || [];
  const close = () => { setModal(null); setName(''); setSubject(''); setCode(''); };
  const submitCreate = () => create.mutate({ data: { name: name.trim(), subject: subject.trim() } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListClassesQueryKey() }); setNotice('Class created and ready for its first lecture.'); close(); } });
  const submitJoin = () => join.mutate({ data: { code: code.trim() } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListClassesQueryKey() }); setNotice('You are in. Your class is now on the dashboard.'); close(); } });
  if (classesQuery.isLoading) return <SkeletonPage />;
  if (classesQuery.isError) return <ErrorState onRetry={() => classesQuery.refetch()} />;
  return <div className="page-enter"><PageTitle eyebrow="Your classes" title="The places you show up." description={profile.role === 'teacher' ? 'Create a class, then keep each lecture and roster in view.' : 'Everything you have joined, gathered in one reliable place.'} action={<div className="flex gap-2">{profile.role === 'student' && <Button variant="secondary" onClick={() => setModal('join')} data-testid="button-open-join-class"><Plus className="size-4" />Join class</Button>}{profile.role === 'teacher' && <Button onClick={() => setModal('create')} data-testid="button-open-create-class"><Plus className="size-4" />New class</Button>}</div>} />
    {notice && <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#B8DCD4] bg-[#E6F4F0] px-4 py-3 text-sm font-semibold text-[#17675C]" data-testid="status-class-success"><CheckCircle2 className="size-4" />{notice}<button className="ml-auto" onClick={() => setNotice('')} aria-label="Dismiss message" data-testid="button-dismiss-notice"><X className="size-4" /></button></div>}
    {classes.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{classes.map((item, index) => <ClassCard key={item.id} item={item} index={index} />)}</div> : <EmptyState title={profile.role === 'teacher' ? 'Your first class starts here' : 'No classes yet'} body={profile.role === 'teacher' ? 'Create a class to give your students a place to check in.' : 'Ask your teacher for the class code, then join in one step.'} action={profile.role === 'teacher' ? <Button onClick={() => setModal('create')} data-testid="button-empty-create-class"><Plus className="size-4" />Create a class</Button> : <Button variant="secondary" onClick={() => setModal('join')} data-testid="button-empty-join-class"><Plus className="size-4" />Join with a code</Button>} />}
    {modal && <Modal title={modal === 'create' ? 'Create a class' : 'Join a class'} onClose={close}>{modal === 'create' ? <><Field label="Class name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Human Biology" data-testid="input-class-name" /></Field><Field label="Subject"><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. BIO 204" data-testid="input-class-subject" /></Field><Button className="mt-5 w-full" disabled={!name.trim() || !subject.trim() || create.isPending} onClick={submitCreate} data-testid="button-submit-create-class">{create.isPending ? 'Creating…' : 'Create class'}<ArrowRight className="size-4" /></Button>{create.isError && <p className="mt-3 text-sm text-destructive">That class could not be created. Try again.</p>}</> : <><Field label="Class code"><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={12} placeholder="e.g. BIO204-A7" data-testid="input-join-code" /><p className="mt-2 text-xs text-muted-foreground">Use the code shared by your teacher.</p></Field><Button variant="secondary" className="mt-5 w-full" disabled={code.trim().length < 4 || join.isPending} onClick={submitJoin} data-testid="button-submit-join-class">{join.isPending ? 'Joining…' : 'Join class'}<ArrowRight className="size-4" /></Button>{join.isError && <p className="mt-3 text-sm text-destructive">We could not find that code. Check it and try again.</p>}</>}</Modal>}
  </div>;
}

function ClassCard({ item, index }: { item: AcademicClass; index: number }) {
  return <Link href={`/classes/${item.id}`} className={`group page-enter stagger-${Math.min(index + 1, 4)}`} data-testid={`card-class-${item.id}`}><Card className="h-full overflow-hidden transition-all group-hover:-translate-y-1 group-hover:shadow-md"><div className={`h-2 ${index % 3 === 0 ? 'bg-accent' : index % 3 === 1 ? 'bg-[#84C7BC]' : 'bg-primary'}`} /><div className="p-6"><div className="flex items-start justify-between gap-4"><div className="flex size-11 items-center justify-center rounded-xl bg-muted text-primary"><BookOpen className="size-5" /></div><span className="rounded-lg bg-muted px-2 py-1 font-mono text-[11px] font-bold tracking-wider text-muted-foreground">{item.code}</span></div><h2 className="display mt-8 text-xl font-bold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.subject}</p><div className="mt-8 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Users className="size-3.5" />{item.studentCount} students</span><span>{item.upcomingLectureCount} upcoming <ChevronRight className="ml-1 inline size-3.5 transition-transform group-hover:translate-x-1" /></span></div></div></Card></Link>;
}

function ClassDetailPage({ profile }: { profile: Profile }) {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const classQuery = useGetClass(id, { query: { queryKey: getGetClassQueryKey(id) } });
  const lecturesQuery = useListLectures(id, { query: { queryKey: getListLecturesQueryKey(id) } });
  const createLecture = useCreateLecture();
  const client = useQueryClient();
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', startsAt: '', endsAt: '', attendanceOpensAt: '', attendanceClosesAt: '' });
  if (classQuery.isLoading || lecturesQuery.isLoading) return <SkeletonPage />;
  if (classQuery.isError || lecturesQuery.isError || !classQuery.data) return <ErrorState onRetry={() => { classQuery.refetch(); lecturesQuery.refetch(); }} message="That class is not available right now." />;
  const item = classQuery.data as ClassDetail;
  const lectures = lecturesQuery.data || item.lectures || [];
  const updateForm = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submitLecture = () => createLecture.mutate({ classId: id, data: form }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListLecturesQueryKey(id) }); client.invalidateQueries({ queryKey: getGetClassQueryKey(id) }); setNotice('Lecture published. Its attendance window is ready.'); setModal(false); setForm({ title: '', startsAt: '', endsAt: '', attendanceOpensAt: '', attendanceClosesAt: '' }); } });
  return <div className="page-enter"><Link href="/classes" className="mb-7 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-classes">← All classes</Link><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="flex items-center gap-3"><Badge tone="accent">{item.code}</Badge><span className="text-xs text-muted-foreground">Created {fmtDate(item.createdAt)}</span></div><h1 className="display mt-4 text-4xl font-bold">{item.name}</h1><p className="mt-2 text-sm text-muted-foreground">{item.subject} · {item.teacherName}</p></div>{profile.role === 'teacher' && <Button onClick={() => setModal(true)} data-testid="button-open-create-lecture"><Plus className="size-4" />New lecture</Button>}</div>{notice && <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#B8DCD4] bg-[#E6F4F0] px-4 py-3 text-sm font-semibold text-[#17675C]" data-testid="status-lecture-success"><CheckCircle2 className="size-4" />{notice}<button className="ml-auto" onClick={() => setNotice('')} data-testid="button-dismiss-lecture-notice"><X className="size-4" /></button></div>}<div className="mb-8 grid gap-4 sm:grid-cols-3"><StatCard label="Students" value={item.studentCount} icon={<Users className="size-5" />} /><StatCard label="Upcoming" value={item.upcomingLectureCount} icon={<CalendarDays className="size-5" />} accent /><StatCard label="Subject" value={item.subject} icon={<BookOpen className="size-5" />} /></div><Card className="overflow-hidden"><div className="border-b px-6 py-5"><h2 className="display text-lg font-bold">Lectures</h2><p className="mt-1 text-xs text-muted-foreground">Open a lecture to take attendance or check in.</p></div>{lectures.length ? <div className="divide-y">{lectures.map((lecture) => <Link key={lecture.id} href={`/lectures/${lecture.id}?classId=${id}`} className="flex items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/60" data-testid={`link-class-lecture-${lecture.id}`}><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><CalendarDays className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{lecture.title}</p><p className="mt-1 text-xs text-muted-foreground">{fmtDate(lecture.startsAt, true)} · window {fmtTime(lecture.attendanceOpensAt)}–{fmtTime(lecture.attendanceClosesAt)}</p></div><div className="hidden text-right sm:block"><p className="text-sm font-bold">{lecture.attendanceCount}/{lecture.totalStudents}</p><p className="text-[11px] text-muted-foreground">marked</p></div><Badge tone={lecture.status === 'live' ? 'live' : lecture.status === 'upcoming' ? 'accent' : 'closed'}>{lecture.status === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-[#17675C]" />}{statusLabel(lecture.status)}</Badge><ChevronRight className="size-4 text-muted-foreground" /></Link>)}</div> : <div className="p-6"><EmptyState title="No lectures yet" body={profile.role === 'teacher' ? 'Publish the first lecture when you are ready to take attendance.' : 'Your teacher has not published a lecture yet.'} /></div>}</Card>{modal && <Modal title="Publish a lecture" onClose={() => setModal(false)} wide><Field label="Lecture title"><input value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="e.g. Cell structure and function" data-testid="input-lecture-title" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Starts"><input type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} data-testid="input-lecture-starts" /></Field><Field label="Ends"><input type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} data-testid="input-lecture-ends" /></Field><Field label="Attendance opens"><input type="datetime-local" value={form.attendanceOpensAt} onChange={(event) => updateForm('attendanceOpensAt', event.target.value)} data-testid="input-attendance-opens" /></Field><Field label="Attendance closes"><input type="datetime-local" value={form.attendanceClosesAt} onChange={(event) => updateForm('attendanceClosesAt', event.target.value)} data-testid="input-attendance-closes" /></Field></div><Button className="mt-5 w-full" disabled={Object.values(form).some((value) => !value) || createLecture.isPending} onClick={submitLecture} data-testid="button-submit-create-lecture">{createLecture.isPending ? 'Publishing…' : 'Publish lecture'}<ArrowRight className="size-4" /></Button>{createLecture.isError && <p className="mt-3 text-sm text-destructive">We could not publish that lecture. Check the times and try again.</p>}</Modal>}</div>;
}

function LecturePage({ profile }: { profile: Profile }) {
  const params = useParams<{ id: string }>();
  const lectureId = Number(params.id);
  const searchParams = new URLSearchParams(window.location.search);
  const classId = Number(searchParams.get('classId'));
  const attendanceQuery = useGetLectureAttendance(lectureId, { query: { queryKey: getGetLectureAttendanceQueryKey(lectureId) } });
  const classQuery = useGetClass(classId, { query: { enabled: !!classId, queryKey: getGetClassQueryKey(classId) } });
  const mark = useMarkAttendance();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const lecture = useMemo(() => classQuery.data?.lectures?.find((item) => item.id === lectureId), [classQuery.data, lectureId]);
  if (attendanceQuery.isLoading || (classId && classQuery.isLoading)) return <SkeletonPage />;
  if (attendanceQuery.isError) return <ErrorState onRetry={() => attendanceQuery.refetch()} />;
  const records = attendanceQuery.data || [];
  const canCheckIn = profile.role === 'student' && lecture?.status === 'live' && !lecture.attendanceMarked;
  const submitCheckIn = () => mark.mutate({ lectureId }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetLectureAttendanceQueryKey(lectureId) }); if (classId) client.invalidateQueries({ queryKey: getGetClassQueryKey(classId) }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice('Your attendance is saved. You are marked present.'); } });
  return <div className="page-enter"><Link href={classId ? `/classes/${classId}` : '/classes'} className="mb-7 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-lecture">← Back to class</Link><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#887741]">Lecture attendance</p><h1 className="display mt-3 text-4xl font-bold">{lecture?.title || `Lecture #${lectureId}`}</h1><p className="mt-2 text-sm text-muted-foreground">{lecture ? `${fmtDate(lecture.startsAt, true)} · window ${fmtTime(lecture.attendanceOpensAt)}–${fmtTime(lecture.attendanceClosesAt)}` : 'Attendance record and check-in'}</p></div>{lecture && <Badge tone={lecture.status === 'live' ? 'live' : lecture.status === 'upcoming' ? 'accent' : 'closed'}>{lecture.status === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-[#17675C]" />}{statusLabel(lecture.status)}</Badge>}</div>{notice && <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#B8DCD4] bg-[#E6F4F0] px-4 py-3 text-sm font-semibold text-[#17675C]" data-testid="status-check-in-success"><CheckCircle2 className="size-4" />{notice}</div>}{profile.role === 'student' && <Card className={`mb-8 overflow-hidden ${canCheckIn ? 'border-accent bg-[#FFF6D9]' : ''}`}><div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#887741]">Your check-in</p><h2 className="display mt-2 text-2xl font-bold">{canCheckIn ? 'You are in the attendance window.' : lecture?.attendanceMarked ? 'Your place is already recorded.' : lecture?.status === 'upcoming' ? 'Check-in opens closer to class.' : lecture?.status === 'closed' ? 'This attendance window is closed.' : 'Open the class link to check in.'}</h2><p className="mt-2 text-sm text-muted-foreground">{canCheckIn ? 'One tap records your arrival for this lecture.' : 'Your attendance record stays attached to this lecture.'}</p></div>{canCheckIn && <Button variant="secondary" disabled={mark.isPending} onClick={submitCheckIn} className="shrink-0 px-6" data-testid="button-mark-attendance">{mark.isPending ? 'Saving…' : 'Check in now'}<Check className="size-4" /></Button>}{mark.isError && <p className="text-sm text-destructive">Check-in did not go through. Please try again.</p>}</div></Card>}{profile.role === 'teacher' && <div className="mb-5 flex items-center justify-between"><div><h2 className="display text-xl font-bold">Attendance record</h2><p className="mt-1 text-sm text-muted-foreground">{records.length} student{records.length === 1 ? '' : 's'} marked for this lecture.</p></div><div className="flex gap-2"><Badge tone="live"><CheckCircle2 className="size-3.5" />{records.filter((record) => record.status === 'present').length} present</Badge><Badge tone="accent">{records.filter((record) => record.status === 'late').length} late</Badge></div></div>}{profile.role === 'teacher' ? <Card className="overflow-hidden">{records.length ? <div className="divide-y">{records.map((record) => <AttendanceRow key={record.id} record={record} />)}</div> : <EmptyState title="No marks yet" body="When students check in, their attendance will appear here with a timestamp." />}</Card> : <Card className="p-6"><div className="flex items-center gap-4"><div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Clock3 className="size-5" /></div><div><p className="text-sm font-bold">Attendance is recorded per lecture</p><p className="mt-1 text-xs text-muted-foreground">Your teacher can see the timestamp and whether you arrived on time.</p></div></div></Card>}</div>;
}

function AttendanceRow({ record }: { record: AttendanceRecord }) {
  return <div className="flex items-center gap-4 px-6 py-4" data-testid={`row-attendance-${record.id}`}><div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">{initials(record.studentName)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{record.studentName}</p><p className="truncate text-xs text-muted-foreground">{record.studentEmail}</p></div><div className="text-right"><Badge tone={record.status === 'present' ? 'live' : 'accent'}>{record.status === 'present' && <Check className="size-3" />}{statusLabel(record.status)}</Badge><p className="mt-1 text-[11px] text-muted-foreground">{fmtDate(record.markedAt, true)}</p></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-4 block text-sm font-bold first:mt-0">{label}{children}</label>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"><div className={`max-h-[90dvh] w-full overflow-auto rounded-2xl border bg-card p-6 shadow-lg sm:p-8 ${wide ? 'max-w-2xl' : 'max-w-md'}`}><div className="mb-5 flex items-center justify-between"><h2 className="display text-xl font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close dialog" data-testid="button-close-dialog"><X className="size-5" /></button></div>{children}</div></div>;
}

function AuthPage({ type }: { type: 'sign-in' | 'sign-up' }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><div className="absolute left-6 top-6"><Logo /></div>{type === 'sign-in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div>;
}

function ProfileGate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn, user } = useUser();
  const profileQuery = useGetMe({ query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() } });
  const [profile, setProfile] = useState<Profile>();
  if (!clerkLoaded) return <SkeletonPage />;
  if (!isSignedIn) return <Redirect to="/" />;
  if (profileQuery.isLoading || !user) return <SkeletonPage />;
  if (profileQuery.isError || !profileQuery.data) return <RoleSetup user={user} onComplete={(next) => { setProfile(next); queryClient.setQueryData(getGetMeQueryKey(), next); }} />;
  return <AppShell profile={profile || profileQuery.data}>{children(profile || profileQuery.data)}</AppShell>;
}

function ProtectedRoute({ page }: { page: (profile: Profile) => React.ReactNode }) {
  return <ProfileGate>{page}</ProfileGate>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/sign-in/*?" component={() => <AuthPage type="sign-in" />} /><Route path="/sign-up/*?" component={() => <AuthPage type="sign-up" />} /><Route path="/dashboard">{() => <ProtectedRoute page={(profile) => <Dashboard profile={profile} />} />}</Route><Route path="/classes">{() => <ProtectedRoute page={(profile) => <Classes profile={profile} />} />}</Route><Route path="/classes/:id">{() => <ProtectedRoute page={(profile) => <ClassDetailPage profile={profile} />} />}</Route><Route path="/lectures/:id">{() => <ProtectedRoute page={(profile) => <LecturePage profile={profile} />} />}</Route><Route><NotFound /></Route></Switch></ErrorBoundary>;
}

function NotFound() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6"><Card className="max-w-md p-8 text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent"><School className="size-5" /></div><h1 className="display mt-5 text-2xl font-bold">This page wandered off.</h1><p className="mt-2 text-sm text-muted-foreground">The class space you are looking for does not exist.</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home">Back home</Link></Card></div>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) return <div className="flex min-h-[100dvh] items-center justify-center p-6 text-center"><p className="max-w-md text-sm text-destructive">Clerk is not configured for this workspace yet.</p></div>;
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Your class space is waiting.' } }, signUp: { start: { title: 'Create your account', subtitle: 'A clearer way to show up.' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

export default App;