import { create } from 'zustand';
import { adminApi } from '../api/admin';
import type { AdminAuthMode, AdminRole } from '../api/admin';

interface AuthState {
    isAuthenticated: boolean;
    isLoading: boolean;
    username: string | null;
    displayName: string | null;
    roles: AdminRole[];
    mode: AdminAuthMode | null;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    isAuthenticated: false,
    isLoading: true,
    username: null,
    displayName: null,
    roles: [],
    mode: null,
    login: async (username, password) => {
        await adminApi.login(username, password);
        const session = await adminApi.getSession();
        set({
            isAuthenticated: true,
            username: session.data.username,
            displayName: session.data.displayName,
            roles: session.data.roles,
            mode: session.data.mode,
        });
    },
    logout: async () => {
        await adminApi.logout();
        set({ isAuthenticated: false, username: null, displayName: null, roles: [], mode: null });
    },
    checkSession: async () => {
        try {
            const response = await adminApi.getSession();
            set({
                isAuthenticated: true,
                username: response.data.username,
                displayName: response.data.displayName,
                roles: response.data.roles,
                mode: response.data.mode,
                isLoading: false,
            });
        } catch {
            set({
                isAuthenticated: false,
                username: null,
                displayName: null,
                roles: [],
                mode: null,
                isLoading: false,
            });
        }
    },
}));
