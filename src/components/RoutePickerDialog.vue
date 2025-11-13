<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { getGoogleMaps } from '@/lib/googleMaps';
import { api, ensureCsrf } from '@/api';

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

/* ===== IDs únicos accesibles ===== */
const uid = Math.random().toString(36).slice(2);
const justiId = `justi-${uid}`;
const origenId = `origen-${uid}`;
const categoriaId = `categoriaPeaje-${uid}`;
const destinoId = `destino-${uid}`;

/* ===== Estado ===== */
const state = reactive({
    justificacion: '',
    origen: null,
    destino: { lat: null, lng: null, placeId: null, desc: '' },
    distancia_m: null,
    duracion_s: null,
    polyline: null,
    categoriaPeaje: 'I'
});
const justiRef = ref(null);

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

function decodePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string' || encoded.length < 5) return [];
    let index = 0,
        lat = 0,
        lng = 0,
        coords = [];

    while (index < encoded.length) {
        let b,
            shift = 0,
            result = 0;
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

async function initMap() {
    await getGoogleMaps();
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
        await ensureCsrf();

        const { data } = await api.post('/compute-route', {
            origin: { lat: o.lat, lng: o.lng },
            dest: { lat: state.destino.lat, lng: state.destino.lng },
            mode: 'DRIVE'
        });

        const distance = Number(data?.distance_m ?? data?.distance ?? null);
        const duration = Number(data?.duration_s ?? data?.duration ?? null);
        const encoded = data?.polyline ?? null;

        clearPolyline();

        if (encoded && typeof encoded === 'string') {
            const path = decodePolyline(encoded);
            if (path.length > 1) {
                drawPolyline(path);
                const bounds = new google.maps.LatLngBounds();
                path.forEach((p) => bounds.extend(p));
                map.fitBounds(bounds);

                state.polyline = encoded;
                state.distancia_m = distance;
                state.duracion_s = duration;
                return;
            }
        }

        console.warn('Ruta sin polyline o con datos insuficientes:', data);
        state.polyline = null;
        state.distancia_m = null;
        state.duracion_s = null;
        clearPolyline();
    } catch (err) {
        console.error('Error en computeRouteBackend:', err.response?.data || err.message);
        state.polyline = null;
        state.distancia_m = null;
        state.duracion_s = null;
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

watch(
    () => state.origen,
    async (newVal, oldVal) => {
        if (!map || hasOverride.value) return;
        const nuevaSede = props.sedes.find((s) => s.id === newVal);
        if (nuevaSede && nuevaSede.lat != null && nuevaSede.lng != null) {
            const newCenter = { lat: +nuevaSede.lat, lng: +nuevaSede.lng };
            map.setCenter(newCenter);
            map.setZoom(13);
            if (originMarker) {
                originMarker.setMap?.(null);
                originMarker = null;
            }
            const AdvMarker = google.maps.marker?.AdvancedMarkerElement;
            if (AdvMarker) {
                originMarker = new AdvMarker({ position: newCenter, map, title: 'Origen' });
            } else {
                originMarker = new google.maps.Marker({ position: newCenter, map, label: 'O' });
            }
            if (state.destino.lat != null && state.destino.lng != null) {
                await computeRouteBackend();
            }
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
    <Dialog :visible="visible" @update:visible="(v) => emit('update:visible', v)" header="Definir recorrido" :modal="true" appendTo="body" :style="{ width: '48rem' }">
        <div class="flex flex-col gap-4">
            <!-- === Justificación === -->
            <div class="flex flex-col gap-2">
                <label :for="justiId" class="font-medium">Justificación del recorrido</label>
                <Textarea :id="justiId" name="justificacion" ref="justiRef" v-model.trim="state.justificacion" autoResize class="p-inputtextarea p-inputtext p-component w-full" placeholder="¿Por qué se requiere este recorrido?" />
            </div>
            <!-- === Origen === -->
            <div class="flex flex-col gap-2">
                <span class="font-medium">Origen</span>
                <Select v-model="state.origen" :options="sedes" optionLabel="label" optionValue="id" placeholder="Selecciona la sede" class="p-dropdown w-full" aria-label="Origen" />
                <small class="text-gray-500"> El origen se toma de la sede seleccionada. </small>
            </div>

            <!-- === Categoría de vehículo === -->
            <div class="flex flex-col gap-2">
                <span class="font-medium">Categoría de vehículo</span>
                <Select v-model="state.categoriaPeaje" :options="CATEGORIAS" optionLabel="label" optionValue="id" class="p-dropdown w-full" aria-label="Categoría de vehículo" />
                <small class="text-gray-500"> Se usará para calcular el valor total de peajes. </small>
            </div>

            <!-- === Destino === -->
            <div class="flex flex-col gap-2">
                <label :for="destinoId" class="font-medium">Destino</label>
                <InputText :id="destinoId" name="destino" :value="destinoDesc" disabled class="p-inputtext p-component w-full" />
                <small class="text-gray-500">Haz clic en el mapa para fijar el destino.</small>
            </div>

            <!-- === Info === -->
            <div v-if="state.distancia_m != null || state.duracion_s != null" class="text-sm text-gray-700">
                <span v-if="state.distancia_m != null"> <b>Distancia:</b> {{ (state.distancia_m / 1000).toFixed(2) }} km </span>
                <span v-if="state.duracion_s != null" class="ml-3"> <b>Duración:</b> {{ Math.round(state.duracion_s / 60) }} min </span>
            </div>

            <!-- === Botones === -->
            <div class="flex items-center gap-2">
                <Button label="Cancelar" icon="pi pi-times" text @click="$emit('update:visible', false)" />
                <Button label="Guardar recorrido" icon="pi pi-check" :disabled="!canSave" @click="save" />
            </div>

            <!-- === Mapa === -->
            <div class="rounded overflow-hidden border">
                <div ref="mapEl" style="height: 360px; width: 100%"></div>
            </div>
        </div>
    </Dialog>
</template>
