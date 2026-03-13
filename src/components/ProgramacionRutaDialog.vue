<script setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { getGoogleMaps } from '@/lib/googleMaps';
import { api } from '@/api';

const API_COMPUTE_ROUTE = '/compute-route';

const CATEGORIAS = [
    { id: 'I', label: 'Categoría I (Automóvil)' },
    { id: 'II', label: 'Categoría II (Bus o Camión 2 ejes)' },
    { id: 'III', label: 'Categoría III (Camión 3 ejes)' },
    { id: 'IV', label: 'Categoría IV (Camión 4 ejes)' },
    { id: 'V', label: 'Categoría V (Camión 5 ejes)' },
    { id: 'VI', label: 'Categoría VI (Camión 6 ejes)' },
    { id: 'VII', label: 'Categoría VII (Ejes adicionales)' }
];

const props = defineProps({
    visible: { type: Boolean, default: false },
    sedes: { type: Array, default: () => [] },
    originOverride: { type: Object, default: null }
});

const emit = defineEmits(['update:visible', 'picked']);

const uid = Math.random().toString(36).slice(2);
const justiId = `justi-${uid}`;
const origenId = `origen-${uid}`;
const categoriaId = `categoriaPeaje-${uid}`;
const destinoId = `destino-${uid}`;

const state = reactive({
    justificacion: '',
    origen: null,
    destino: { lat: null, lng: null, placeId: null, desc: '' },
    distancia_m: null,
    duracion_s: null,
    polyline: null,
    categoriaPeaje: 'I',
    peajes: [],
    valor_peajes_total: null
});

const loadingRoute = ref(false);
const mapEl = ref(null);

let map = null;
let originMarker = null;
let destMarker = null;
let routePolyline = null;
let mapClickListener = null;

const hasOverride = computed(() => {
    return !!props.originOverride && (props.originOverride.lat ?? props.originOverride.latitud) != null && (props.originOverride.lng ?? props.originOverride.longitud) != null;
});

const originLatLng = computed(() => {
    if (hasOverride.value) {
        const o = props.originOverride;
        return {
            lat: Number(o.lat ?? o.latitud),
            lng: Number(o.lng ?? o.longitud),
            desc: o.desc || o.label || 'Origen',
            placeId: o.placeId || null
        };
    }

    const sede = props.sedes.find((x) => x.id === state.origen);
    if (!sede) return null;

    return {
        lat: Number(sede.lat ?? sede.latitud),
        lng: Number(sede.lng ?? sede.longitud),
        desc: sede.label ?? sede.nombre ?? 'Origen',
        placeId: null
    };
});

const destinoDesc = computed(() => {
    if (state.destino.desc) return state.destino.desc;
    if (state.destino.lat != null && state.destino.lng != null) {
        return `${state.destino.lat}, ${state.destino.lng}`;
    }
    return 'Clic en el mapa para elegir destino';
});

const canSave = computed(() => {
    return !!state.justificacion.trim() && !!originLatLng.value && state.destino.lat != null && state.destino.lng != null;
});

function formatMoney(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(n);
}

function clearPolyline() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
}

function clearMarkers() {
    if (originMarker) {
        if ('map' in originMarker) originMarker.map = null;
        if (typeof originMarker.setMap === 'function') originMarker.setMap(null);
        originMarker = null;
    }

    if (destMarker) {
        if ('map' in destMarker) destMarker.map = null;
        if (typeof destMarker.setMap === 'function') destMarker.setMap(null);
        destMarker = null;
    }
}

function destroyMap() {
    if (mapClickListener && window.google?.maps?.event) {
        google.maps.event.removeListener(mapClickListener);
        mapClickListener = null;
    }

    clearMarkers();
    clearPolyline();

    map = null;

    if (mapEl.value) {
        mapEl.value.innerHTML = '';
    }
}

function createMarkerLabel(text, color) {
    const el = document.createElement('div');
    el.style.background = color;
    el.style.color = 'white';
    el.style.fontWeight = 'bold';
    el.style.fontSize = '13px';
    el.style.padding = '6px';
    el.style.borderRadius = '50%';
    el.style.width = '28px';
    el.style.height = '28px';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    el.textContent = text;
    return el;
}

