<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { Loader } from '@googlemaps/js-api-loader';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api/v1';

let gmapsPromise = null;
function ensureGoogle() {
    if (gmapsPromise) return gmapsPromise;
    const key = import.meta.env.VITE_GMAPS_KEY;
    if (!key) {
        console.error('Falta VITE_GMAPS_KEY en .env.local');
        gmapsPromise = Promise.resolve(null);
        return gmapsPromise;
    }
    const loader = new Loader({
        apiKey: key,
        version: 'weekly',
        libraries: ['geometry', 'marker']
    });

    gmapsPromise = loader.load();
    return gmapsPromise;
}

/* ===== Categorías de vehículo ===== */
const CATEGORIAS = [
    { id: 'I', label: 'Categoría I (Automóvil)' },
    { id: 'II', label: 'Categoría II (Bus o Camión 2 ejes)' },
    { id: 'III', label: 'Categoría III (Camión 3 ejes)' },
    { id: 'IV', label: 'Categoría IV (Camión 4 ejes)' },
    { id: 'V', label: 'Categoría V (Camión 5 ejes)' },
    { id: 'VI', label: 'Categoría VI (Camión 6 ejes)' },
    { id: 'VII', label: 'Categoría VII (Ejes adicionales)' }
];

/* ===== Props / Emits ===== */
const props = defineProps({
    visible: { type: Boolean, default: false },
    sedes: { type: Array, default: () => [] },
    originOverride: { type: Object, default: null }
});
const emit = defineEmits(['update:visible', 'picked']);

/* ===== Estado ===== */
const justiRef = ref(null);
const state = reactive({
    justificacion: '',
    origen: null,
    destino: { lat: null, lng: null, placeId: null, desc: '' },
    distancia_m: null,
    duracion_s: null,
    polyline: null,
    categoriaPeaje: 'I'
});

/* ===== Derivados ===== */
const hasOverride = computed(() => !!props.originOverride && props.originOverride.lat != null && props.originOverride.lng != null);
const originLatLng = computed(() => {
    if (hasOverride.value) {
        const o = props.originOverride;
        return { lat: +o.lat, lng: +o.lng, desc: o.desc || 'Origen (último destino)', placeId: o.placeId || null };
    }
    const s = props.sedes.find((x) => x.id === state.origen);
    return s ? { lat: s.lat, lng: s.lng, desc: s.label, placeId: null } : null;
});
const originText = computed(() => originLatLng.value?.desc || '—');
const destinoDesc = computed(() => state.destino.desc || (state.destino.lat != null ? `${state.destino.lat}, ${state.destino.lng}` : 'Clic en el mapa para elegir destino'));
const canSave = computed(() => !!state.justificacion && !!originLatLng.value && state.destino.lat != null && state.destino.lng != null);

/* ===== Google Map ===== */
const mapEl = ref(null);
let map = null;
let originMarker = null;
let destMarker = null;
let routePolyline = null;

function clearPolyline() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
}

function drawPolyline(path) {
    clearPolyline();
    routePolyline = new google.maps.Polyline({
        path,
        strokeColor: '#4285F4',
        strokeOpacity: 1.0,
        strokeWeight: 4
    });
    routePolyline.setMap(map);
}

