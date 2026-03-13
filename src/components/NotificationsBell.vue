<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useNotificationsStore } from '@/stores/notifications';

import Popover from 'primevue/popover';
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Divider from 'primevue/divider';
import ProgressSpinner from 'primevue/progressspinner';

const router = useRouter();
const op = ref(null);

const notifs = useNotificationsStore();

const items = ref([]);
const loading = ref(false);

const unreadCount = computed(() => Number(notifs.unreadCount || 0));

const notifDisplay = computed(() => {
    const c = unreadCount.value;
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
    await api.post('/notifications/read-all');
    items.value = [];
    notifs.unreadCount = 0;
}

function resolveNotificationUrl(n) {
    return n?.data?.url ?? null;
}

async function openNotification(n) {
    const target = resolveNotificationUrl(n);
    const wasUnread = !n?.read_at;

    try {
        if (wasUnread) {
            await api.post(`/notifications/${n.id}/read`);
        }

        items.value = items.value.filter((x) => x.id !== n.id);

        if (wasUnread) {
            notifs.unreadCount = Math.max(0, unreadCount.value - 1);
        }

        op.value?.hide?.();

        if (target) {
            await router.push(target);
        }
    } catch (e) {
        console.error('No se pudo abrir la notificación', e);
    }
}

function onBellBtnClick(e) {
    op.value?.toggle?.(e);
    notifs.refreshUnreadCount();
    fetchNotifications({ onlyUnread: true });
}
</script>
<template>
    <div class="relative inline-flex">
        <button type="button" class="layout-topbar-action" aria-label="Notificaciones" @click="onBellBtnClick($event)">
            <i class="pi pi-bell"></i>
        </button>

        <span v-if="notifDisplay" class="absolute -top-1 -right-1">
            <Badge :value="notifDisplay" />
        </span>

        <Popover ref="op" :style="{ width: '360px', maxWidth: '90vw' }">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                    <i class="pi pi-bell text-surface-600" />
                    <div class="font-semibold">Notificaciones</div>
                    <Tag v-if="unreadCount > 0" :value="`${unreadCount} nuevas`" severity="info" />
                </div>

                <Button v-if="unreadCount > 0" type="button" label="Marcar todo" icon="pi pi-check" size="small" text @click="markAllRead" />
            </div>

            <Divider class="my-2" />

            <div v-if="loading" class="flex items-center justify-center py-6">
                <ProgressSpinner style="width: 28px; height: 28px" strokeWidth="4" />
            </div>

            <div v-else-if="!items.length" class="py-6 text-center text-surface-600">
                <div class="text-base font-medium">No tienes notificaciones</div>
                <div class="text-sm mt-1">Cuando tengas solicitudes o alertas aparecerán aquí.</div>
            </div>

            <div v-else class="flex flex-col gap-2">
                <button v-for="n in items" :key="n.id" type="button" class="w-full text-left p-2 rounded border hover:bg-surface-50 transition" @click="openNotification(n)">
                    <div class="font-medium truncate">
                        {{ n.data?.title ?? n.data?.asunto ?? 'Notificación' }}
                    </div>
                    <div class="text-sm text-surface-600 mt-0.5">
                        {{ n.data?.message ?? n.data?.mensaje ?? n.data?.body ?? n.data?.descripcion ?? 'Tienes una notificación pendiente.' }}
                    </div>
                </button>
            </div>
        </Popover>
    </div>
</template>