function drawPolyline(path) {
    clearPolyline();

    routePolyline = new google.maps.Polyline({
        path,
        strokeColor: '#4285F4',
        strokeOpacity: 1,
        strokeWeight: 4,
        map
    });
}

function decodePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string' || encoded.length < 5) return [];

    let index = 0;
    let lat = 0;
    let lng = 0;
    const coords = [];

    while (index < encoded.length) {
        let b;
        let shift = 0;
        let result = 0;

        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);

        const dlat = result & 1 ? ~(result >> 1) : result >> 1;
        lat += dlat;

        shift = 0;
        result = 0;

        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);

        const dlng = result & 1 ? ~(result >> 1) : result >> 1;
        lng += dlng;

        coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }

    return coords;
}

function paintOriginMarker() {
    const o = originLatLng.value;
    if (!map || !o) return;

    if (originMarker) {
        if ('map' in originMarker) originMarker.map = null;
        if (typeof originMarker.setMap === 'function') originMarker.setMap(null);
        originMarker = null;
    }

    const pos = { lat: o.lat, lng: o.lng };
    const AdvMarker = google.maps.marker?.AdvancedMarkerElement;

    if (AdvMarker) {
        originMarker = new AdvMarker({
            map,
            position: pos,
            title: 'Origen',
            content: createMarkerLabel('O', '#1A73E8')
        });
    } else {
        originMarker = new google.maps.Marker({
            map,
            position: pos,
            label: 'O',
            title: 'Origen'
        });
    }
}

function paintDestMarker() {
    if (!map || state.destino.lat == null || state.destino.lng == null) return;

    const pos = { lat: Number(state.destino.lat), lng: Number(state.destino.lng) };
    const AdvMarker = google.maps.marker?.AdvancedMarkerElement;

    if (AdvMarker) {
        if (!destMarker) {
            destMarker = new AdvMarker({
                map,
                position: pos,
                title: 'Destino',
                content: createMarkerLabel('D', '#D93025')
            });
        } else {
            destMarker.position = pos;
        }
    } else {
        if (!destMarker) {
            destMarker = new google.maps.Marker({
                map,
                position: pos,
                label: 'D',
                title: 'Destino'
            });
        } else {
            destMarker.setPosition(pos);
        }
    }
}

function resetDestino() {
    state.destino = { lat: null, lng: null, placeId: null, desc: '' };
    state.distancia_m = null;
    state.duracion_s = null;
    state.polyline = null;
    state.peajes = [];
    state.valor_peajes_total = null;

    if (destMarker) {
        if ('map' in destMarker) destMarker.map = null;
        if (typeof destMarker.setMap === 'function') destMarker.setMap(null);
        destMarker = null;
    }

    clearPolyline();
}

async function initMap() {
    await getGoogleMaps();
    await nextTick();

    if (!window.google?.maps || !mapEl.value) return;

    const center = originLatLng.value ? { lat: originLatLng.value.lat, lng: originLatLng.value.lng } : { lat: 8.75, lng: -75.88 };

    destroyMap();

    map = new google.maps.Map(mapEl.value, {
        center,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        ...(import.meta.env.VITE_GMAPS_MAP_ID ? { mapId: import.meta.env.VITE_GMAPS_MAP_ID } : {})
    });

    google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        google.maps.event.trigger(map, 'resize');
    });

    paintOriginMarker();

    mapClickListener = map.addListener('click', async (e) => {
        state.destino = {
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
            placeId: null,
            desc: ''
        };

        paintDestMarker();
        await computeRouteBackend();
    });
}

