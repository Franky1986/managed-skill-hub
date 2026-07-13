import { create } from 'zustand';
import { adminApi } from '../api/admin';

interface AuthState {
    isAuthenticated: boolean;
    isLoading: boolean;
    username: string | null;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    isAuthenticated: false,
    isLoading: true,
    username: null,
    login: async (username, password) => {
        await adminApi.login(username, password);
        const session = await adminApi.getSession();
        set({ isAuthenticated: true, username: session.data.username });
    },
    logout: async () => {
        await adminApi.logout();
        set({ isAuthenticated: false, username: null });
    },
    checkSession: async () => {
        try {
            const response = await adminApi.getSession();
            set({ isAuthenticated: true, username: response.data.username, isLoading: false });
        } catch {
            set({ isAuthenticated: false, username: null, isLoading: false });
        }
    },
}));
