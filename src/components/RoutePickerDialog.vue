<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const props = defineProps({
    visible: { type: Boolean, default: false },
    programacionId: { type: Number, default: null }, // opcional si deferred=true
    apiBase: { type: String, default: 'http://127.0.0.1:8000/api/v1' },
    deferred: { type: Boolean, default: false }
});
const emit = defineEmits(['update:visible', 'saved', 'picked']);

const toast = useToast();

const mapEl = ref(null);
let map,
    directionsService,
    directionsRenderer,
    acOrigen,
    acDestino,
    clickListener = null;

const origenInput = ref(null); // PrimeVue component
const destinoInput = ref(null); // PrimeVue component

const origen = ref({ placeId: null, desc: '', lat: null, lng: null });
const destino = ref({ placeId: null, desc: '', lat: null, lng: null });
const justificacion = ref('');
const calculo = ref({ distanciaM: null, duracionS: null, polyline: null });

const loading = ref(false);
const selecting = ref('origen'); // 'origen' | 'destino'

function isMapsReady() {
    return typeof window !== 'undefined' && window.google && google.maps && google.maps.places;
}
async function ensureMapsReady() {
    let tries = 0;
    while (!isMapsReady() && tries < 50) {
        await new Promise((r) => setTimeout(r, 100));
        tries++;
    }
    return isMapsReady();
}

function getNativeInput(cmpRef) {
    // Para PrimeVue <InputText>, el input real está dentro del $el
    return cmpRef?.$el?.querySelector?.('input') || cmpRef || null;
}

async function initMap() {
    if (!mapEl.value) return;
    const ok = await ensureMapsReady();
    if (!ok) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: 'No fue posible cargar Google Maps. Inténtelo nuevamente.', life: 6000 });
        return;
    }

    map = new google.maps.Map(mapEl.value, {
        center: { lat: 8.75, lng: -75.88 }, // Montería aprox
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ suppressMarkers: false });
    directionsRenderer.setMap(map);

    const inOrigen = getNativeInput(origenInput.value);
    const inDestino = getNativeInput(destinoInput.value);

    acOrigen = new google.maps.places.Autocomplete(inOrigen, { fields: ['place_id', 'description', 'formatted_address', 'geometry'] });
    acDestino = new google.maps.places.Autocomplete(inDestino, { fields: ['place_id', 'description', 'formatted_address', 'geometry'] });

    acOrigen.addListener('place_changed', () => onPick('origen', acOrigen.getPlace?.()));
    acDestino.addListener('place_changed', () => onPick('destino', acDestino.getPlace?.()));

    clickListener = map.addListener('click', (e) => {
        const { latLng } = e;
        setPoint(selecting.value, { lat: latLng.lat(), lng: latLng.lng() }, `(${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)})`);
    });
}

function onPick(which, place) {
    if (!place) return;
    const loc = place.geometry?.location;
    if (!loc) return;
    setPoint(which, { lat: loc.lat(), lng: loc.lng() }, place.description || place.formatted_address || '');
    if (which === 'origen') origen.value.placeId = place.place_id || null;
    if (which === 'destino') destino.value.placeId = place.place_id || null;
}

function setPoint(which, { lat, lng }, desc = '') {
    const tgt = which === 'origen' ? origen.value : destino.value;
    tgt.lat = lat;
    tgt.lng = lng;
    if (desc) tgt.desc = desc;
    if (which === 'origen') selecting.value = 'destino';
    tryDraw();
}

function tryDraw() {
    calculo.value = { distanciaM: null, duracionS: null, polyline: null };
    if (!origen.value.lat || !destino.value.lat) return;

    const req = {
        origin: origen.value.placeId ? { placeId: origen.value.placeId } : { location: { lat: origen.value.lat, lng: origen.value.lng } },
        destination: destino.value.placeId ? { placeId: destino.value.placeId } : { location: { lat: destino.value.lat, lng: destino.value.lng } },
        travelMode: google.maps.TravelMode.DRIVING
    };

    directionsService.route(req, (res, status) => {
        if (status !== 'OK' || !res?.routes?.[0]) {
            // Escenario 7
            toast.add({ severity: 'error', summary: 'Rutas', detail: 'No fue posible calcular el recorrido. Inténtelo nuevamente. Si el error persiste, contacte al administrador.', life: 6000 });
            return;
        }
        directionsRenderer.setDirections(res);

        const leg = res.routes[0].legs[0];
        calculo.value.distanciaM = leg.distance?.value ?? null;
        calculo.value.duracionS = leg.duration?.value ?? null;
        calculo.value.polyline = res.routes[0].overview_polyline?.encodedPath || res.routes[0].overview_polyline?.points || res.routes[0].overview_polyline || null;

        if (!origen.value.desc) origen.value.desc = leg.start_address || '';
        if (!destino.value.desc) destino.value.desc = leg.end_address || '';
    });
}