async function computeRouteBackend() {
    const o = originLatLng.value;
    if (!o || state.destino.lat == null || state.destino.lng == null) return;

    try {
        loadingRoute.value = true;

        const { data } = await api.post(API_COMPUTE_ROUTE, {
            origin: { lat: o.lat, lng: o.lng },
            dest: { lat: Number(state.destino.lat), lng: Number(state.destino.lng) },
            mode: 'DRIVE',
            categoria_peaje: state.categoriaPeaje
        });

        const distance = Number(data?.distance_m ?? data?.distance ?? null);
        const duration = Number(data?.duration_s ?? data?.duration ?? null);
        const encoded = data?.polyline ?? null;
        const peajes = Array.isArray(data?.peajes) ? data.peajes : [];
        const valorPeajesTotal = data?.valor_peajes_total != null ? Number(data.valor_peajes_total) : 0;

        clearPolyline();

        if (encoded && typeof encoded === 'string') {
            const path = decodePolyline(encoded);

            if (path.length > 1) {
                drawPolyline(path);

                const bounds = new google.maps.LatLngBounds();
                path.forEach((p) => bounds.extend(p));
                map.fitBounds(bounds);

                state.polyline = encoded;
                state.distancia_m = Number.isFinite(distance) ? distance : null;
                state.duracion_s = Number.isFinite(duration) ? duration : null;
                state.peajes = peajes;
                state.valor_peajes_total = Number.isFinite(valorPeajesTotal) ? valorPeajesTotal : null;

                return;
            }
        }

        state.polyline = null;
        state.distancia_m = null;
        state.duracion_s = null;
        state.peajes = [];
        state.valor_peajes_total = null;
        clearPolyline();
    } catch (err) {
        state.polyline = null;
        state.distancia_m = null;
        state.duracion_s = null;
        state.peajes = [];
        state.valor_peajes_total = null;
        clearPolyline();

        console.error('Error en computeRouteBackend:', err?.response?.data || err?.message);
    } finally {
        loadingRoute.value = false;
    }
}

async function save() {
    const o = originLatLng.value;
    if (!o || state.destino.lat == null || state.destino.lng == null) return;

    if (state.polyline == null) {
        await computeRouteBackend();
    }

    emit('picked', {
        sede_id: state.origen ?? null,

        origen_desc: o.desc ?? '',
        origen_lat: o.lat ?? null,
        origen_lng: o.lng ?? null,

        destino_place_id: state.destino.placeId ?? null,
        destino_descripcion: state.destino.desc ?? '',
        destino_lat: state.destino.lat ?? null,
        destino_lng: state.destino.lng ?? null,

        justificacion: state.justificacion.trim(),
        categoria_vehiculo: state.categoriaPeaje,

        distancia_m: state.distancia_m,
        duracion_s: state.duracion_s,
        polyline: state.polyline,
        peajes: state.peajes,
        valor_peajes_total: state.valor_peajes_total
    });

    emit('update:visible', false);
}

watch(
    () => props.sedes,
    async (list) => {
        if (!props.visible || hasOverride.value) return;
        if (!Array.isArray(list) || !list.length) return;
        if (state.origen) return;

        state.origen = list[0].id;

        await nextTick();

        const lat = list[0].lat ?? list[0].latitud ?? null;
        const lng = list[0].lng ?? list[0].longitud ?? null;

        if (map && lat != null && lng != null) {
            map.setCenter({ lat: Number(lat), lng: Number(lng) });
            map.setZoom(13);
            paintOriginMarker();
        }
    },
    { immediate: true, deep: true }
);

watch(
    () => props.visible,
    async (v) => {
        if (v) {
            if (!hasOverride.value && !state.origen && props.sedes?.length) {
                state.origen = props.sedes[0].id;
            }

            state.justificacion = '';
            state.categoriaPeaje = 'I';
            resetDestino();

            await nextTick();
            setTimeout(async () => {
                await initMap();
            }, 250);
        } else {
            resetDestino();
            destroyMap();
        }
    }
);

watch(
    () => state.origen,
    async (newVal) => {
        if (!map || hasOverride.value) return;

        const sede = props.sedes.find((s) => s.id === newVal);
        const lat = sede?.lat ?? sede?.latitud ?? null;
        const lng = sede?.lng ?? sede?.longitud ?? null;

        if (!sede || lat == null || lng == null) return;

        const newCenter = {
            lat: Number(lat),
            lng: Number(lng)
        };

        map.setCenter(newCenter);
        map.setZoom(13);
        paintOriginMarker();

        if (state.destino.lat != null && state.destino.lng != null) {
            await computeRouteBackend();
        }
    }
);

