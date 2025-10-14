<script setup>
import { ref, watch, computed, nextTick } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

/* Props / Emits */
const props = defineProps({
    visible: { type: Boolean, default: false },
    sedes: { type: Array, default: () => [] }, // [{id,label,lat,lng,desc}]
    deferred: { type: Boolean, default: false }
});
const emit = defineEmits(['update:visible', 'picked']);

const toast = useToast();

/* API base (Laravel) */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api/v1';

/* Estado UI */
const visibleLocal = ref(false);
watch(
    () => props.visible,
    (v) => (visibleLocal.value = v)
);
watch(visibleLocal, (v) => emit('update:visible', v));

const sedeId = ref(props.sedes?.[0]?.id || null);
const destinoPlace = ref(null); // {lat,lng}
const justificacion = ref('');
const distanciaTxt = ref('');
const duracionTxt = ref('');

const sedeSel = computed(() => props.sedes.find((s) => s.id === sedeId.value) || null);
const readyToSave = computed(() => !!(sedeSel.value && destinoPlace.value && distanciaTxt.value));

/* Google Maps */
const mapEl = ref(null);
let maps, map, dirSvc, dirRenderer, originMarker, destMarker, mapClickListener;

/* Anti-spam / optimizaciones */
const COOLDOWN_MS = 2500;
let cooldownTimer = null;
const cooldownActive = ref(false);
let lastComputedKey = null; // firma "oLat,oLng|dLat,dLng" del último cálculo exitoso

