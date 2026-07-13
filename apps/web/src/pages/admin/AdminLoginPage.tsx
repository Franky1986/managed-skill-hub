import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useLanguage } from '../../i18n';

export function AdminLoginPage() {
    const { t } = useLanguage();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const login = useAuthStore((s) => s.login);
    const navigate = useNavigate();

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        try {
            await login(username, password);
            navigate('/admin');
        } catch {
            setError(t('adminLogin.failed'));
        }
    }

    return (
        <div className="mx-auto max-w-md rounded border bg-white p-6">
            <h1 className="mb-4 text-xl font-semibold">{t('adminLogin.title')}</h1>
            {error && <p className="mb-4 text-red-600">{error}</p>}
            <form onSubmit={handleSubmit} className="space-y-4">
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
            </form>
        </div>
    );
}
