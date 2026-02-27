<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '@/api';
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
    'App\\Models\\Creacion': { name: 'creaciones' },
    'App\\Models\\Programacion': { name: 'programaciones' }
};

function normalizeType(t) {
    return String(t || '').replaceAll('\\\\', '\\');
}

function resolveNotificationRoute(n) {
    const d = n?.data ?? {};
    const approvableType = normalizeType(d.approvable_type);
    const approvableId = d.approvable_id;

    if (!approvableType || !approvableId) return null;

    const entry = APPROVABLE_ROUTE_MAP[approvableType];
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
    await api.post('/notifications/read-all');
    items.value = [];
    unreadCount.value = 0;
}

async function markOneRead(n) {
    await api.post(`/notifications/${n.id}/read`);
    items.value = items.value.filter((x) => x.id !== n.id);
    unreadCount.value = Math.max(0, Number(unreadCount.value || 0) - 1);
}

async function handleClick(n) {
    const d = n?.data ?? {};

    const url = d.url;
    if (url) {
        if (typeof url === 'string' && url.startsWith('/')) {
            await router.push(url);
        } else {
            window.location.href = url;
        }
        await markOneRead(n);
        return;
    }

    const route = resolveNotificationRoute(n);
    if (route) {
        await router.push(route);
        await markOneRead(n);
        return;
    }

    const approvalRequestId = d.approval_request_id;
    if (approvalRequestId) {
        await router.push({ name: 'approvalsInbox', query: { focus: String(approvalRequestId) } });
        await markOneRead(n);
        return;
    }

    await markOneRead(n);
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
