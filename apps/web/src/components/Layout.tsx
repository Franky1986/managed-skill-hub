import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { hasAdminRole, useAuthStore } from '../store/auth';
import { useLanguage, type LanguageCode } from '../i18n';
import { useBackgroundPolling } from '../hooks/useBackgroundPolling';
import { agentSessionsApi } from '../api/agent-sessions';

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const [proposalNotice, setProposalNotice] = useState<{ hasNewProposals: boolean; totalPending: number } | null>(null);
    const [agentAuthAreas, setAgentAuthAreas] = useState<string[]>([]);
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, isLoading, checkSession, logout, roles } = useAuthStore();
    const canReview = hasAdminRole(roles, 'reviewer');
    const { language, setLanguage, t } = useLanguage();

    const refreshProposalNotice = useCallback(async (signal: AbortSignal) => {
        try {
            const response = await adminApi.proposalNotice(signal);
            setProposalNotice(response.data);
        } catch {
            if (!signal.aborted) {
                setProposalNotice(null);
            }
        }
    }, []);

    useEffect(() => {
        void checkSession();
        agentSessionsApi.discover().then((res) => {
            const scheme = res.data.authSchemes?.find((s) => s.type === 'agent-session');
            setAgentAuthAreas(scheme?.appliesTo ?? []);
        }).catch(() => {
            setAgentAuthAreas([]);
        });
    }, [checkSession]);

    const shouldPollProposalNotice = !isLoading && isAuthenticated && canReview;
    useBackgroundPolling(refreshProposalNotice, shouldPollProposalNotice);

    useEffect(() => {
        if (shouldPollProposalNotice) {
            return;
        }

        setProposalNotice(null);
    }, [shouldPollProposalNotice]);

    const navLinkClass = (path: string) => {
        const active = location.pathname === path;
        return [
            'font-body text-body pb-1 transition-colors duration-150 active:scale-95',
            active
                ? 'text-primary border-b-2 border-primary'
                : 'text-on-surface-variant hover:text-primary',
        ].join(' ');
    };

    const handleLogout = () => {
        void logout()
            .catch(() => {})
            .finally(() => {
                navigate('/admin/login', { replace: true });
            });
    };

    return (
        <div className="bg-background text-on-background font-body min-h-screen flex flex-col">
            <nav className="bg-surface w-full top-0 sticky border-b border-outline-variant shadow-sm z-50">
                <div className="flex flex-wrap items-center justify-between gap-md px-gutter py-md max-w-[96rem] mx-auto">
                    <div className="flex flex-col items-start gap-0.5">
                        <Link to="/" className="inline-flex items-center gap-2 font-h2 text-h2 text-primary">
                            <img
                                src="/managedSkillHubLogo.png"
                                alt="ManagedSkillHub"
                                className="h-8 w-8 object-contain"
                            />
                            <span>ManagedSkillHub</span>
                        </Link>
                        <a
                            href="https://www.linkedin.com/in/frank-richter-24657078/"
                            target="_blank"
                            rel="noreferrer"
                            className="text-on-surface-variant font-small text-small hover:text-primary underline opacity-80 hover:opacity-100 transition-all"
                        >
                            {t('app.footer.by')} {t('app.footer.author')}
                        </a>
                    </div>

                    <div className="hidden md:flex items-center gap-5 flex-shrink-0">
                        <Link to="/" className={navLinkClass('/')}>{t('app.nav.explore')}</Link>
                        <Link to="/search" className={navLinkClass('/search')}>{t('app.nav.search')}</Link>
                        <Link to="/how-to-propose" className={navLinkClass('/how-to-propose')}>{t('app.nav.howToPropose')}</Link>
                        {agentAuthAreas.length > 0 && <Link to="/agent-auth" className={navLinkClass('/agent-auth')}>{t('app.nav.agentAuth')}</Link>}
                    </div>

                    <div className="ml-auto flex flex-wrap justify-end items-center gap-sm sm:gap-2">
                        <label className="sr-only" htmlFor="language-select">{t('app.language.label')}</label>
                        <select
                            id="language-select"
                            value={language}
                            onChange={(event) => setLanguage(event.target.value as LanguageCode)}
                            className="bg-surface text-on-surface border border-outline-variant px-2 py-1.5 rounded-lg font-body text-small"
                            aria-label={t('app.language.label')}
                        >
                            <option value="en">{t('app.language.en')}</option>
                            <option value="de">{t('app.language.de')}</option>
                        </select>
                        <Link
                            to="/"
                            className="bg-surface text-on-surface border border-outline-variant px-3 py-2 rounded-lg font-body text-small font-semibold hover:opacity-90 transition-opacity active:scale-95 duration-150"
                        >
                            {t('app.nav.publishedSkills')}
                        </Link>
                        {!isLoading &&
                            (isAuthenticated ? (
                                <>
                                    {canReview && <Link
                                        to="/admin/proposals"
                                        className="bg-surface text-on-surface border border-outline-variant px-3 py-2 rounded-lg font-body text-small font-semibold hover:opacity-90 transition-opacity active:scale-95 duration-150 whitespace-nowrap"
                                    >
                                        {t('app.nav.openProposals', { count: proposalNotice?.hasNewProposals ? proposalNotice.totalPending : 0 })}
                                    </Link>}
                                    <Link
                                        to="/admin/drafts"
                                        className="bg-surface text-on-surface border border-outline-variant px-3 py-2 rounded-lg font-body text-small font-semibold hover:opacity-90 transition-opacity active:scale-95 duration-150"
                                    >
                                        {t('app.nav.drafts')}
                                    </Link>
                                    <Link
                                        to="/admin/review"
                                        className="bg-surface text-on-surface border border-outline-variant px-3 py-2 rounded-lg font-body text-small font-semibold hover:opacity-90 transition-opacity active:scale-95 duration-150"
                                    >
                                        {t('app.nav.review')}
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={handleLogout}
                                        className="bg-primary text-on-primary px-3 py-2 rounded-lg font-body text-small hover:opacity-90 transition-opacity active:scale-95 duration-150"
                                    >
                                        {t('app.nav.signOut')}
                                    </button>
                                </>
                            ) : (
                                <Link
                                    to="/admin/login"
                                    className="bg-primary-container text-on-primary-container px-3 py-2 rounded-lg font-body text-small hover:opacity-90 transition-opacity active:scale-95 duration-150"
                                >
                                    {t('app.nav.signIn')}
                                </Link>
                            ))}
                    </div>
                </div>
            </nav>

            <main className="flex-grow w-full max-w-[88rem] mx-auto px-gutter py-xl">{children}</main>

            <footer className="bg-surface w-full mt-auto border-t border-outline-variant">
                <div className="flex flex-col md:flex-row justify-between items-start gap-md px-gutter py-lg max-w-[88rem] mx-auto">
                    <div className="flex items-center gap-1">
                        <span className="font-h3 text-h3 text-primary">ManagedSkillHub</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-gutter">
                        <Link
                            to="/admin"
                            className="text-on-surface-variant font-small text-small hover:text-primary underline opacity-80 hover:opacity-100 transition-all"
                        >
                            {t('common.admin')}
                        </Link>
                        <Link
                            to="/admin/agent-sessions"
                            className="text-on-surface-variant font-small text-small hover:text-primary underline opacity-80 hover:opacity-100 transition-all"
                        >
                            {t('app.nav.agentSessions')}
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
