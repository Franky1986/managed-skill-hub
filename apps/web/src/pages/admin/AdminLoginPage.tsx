import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useLanguage } from '../../i18n';
import { adminApi, type AdminAuthMethodsResponse } from '../../api/admin';

export function AdminLoginPage() {
    const { t } = useLanguage();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [methods, setMethods] = useState<AdminAuthMethodsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const login = useAuthStore((s) => s.login);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const sessionExpired = searchParams.get('reason') === 'session-expired';

    useEffect(() => {
        let active = true;
        adminApi.getAuthMethods()
            .then((response) => {
                if (active) setMethods(response.data);
            })
            .catch(() => {
                if (active) setError(t('adminLogin.methodsFailed'));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [t]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        try {
            await login(username, password);
            navigate('/admin');
        } catch {
            setError(t('adminLogin.failed'));
        }
    }

    function startOidcLogin() {
        if (!methods?.loginStartUrl) return;
        const target = new URL(methods.loginStartUrl, window.location.origin);
        target.searchParams.set('returnTo', methods.adminUiBasePath);
        window.location.assign(target.toString());
    }

    return (
        <div className="mx-auto max-w-md rounded border bg-white p-6">
            <h1 className="mb-4 text-xl font-semibold">{t('adminLogin.title')}</h1>
            {sessionExpired && <p className="mb-4 text-gray-700">{t('adminLogin.sessionExpired')}</p>}
            {error && <p className="mb-4 text-red-600">{error}</p>}
            {isLoading && <p>{t('app.loading.admin')}</p>}
            {!isLoading && methods?.mode === 'oidc' && (
                <button
                    type="button"
                    onClick={startOidcLogin}
                    className="w-full rounded bg-blue-600 py-2 text-white"
                >
                    {t('adminLogin.authentik')}
                </button>
            )}
            {!isLoading && methods?.mode === 'simple' && <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="text"
                    placeholder={t('adminLogin.username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                />
                <input
                    type="password"
                    placeholder={t('adminLogin.password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                />
                <button type="submit" className="w-full rounded bg-blue-600 py-2 text-white">{t('adminLogin.submit')}</button>
            </form>}
        </div>
    );
}
