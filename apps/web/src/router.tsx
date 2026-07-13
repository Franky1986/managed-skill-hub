import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { SkillDetailPage } from './pages/SkillDetailPage';
import { SearchPage } from './pages/SearchPage';
import { HowToProposePage } from './pages/HowToProposePage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminDraftSkillsPage } from './pages/admin/AdminDraftSkillsPage';
import { AdminReviewQueuePage } from './pages/admin/AdminReviewQueuePage';
import { AdminSkillCreatePage } from './pages/admin/AdminSkillCreatePage';
import { AdminSkillPage } from './pages/admin/AdminSkillPage';
import { AdminProposalsPage } from './pages/admin/AdminProposalsPage';
import { ProposalDetailPage } from './pages/ProposalDetailPage';
import { ProposalStatusPage } from './pages/ProposalStatusPage';
import { hasAdminRole, useAuthStore } from './store/auth';
import type { AdminRole } from './api/admin';
import { LanguageProvider, useLanguage } from './i18n';

function AdminRoute() {
    const { isAuthenticated, isLoading, checkSession } = useAuthStore();
    const { t } = useLanguage();

    useEffect(() => {
        void checkSession();
    }, [checkSession]);

    if (isLoading) {
        return <div className="p-6">{t('app.loading.admin')}</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/admin/login?reason=session-expired" replace />;
    }

    return <Outlet />;
}

function AdminRoleRoute({ required }: { required: AdminRole | AdminRole[] }) {
    const roles = useAuthStore((state) => state.roles);
    return hasAdminRole(roles, required) ? <Outlet /> : <Navigate to="/admin" replace />;
}

export function AppRouter() {
    return (
        <BrowserRouter basename="/frontend">
            <LanguageProvider>
                <Routes>
                    <Route path="/" element={<Layout><Outlet /></Layout>}>
                        <Route index element={<HomePage />} />
                        <Route path="how-to-propose" element={<HowToProposePage />} />
                        <Route path="skills/:id" element={<SkillDetailPage />} />
                        <Route path="search" element={<SearchPage />} />
                        <Route path="proposals/status/:id" element={<ProposalStatusPage />} />
                        <Route path="admin/login" element={<AdminLoginPage />} />
                        <Route path="admin" element={<AdminRoute />}>
                            <Route index element={<AdminDashboardPage />} />
                            <Route path="drafts" element={<AdminDraftSkillsPage />} />
                            <Route path="review" element={<AdminReviewQueuePage />} />
                            <Route element={<AdminRoleRoute required="admin" />}>
                                <Route path="skills/new" element={<AdminSkillCreatePage />} />
                            </Route>
                            <Route path="skills/:id" element={<AdminSkillPage />} />
                            <Route element={<AdminRoleRoute required="reviewer" />}>
                                <Route path="proposals" element={<AdminProposalsPage />} />
                            </Route>
                            <Route element={<AdminRoleRoute required={['reviewer', 'publisher']} />}>
                                <Route path="proposals/:id" element={<ProposalDetailPage />} />
                            </Route>
                        </Route>
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </LanguageProvider>
        </BrowserRouter>
    );
}