async function guardar() {
    if (!origen.value.lat || !destino.value.lat) {
        toast.add({ severity: 'warn', summary: 'Rutas', detail: 'Selecciona origen y destino.', life: 3000 });
        return;
    }
    if (!justificacion.value || justificacion.value.trim().length < 10) {
        toast.add({ severity: 'warn', summary: 'Rutas', detail: 'La justificación debe tener al menos 10 caracteres.', life: 3500 });
        return;
    }

    const payload = {
        programacion_id: props.programacionId || undefined,
        origen_place_id: origen.value.placeId,
        origen_desc: origen.value.desc,
        origen_lat: origen.value.lat,
        origen_lng: origen.value.lng,
        destino_place_id: destino.value.placeId,
        destino_desc: destino.value.desc,
        destino_lat: destino.value.lat,
        destino_lng: destino.value.lng,
        distancia_m: calculo.value.distanciaM,
        duracion_s: calculo.value.duracionS,
        polyline: calculo.value.polyline,
        justificacion: justificacion.value
    };

    // Modo diferido: no persistimos, devolvemos al padre
    if (props.deferred) {
        emit('picked', payload);
        cerrar();
        return;
    }

    // Modo normal: persistimos en backend
    try {
        if (!props.programacionId) throw new Error('programacion_id requerido para guardar');
        loading.value = true;
        await axios.post(`${props.apiBase}/programaciones/${props.programacionId}/rutas`, payload);
        toast.add({ severity: 'success', summary: 'Rutas', detail: 'Recorrido guardado.', life: 2500 });
        emit('saved');
        cerrar();
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: e?.response?.data?.message || e.message, life: 6000 });
    } finally {
        loading.value = false;
    }
}

function cerrar() {
    emit('update:visible', false);
    reset();
}
function reset() {
    origen.value = { placeId: null, desc: '', lat: null, lng: null };
    destino.value = { placeId: null, desc: '', lat: null, lng: null };
    justificacion.value = '';
    calculo.value = { distanciaM: null, duracionS: null, polyline: null };
    selecting.value = 'origen';
    if (directionsRenderer) directionsRenderer.set('directions', null);
}

watch(
    () => props.visible,
    async (v) => {
        if (v) {
            await nextTick();
            setTimeout(() => initMap(), 50);
        } else {
            reset();
        }
    }
);

onBeforeUnmount(() => {
    if (clickListener && window.google?.maps?.event) {
        google.maps.event.removeListener(clickListener);
    }
});
</script>

<template>
    <Dialog :visible="visible" modal header="Definir recorrido" :style="{ width: '68rem', maxWidth: '92vw' }" @update:visible="$emit('update:visible', $event)">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="md:col-span-1 space-y-3">
                <div>
                    <label class="font-semibold">Origen</label>
                    <InputText ref="origenInput" placeholder="Buscar punto de origen…" />
                    <small class="block text-gray-500 mt-1"
                        >O haz clic en el mapa (modo actual: <b>{{ selecting }}</b
                        >)</small
                    >
                </div>

                <div>
                    <label class="font-semibold">Destino</label>
                    <InputText ref="destinoInput" placeholder="Buscar destino…" />
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="text-xs text-gray-600">Origen</label>
                        <div class="text-sm break-words">{{ origen.desc || (origen.lat ? `(${origen.lat.toFixed(5)}, ${origen.lng?.toFixed(5)})` : '—') }}</div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-600">Destino</label>
                        <div class="text-sm break-words">{{ destino.desc || (destino.lat ? `(${destino.lat.toFixed(5)}, ${destino.lng?.toFixed(5)})` : '—') }}</div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="text-xs text-gray-600">Distancia</label>
                        <div class="text-sm">{{ calculo.distanciaM ? (calculo.distanciaM / 1000).toFixed(2) + ' km' : '—' }}</div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-600">Duración</label>
                        <div class="text-sm">{{ calculo.duracionS ? Math.round(calculo.duracionS / 60) + ' min' : '—' }}</div>
                    </div>
                </div>

                <div>
                    <label class="font-semibold">Justificación del recorrido</label>
                    <Textarea v-model="justificacion" autoResize rows="4" placeholder="¿Por qué se requiere este recorrido?" />
                </div>
            </div>

            <div class="md:col-span-2">
                <div ref="mapEl" style="width: 100%; height: 520px; border-radius: 0.5rem; overflow: hidden; border: 1px solid #e5e7eb"></div>
            </div>
        </div>

        <template #footer>
            <Button label="Guardar recorrido" icon="pi pi-check" :loading="loading" @click="guardar" />
            <Button label="Cancelar" icon="pi pi-times" text @click="cerrar" />
        </template>
    </Dialog>
</template>