function fmtLatLng(p) {
    return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

function reset() {
    destinoPlace.value = null;
    justificacion.value = '';
    distanciaTxt.value = '';
    duracionTxt.value = '';
    lastComputedKey = null;
    if (cooldownTimer) clearTimeout(cooldownTimer), (cooldownTimer = null), (cooldownActive.value = false);

    if (dirRenderer) dirRenderer.set('directions', null);
    if (originMarker) originMarker.setMap(null);
    if (destMarker) destMarker.setMap(null);
    if (mapClickListener && maps?.event) {
        maps.event.removeListener(mapClickListener);
        mapClickListener = null;
    }
}

/* Carga del script de Maps (solo JS; sin Places) */
let gmapsLoadPromise = null;
function ensureMaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (gmapsLoadPromise) return gmapsLoadPromise;
    const KEY = window.GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GMAPS_KEY || '';
    gmapsLoadPromise = new Promise((resolve, reject) => {
        if (!KEY) return reject(new Error('Falta la API key de Google Maps (VITE_GMAPS_KEY).'));
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly`;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(window.google.maps);
        s.onerror = () => reject(new Error('No fue posible cargar Google Maps.'));
        document.head.appendChild(s);
    });
    return gmapsLoadPromise;
}

/* Abrir diálogo -> inicializar mapa y listener de clic */
watch(visibleLocal, async (open) => {
    if (!open) return;
    try {
        maps = await ensureMaps();
        await nextTick();
        initMap();
        onSedeChange(); // pinta origen
        if (mapClickListener) maps.event.removeListener(mapClickListener);
        mapClickListener = map.addListener('click', (e) => setDestinoFromClick(e.latLng));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Maps', detail: e.message, life: 4500 });
        visibleLocal.value = false;
    }
});

/* Mapa y routing */
function initMap() {
    map = new maps.Map(mapEl.value, {
        center: sedeSel.value ? { lat: sedeSel.value.lat, lng: sedeSel.value.lng } : { lat: 8.75, lng: -75.9 },
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false
    });
    dirSvc = new maps.DirectionsService();
    dirRenderer = new maps.DirectionsRenderer({ suppressMarkers: true });
    dirRenderer.setMap(map);
}

function onSedeChange() {
    if (!sedeSel.value || !map) return;
    if (originMarker) originMarker.setMap(null);
    originMarker = new maps.Marker({
        position: { lat: sedeSel.value.lat, lng: sedeSel.value.lng },
        map,
        title: sedeSel.value.label,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#2e7d32', fillOpacity: 1, strokeColor: '#2e7d32' }
    });
    map.panTo(originMarker.getPosition());
    if (destMarker) calcularRuta(); // recalcula si ya hay destino
}

function setDestinoFromClick(latLng) {
    destinoPlace.value = { lat: latLng.lat(), lng: latLng.lng() };
    if (destMarker) destMarker.setMap(null);
    destMarker = new maps.Marker({ position: latLng, map, title: 'Destino' });
    calcularRuta();
}

/* ---- Preflight backend ---- */
async function preflightReserve() {
    try {
        const { data } = await axios.post(`${API_BASE}/usage/routes/preflight`);
        // data: { allowed:boolean, stats:{count,limit,remaining,warn_ratio,warn_at,month} }
        return data;
    } catch (e) {
        // Si falla el backend, no calculamos (mejor prevenir gastos)
        return { allowed: false, stats: null, error: e?.message || 'usage preflight failed' };
    }
}

/* ---- Calcular ruta con control de costos ---- */
async function calcularRuta() {
    if (!sedeSel.value || !destinoPlace.value) return;

    // 0) Anti-spam: cooldown
    if (cooldownActive.value) {
        toast.add({ severity: 'info', summary: 'Espera un momento', detail: 'Por favor espera antes de recalcular.', life: 2500 });
        return;
    }

    // 1) Evitar preflight si origen/destino no cambiaron desde el último cálculo exitoso
    const key = `${sedeSel.value.lat.toFixed(6)},${sedeSel.value.lng.toFixed(6)}|${destinoPlace.value.lat.toFixed(6)},${destinoPlace.value.lng.toFixed(6)}`;
    if (lastComputedKey === key) {
        // Ya tenemos la misma ruta; no reservar de nuevo. Re-render por si acaso:
        const dir = dirRenderer.getDirections();
        if (dir?.routes?.length) return;
    }

    // 2) Preflight (reserva 1 si hay cupo)
    const res = await preflightReserve();
    if (!res?.allowed) {
        const s = res?.stats;
        const msg = s ? `Has alcanzado el límite mensual de cálculos de ruta (${s.limit}). No se pueden realizar más cálculos este mes.` : 'No se pueden realizar cálculos de ruta en este momento.';
        toast.add({ severity: 'error', summary: 'Límite mensual alcanzado', detail: msg, life: 7000 });
        return;
    }

    // 3) Warning por umbral
    const { stats } = res;
    if (stats && stats.count >= stats.warn_at) {
        toast.add({
            severity: 'warn',
            summary: 'Uso elevado',
            detail: `Has usado ${stats.count}/${stats.limit} cálculos este mes.`,
            life: 5000
        });
    }

    // 4) Cooldown (para no reservar en ráfaga)
    cooldownActive.value = true;
    cooldownTimer = setTimeout(() => {
        cooldownActive.value = false;
    }, COOLDOWN_MS);

    // 5) Llamada a Google
    dirSvc.route(
        {
            origin: { location: { lat: sedeSel.value.lat, lng: sedeSel.value.lng } },
            destination: { location: { lat: destinoPlace.value.lat, lng: destinoPlace.value.lng } },
            travelMode: google.maps.TravelMode.DRIVING
        },
        (res, status) => {
            if (status !== 'OK' || !res?.routes?.length) {
                distanciaTxt.value = '';
                duracionTxt.value = '';
                dirRenderer.set('directions', null);
                return;
            }
            dirRenderer.setDirections(res);
            const leg = res.routes[0].legs?.[0];
            distanciaTxt.value = leg?.distance?.text || '';
            duracionTxt.value = leg?.duration?.text || '';
            lastComputedKey = key; // éxito → recordamos firma
        }
    );
}

/* Guardar */
function emitir() {
    if (!sedeSel.value || !destinoPlace.value) return;
    const dir = dirRenderer.getDirections();
    const route = dir?.routes?.[0];
    const leg = route?.legs?.[0];

    emit('picked', {
        // Origen (sede)
        origen_place_id: null,
        origen_desc: `${sedeSel.value.label} · ${sedeSel.value.desc || ''}`.trim(),
        origen_lat: sedeSel.value.lat,
        origen_lng: sedeSel.value.lng,

        // Destino (lat/lng por clic)
        destino_place_id: null,
        destino_desc: fmtLatLng(destinoPlace.value),
        destino_lat: destinoPlace.value.lat,
        destino_lng: destinoPlace.value.lng,

        distancia_m: leg?.distance?.value ?? null,
        duracion_s: leg?.duration?.value ?? null,
        polyline: route?.overview_polyline?.encodedPath || route?.overview_polyline?.points || null,

        justificacion: justificacion.value || ''
    });

    visibleLocal.value = false;
    reset();
}
</script>

<template>
    <Dialog v-model:visible="visibleLocal" modal header="Definir recorrido" :style="{ width: '68rem' }" @hide="reset">
        <div class="grid grid-nogutter">
            <!-- Panel izquierdo -->
            <div class="col-12 md:col-4 p-3">
                <!-- Origen (Sede fija) -->
                <div class="mb-3">
                    <label class="block mb-1 text-sm font-medium">Origen (Sede de la Universidad)</label>
                    <Dropdown v-model="sedeId" :options="sedes" optionLabel="label" optionValue="id" class="w-full" placeholder="Selecciona una sede" @change="onSedeChange" />
                    <small class="text-color-secondary block mt-1"> El origen queda bloqueado a la sede seleccionada. </small>
                </div>

                <!-- Destino por clic -->
                <div class="mb-3">
                    <label class="block mb-1 text-sm font-medium">Destino</label>
                    <div class="p-inputtext w-full">
                        {{ destinoPlace ? fmtLatLng(destinoPlace) : 'Haz clic en el mapa para elegir destino' }}
                    </div>
                    <small class="text-color-secondary block mt-1"> Clic en el mapa para fijar el destino. </small>
                </div>

                <!-- Resumen -->
                <div class="grid text-sm mt-3">
                    <div class="col-6">
                        <div class="text-600">Origen</div>
                        <div class="text-800">{{ sedeSel?.label || '—' }}</div>
                    </div>
                    <div class="col-6">
                        <div class="text-600">Destino</div>
                        <div class="text-800">{{ destinoPlace ? fmtLatLng(destinoPlace) : '—' }}</div>
                    </div>
                    <div class="col-6 mt-3">
                        <div class="text-600">Distancia</div>
                        <div class="text-800">{{ distanciaTxt || '—' }}</div>
                    </div>
                    <div class="col-6 mt-3">
                        <div class="text-600">Duración</div>
                        <div class="text-800">{{ duracionTxt || '—' }}</div>
                    </div>
                </div>

                <!-- Justificación -->
                <div class="mt-4">
                    <label class="block mb-1 text-sm font-medium">Justificación del recorrido</label>
                    <Textarea v-model="justificacion" rows="3" autoResize class="w-full" placeholder="¿Por qué se requiere este recorrido?" />
                </div>

                <div class="flex justify-content-end gap-2 mt-4">
                    <Button label="Cancelar" text @click="visibleLocal = false" />
                    <Button label="Guardar recorrido" icon="pi pi-check" :disabled="!readyToSave" @click="emitir" />
                </div>
            </div>

            <!-- Mapa -->
            <div class="col-12 md:col-8 p-3">
                <div ref="mapEl" class="w-full" style="height: 520px; border: 1px solid var(--surface-border); border-radius: 10px"></div>
            </div>
        </div>
    </Dialog>
</template>
