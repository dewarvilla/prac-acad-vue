<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, ensureCsrf } from '@/api';
import { useRouter } from 'vue-router';

const props = defineProps({
    initialItems: {
        type: Array,
        default: () => []
    }
});

const router = useRouter();

const items = ref([]);
const loading = ref(false);

const notifCount = computed(() => items.value.length);

const notifDisplay = computed(() => {
    const c = notifCount.value;
    if (!c) return '';
    return c > 99 ? '99+' : String(c);
});

async function fetchNotifications({ onlyUnread = true } = {}) {
    loading.value = true;
    try {
        const { data } = await api.get('/notifications', {
            params: {
                per_page: 10,
                unread: onlyUnread ? 'true' : 'false'
            }
        });

        const list = Array.isArray(data) ? data : (data.data ?? []);
        items.value = list;
    } catch (e) {
        console.error('Error cargando notificaciones', e);
        if (!items.value.length && props.initialItems.length) {
            items.value = props.initialItems.map((n) => ({
                id: n.id,
                data: {
                    title: n.title,
                    message: n.message
                },
                created_at: n.createdAt,
                read_at: n.read ? new Date().toISOString() : null
            }));
        }
    } finally {
        loading.value = false;
    }
}

async function markAllRead() {
    if (!items.value.length) return;

    try {
        await ensureCsrf();
        await api.post('/notifications/read-all');
        items.value = [];
    } catch (e) {
        console.error('No se pudo marcar todas como leídas', e);
    }
}

async function markOneRead(n) {
    try {
        await ensureCsrf();
        await api.post(`/notifications/${n.id}/read`);
        items.value = items.value.filter((x) => x.id !== n.id);
    } catch (e) {
        console.error('No se pudo marcar la notificación como leída', e);
    }
}

async function handleClick(n) {
    await markOneRead(n);

    const progId = n.data?.programacion_id;
    if (progId) {
        try {
            await router.push({
                name: 'programaciones',
                query: { focus: progId }
            });
        } catch (err) {
            console.error('No se pudo navegar a programaciones', err);
        }
    }
}

async function handleBellClick() {
    await fetchNotifications({ onlyUnread: true });
}

onMounted(() => {
    fetchNotifications({ onlyUnread: true });
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
                v-if="notifCount > 0"
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
                    <span v-if="notifCount > 0" class="ml-1 text-xs text-gray-500"> ({{ notifCount }} pendientes) </span>
                </span>

                <button v-if="items.length" type="button" class="text-xs text-primary-500 hover:underline" @click="markAllRead">Marcar leídas</button>
            </div>

            <div v-if="loading" class="px-3 py-2 text-sm text-gray-500">Cargando…</div>

            <div v-else-if="!items.length" class="px-3 py-2 text-sm text-gray-500">No hay notificaciones.</div>

            <ul v-else class="max-h-80 overflow-auto px-3 py-2 space-y-2">
                <li v-for="n in items" :key="n.id" class="p-2 rounded border cursor-pointer hover:bg-surface-100 transition-colors" :class="n.read_at ? 'bg-surface-50 border-surface-200' : 'bg-primary-50 border-primary-100'" @click="handleClick(n)">
                    <div class="font-medium">
                        {{ n.data?.title ?? 'Notificación' }}
                    </div>

                    <div class="text-xs text-gray-600 whitespace-pre-line">
                        {{ n.data?.message ?? '' }}
                    </div>

                    <div v-if="n.created_at" class="text-[0.70rem] text-gray-400 mt-1">
                        {{ new Date(n.created_at).toLocaleString('es-CO') }}
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>