function decodePolyline(str) {
    let index = 0,
        lat = 0,
        lng = 0,
        coords = [];
    while (index < str.length) {
        let b,
            shift = 0,
            result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = result & 1 ? ~(result >> 1) : result >> 1;
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = result & 1 ? ~(result >> 1) : result >> 1;
        lng += dlng;
        coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return coords;
}

async function initMap() {
    await ensureGoogle();
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

    await nextTick();
    setTimeout(() => {
        map.addListener('click', async (e) => {
            state.destino = {
                lat: e.latLng.lat(),
                lng: e.latLng.lng(),
                placeId: null,
                desc: ''
            };
            paintDestMarker();
            await computeRouteBackend();
        });
    }, 400);

    paintOriginMarker();
}

/* === AdvancedMarkerElement compatible === */
function paintOriginMarker() {
    const o = originLatLng.value;
    if (!map || !o) return;
    const pos = { lat: o.lat, lng: o.lng };
    const AdvMarker = google.maps.marker?.AdvancedMarkerElement;
    if (AdvMarker) {
        originMarker = new AdvMarker({ position: pos, map, title: 'Origen' });
    } else {
        originMarker = new google.maps.Marker({ position: pos, map, label: 'O' });
    }
}

function paintDestMarker() {
    if (!map || state.destino.lat == null) return;
    const pos = { lat: state.destino.lat, lng: state.destino.lng };
    const AdvMarker = google.maps.marker?.AdvancedMarkerElement;
    if (AdvMarker) {
        if (!destMarker) destMarker = new AdvMarker({ position: pos, map, title: 'Destino' });
        else destMarker.position = pos;
    } else {
        if (!destMarker) destMarker = new google.maps.Marker({ position: pos, map, label: 'D' });
        else destMarker.setPosition(pos);
    }
}

async function computeRouteBackend() {
    const o = originLatLng.value;
    if (!o || state.destino.lat == null) return;
    try {
        const { data } = await axios.post(
            `${API_BASE}/compute-route`,
            {
                origin: { lat: o.lat, lng: o.lng },
                dest: { lat: state.destino.lat, lng: state.destino.lng },
                mode: 'DRIVE'
            },
            { timeout: 15000 }
        );

        state.distancia_m = Number(data?.distance_m ?? data?.distance ?? null);
        state.duracion_s = Number(data?.duration_s ?? data?.duration ?? null);
        state.polyline = data?.polyline ?? null;

        if (state.polyline) {
            const path = decodePolyline(state.polyline);
            drawPolyline(path);
            if (path.length) {
                const bounds = new google.maps.LatLngBounds();
                path.forEach((p) => bounds.extend(p));
                map.fitBounds(bounds);
            }
        } else {
            clearPolyline();
        }
    } catch (err) {
        console.warn('compute-route error:', err?.message || err);
        state.distancia_m = null;
        state.duracion_s = null;
        state.polyline = null;
        clearPolyline();
    }
}

function resetDestino() {
    state.destino = { lat: null, lng: null, placeId: null, desc: '' };
    state.distancia_m = null;
    state.duracion_s = null;
    state.polyline = null;

    if (destMarker) {
        destMarker.setMap?.(null);
        destMarker = null;
    }
    clearPolyline();
}

function destroyMap() {
    if (destMarker) {
        destMarker.setMap?.(null);
        destMarker = null;
    }
    if (originMarker) {
        originMarker.setMap?.(null);
        originMarker = null;
    }
    clearPolyline();
    map = null;
}

/* ===== Watchers ===== */
watch(
    () => props.visible,
    async (v) => {
        if (v) {
            if (!hasOverride.value && !state.origen && props.sedes?.length) {
                state.origen = props.sedes[0].id;
            }
            state.justificacion = '';
            resetDestino();
            destroyMap();
            await nextTick();
            setTimeout(async () => {
                await initMap();
            }, 600);
        } else {
            resetDestino();
            destroyMap();
        }
    }
);

/* ===== Guardar ===== */
async function save() {
    const o = originLatLng.value;
    if (!o || state.destino.lat == null || state.destino.lng == null) return;
    if (state.polyline == null) await computeRouteBackend();

    emit('picked', {
        origen_place_id: o.placeId ?? null,
        origen_desc: o.desc ?? '',
        origen_lat: o.lat ?? null,
        origen_lng: o.lng ?? null,
        destino_place_id: state.destino.placeId,
        destino_desc: state.destino.desc,
        destino_lat: state.destino.lat,
        destino_lng: state.destino.lng,
        justificacion: state.justificacion,
        distancia_m: state.distancia_m,
        duracion_s: state.duracion_s,
        polyline: state.polyline,
        categoria_peaje: state.categoriaPeaje
    });
    emit('update:visible', false);
}
</script>

<template>
    <Dialog :visible="visible" @update:visible="(v) => emit('update:visible', v)" header="Definir recorrido" :modal="true" :style="{ width: '48rem' }">
        <div class="flex flex-col gap-4">
            <!-- === Justificación === -->
            <div class="flex flex-col gap-2">
                <label for="justificacion" class="font-medium">Justificación del recorrido</label>
                <Textarea id="justificacion" ref="justiRef" v-model.trim="state.justificacion" autoResize placeholder="¿Por qué se requiere este recorrido?" />
            </div>

            <!-- === Origen === -->
            <div class="flex flex-col gap-2">
                <label for="origen" class="font-medium">Origen</label>
                <template v-if="hasOverride">
                    <InputText id="origen" :value="originText" disabled />
                    <small class="text-gray-500">El origen está bloqueado al último destino.</small>
                </template>
                <template v-else>
                    <Select id="origen" v-model="state.origen" :options="sedes" optionLabel="label" optionValue="id" placeholder="Selecciona la sede" />
                    <small class="text-gray-500">El origen se toma de la sede seleccionada.</small>
                </template>
            </div>

            <!-- === Categoría de vehículo === -->
            <div class="flex flex-col gap-2">
                <label for="categoriaPeaje" class="font-medium">Categoría de vehículo</label>
                <Select id="categoriaPeaje" v-model="state.categoriaPeaje" :options="CATEGORIAS" optionLabel="label" optionValue="id" />
                <small class="text-gray-500">Se usará para calcular el valor total de peajes.</small>
            </div>

            <!-- === Destino === -->
            <div class="flex flex-col gap-2">
                <label for="destino" class="font-medium">Destino</label>
                <InputText id="destino" :value="destinoDesc" disabled />
                <small class="text-gray-500">Haz clic en el mapa para fijar el destino.</small>
            </div>

            <!-- === Información de distancia, duración === -->
            <div v-if="state.distancia_m != null || state.duracion_s != null" class="text-sm text-gray-700" id="infoRuta">
                <span v-if="state.distancia_m != null"><b>Distancia:</b> {{ (state.distancia_m / 1000).toFixed(2) }} km</span>
                <span v-if="state.duracion_s != null" class="ml-3"><b>Duración:</b> {{ Math.round(state.duracion_s / 60) }} min</span>
            </div>

            <!-- === Botones === -->
            <div class="flex items-center gap-2">
                <Button label="Cancelar" icon="pi pi-times" text @click="$emit('update:visible', false)" :pt="{ root: { 'aria-label': 'Cancelar definición de recorrido' } }" />
                <Button label="Guardar recorrido" icon="pi pi-check" :disabled="!canSave" @click="save" :pt="{ root: { 'aria-label': 'Guardar recorrido definido' } }" />
            </div>

            <!-- === Mapa === -->
            <div class="rounded overflow-hidden border" id="mapaRecorrido">
                <div ref="mapEl" style="height: 360px; width: 100%"></div>
            </div>
        </div>
    </Dialog>
</template>
