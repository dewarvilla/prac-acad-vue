<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api, ensureCsrf } from '@/api';
import { useRouter } from 'vue-router';

const router = useRouter();

const items = ref([]);
const loading = ref(false);
const unreadCount = ref(0);

let timer = null;

const notifDisplay = computed(() => {
    const c = Number(unreadCount.value || 0);
    if (!c) return '';
    return c > 99 ? '99+' : String(c);
});

function normalizeList(data) {
    const list = Array.isArray(data) ? data : (data?.data ?? []);
    return list.map((n) => ({
        id: n.id,
        data: n.data ?? {},
        created_at: n.created_at ?? n.createdAt ?? null,
        read_at: n.read_at ?? n.readAt ?? null
    }));
}

const APPROVABLE_ROUTE_MAP = {
    'App\\\\Models\\\\Creacion': { name: 'creaciones' },
    'App\\\\Models\\\\Programacion': { name: 'programaciones' }
};

function resolveNotificationRoute(n) {
    const d = n?.data ?? {};
    const approvableType = d.approvable_type;
    const approvableId = d.approvable_id;

    if (!approvableType || !approvableId) return null;

    const entry = APPROVABLE_ROUTE_MAP[String(approvableType)];
    if (!entry?.name) return null;

    return {
        name: entry.name,
        query: {
            focus: String(approvableId),
            approval: d.approval_request_id ? String(d.approval_request_id) : undefined
        }
    };
}

async function fetchUnreadCount() {
    try {
        const { data } = await api.get('/notifications/unread-count');
        unreadCount.value = Number(data?.count ?? data?.unread ?? data?.unread_count ?? 0);
    } catch {}
}

async function fetchNotifications({ onlyUnread = true } = {}) {
    loading.value = true;
    try {
        const { data } = await api.get('/notifications', {
            params: { per_page: 10, page: 1, unread: onlyUnread ? 1 : 0 }
        });

        let list = normalizeList(data);
        if (onlyUnread) list = list.filter((n) => !n.read_at);
        items.value = list;
    } finally {
        loading.value = false;
    }
}

async function markAllRead() {
    if (!items.value.length && unreadCount.value === 0) return;
    await ensureCsrf();
    await api.post('/notifications/read-all');
    items.value = [];
    unreadCount.value = 0;
}

async function markOneRead(n) {
    await ensureCsrf();
    await api.post(`/notifications/${n.id}/read`);
    items.value = items.value.filter((x) => x.id !== n.id);
    unreadCount.value = Math.max(0, Number(unreadCount.value || 0) - 1);
}

async function handleClick(n) {
    await markOneRead(n);

    const url = n.data?.url;
    if (url) {
        if (typeof url === 'string' && url.startsWith('/')) {
            await router.push(url);
        } else {
            window.location.href = url;
        }
        return;
    }

    const route = resolveNotificationRoute(n);
    if (route) {
        await router.push(route);
        return;
    }

    const approvalRequestId = n.data?.approval_request_id;
    if (approvalRequestId) {
        await router.push({ name: 'approvalsInbox', query: { focus: String(approvalRequestId) } });
        return;
    }
}

async function handleBellClick() {
    await Promise.all([fetchUnreadCount(), fetchNotifications({ onlyUnread: true })]);
}

onMounted(async () => {
    await fetchUnreadCount();
    await fetchNotifications({ onlyUnread: true });
    timer = setInterval(fetchUnreadCount, 25000);
});

onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
});
</script>

<template>
    <div class="relative inline-block">
        <button
            type="button"
            class="layout-topbar-action relative"
            v-styleclass="{
                selector: '@next',
                enterFromClass: 'hidden',
                enterActiveClass: 'animate-scalein',
                leaveToClass: 'hidden',
                leaveActiveClass: 'animate-fadeout',
                hideOnOutsideClick: true
            }"
            @click.stop="handleBellClick"
            aria-label="Notificaciones"
        >
            <i class="pi pi-bell"></i>

            <span
                v-if="unreadCount > 0"
                :style="{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 4px',
                    borderRadius: '9999px',
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '10px',
                    lineHeight: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20
                }"
            >
                {{ notifDisplay }}
            </span>
        </button>

        <div class="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-surface-0 border rounded shadow-md text-sm hidden">
            <div class="flex items-center justify-between px-3 py-2 border-b">
                <span class="font-semibold text-sm">
                    Notificaciones
                    <span v-if="unreadCount > 0" class="ml-1 text-xs text-gray-500">({{ unreadCount }} pendientes)</span>
                </span>

                <button v-if="unreadCount > 0" type="button" class="text-xs text-primary-500 hover:underline" @click.stop="markAllRead">Marcar leídas</button>
            </div>

            <div v-if="loading" class="px-3 py-2 text-sm text-gray-500">Cargando…</div>
            <div v-else-if="!items.length" class="px-3 py-2 text-sm text-gray-500">No hay notificaciones.</div>

            <ul v-else class="max-h-80 overflow-auto px-3 py-2 space-y-2">
                <li v-for="n in items" :key="n.id" class="p-2 rounded border cursor-pointer hover:bg-surface-100 transition-colors bg-primary-50 border-primary-100" @click="handleClick(n)">
                    <div class="font-medium">{{ n.data?.title ?? 'Notificación' }}</div>
                    <div class="text-xs text-gray-600 whitespace-pre-line">{{ n.data?.message ?? '' }}</div>
                    <div v-if="n.created_at" class="text-[0.70rem] text-gray-400 mt-1">
                        {{ new Date(n.created_at).toLocaleString('es-CO') }}
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>