watch(
    () => state.categoriaPeaje,
    async () => {
        if (state.destino.lat != null && state.destino.lng != null) {
            await computeRouteBackend();
        }
    }
);

onBeforeUnmount(() => {
    destroyMap();
});
</script>

<template>
    <Dialog :visible="visible" @update:visible="(v) => emit('update:visible', v)" header="Definir recorrido" :modal="true" appendTo="body" :style="{ width: '48rem' }">
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
                <label :for="justiId" class="font-medium">Justificación del recorrido</label>
                <Textarea :id="justiId" name="justificacion" v-model.trim="state.justificacion" autoResize class="p-inputtextarea p-inputtext p-component w-full" placeholder="¿Por qué se requiere este recorrido?" />
            </div>

            <div class="flex flex-col gap-2">
                <label :for="origenId" class="font-medium">Origen</label>

                <template v-if="hasOverride">
                    <InputText :id="origenId" :value="originLatLng?.desc || '—'" disabled class="p-inputtext p-component w-full" />
                    <small class="text-gray-500">Se está usando el origen heredado.</small>
                </template>

                <template v-else>
                    <Select v-model="state.origen" :options="sedes" optionLabel="label" optionValue="id" placeholder="Selecciona la sede" class="p-dropdown w-full" aria-label="Origen" />
                    <small class="text-gray-500">El origen se toma de la sede seleccionada.</small>
                </template>
            </div>

            <div class="flex flex-col gap-2">
                <label :for="categoriaId" class="font-medium">Categoría de vehículo</label>
                <Select v-model="state.categoriaPeaje" :options="CATEGORIAS" optionLabel="label" optionValue="id" class="p-dropdown w-full" aria-label="Categoría de vehículo" />
                <small class="text-gray-500">Se usará para calcular el valor estimado de peajes.</small>
            </div>

            <div class="flex flex-col gap-2">
                <label :for="destinoId" class="font-medium">Destino</label>
                <InputText :id="destinoId" name="destino" :value="destinoDesc" disabled class="p-inputtext p-component w-full" />
                <small class="text-gray-500">Haz clic en el mapa para fijar el destino.</small>
            </div>

            <div v-if="loadingRoute" class="text-sm text-surface-600">Calculando ruta y peajes...</div>

            <div v-if="state.distancia_m != null || state.duracion_s != null || state.valor_peajes_total != null" class="text-sm text-gray-700 flex flex-col gap-1">
                <div v-if="state.distancia_m != null"><b>Distancia:</b> {{ (state.distancia_m / 1000).toFixed(2) }} km</div>
                <div v-if="state.duracion_s != null"><b>Duración:</b> {{ Math.round(state.duracion_s / 60) }} min</div>
                <div v-if="state.valor_peajes_total != null"><b>Peajes estimados:</b> {{ formatMoney(state.valor_peajes_total) }}</div>
            </div>

            <div v-if="state.peajes?.length" class="border rounded-md p-3 bg-surface-50 text-sm">
                <div class="font-medium mb-2">Peajes detectados</div>
                <ul class="pl-4 list-disc flex flex-col gap-1">
                    <li v-for="(p, i) in state.peajes" :key="i">
                        {{ p.nombre || p.nombre_peaje || 'Peaje' }}
                        <span v-if="p.municipio"> - {{ p.municipio }}</span>
                        <span v-if="p.valor != null"> — {{ formatMoney(p.valor) }}</span>
                    </li>
                </ul>
            </div>

            <div class="rounded overflow-hidden border">
                <div ref="mapEl" style="height: 360px; width: 100%"></div>
            </div>

            <div class="flex items-center gap-2">
                <Button label="Cancelar" icon="pi pi-times" text @click="emit('update:visible', false)" />
                <Button label="Guardar recorrido" icon="pi pi-check" :disabled="!canSave || loadingRoute" @click="save" />
            </div>
        </div>
    </Dialog>
</template>
