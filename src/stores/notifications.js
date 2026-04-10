import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { defineStore } from 'pinia';

let installed = false;
const REFRESH_COOLDOWN_MS = 10000;

export const useNotificationsStore = defineStore('notifications', {
    state: () => ({
        unreadCount: 0,
        _inFlight: false,
        _lastFetchAt: 0
    }),

    actions: {
        hasActiveSession() {
            const auth = useAuthStore();

            return !!auth.me && !!localStorage.getItem('token');
        },

        clear() {
            this.unreadCount = 0;
            this._inFlight = false;
            this._lastFetchAt = 0;
        },

        async refreshUnreadCount({ force = false } = {}) {
            if (!this.hasActiveSession()) {
                this.clear();
                return;
            }

            const now = Date.now();

            if (!force && now - this._lastFetchAt < REFRESH_COOLDOWN_MS) return;
            if (this._inFlight) return;

            this._inFlight = true;
            this._lastFetchAt = now;

            try {
                const { data } = await api.get('/notifications/unread-count');
                this.unreadCount = Number(data?.count ?? data?.unread ?? data?.unread_count ?? 0);
            } catch (e) {
                if (e?.response?.status === 401) {
                    this.clear();
                    return;
                }
            } finally {
                this._inFlight = false;
            }
        },

        installAutoRefresh(router) {
            if (installed) return;
            installed = true;

            this.refreshUnreadCount({ force: true });

            router.afterEach(() => {
                this.refreshUnreadCount();
            });

            window.addEventListener('focus', () => {
                this.refreshUnreadCount();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.refreshUnreadCount();
                }
            });
        }
    }
});
