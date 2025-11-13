<script setup>
import { ref, watch, onMounted } from 'vue';
import { getGoogleMaps } from '@/lib/googleMaps';

const props = defineProps({
    ruta: { type: Object, required: true }
});

const mapEl = ref(null);
let map = null;
let polyline = null;

async function ensureGoogle() {
    await getGoogleMaps();
}

async function initMap() {
    await ensureGoogle();

    if (!window.google?.maps || !props.ruta) return;

    if (map) {
        map = null;
        mapEl.value.innerHTML = '';
    }

    const o = props.ruta.origen_lat && props.ruta.origen_lng ? { lat: props.ruta.origen_lat, lng: props.ruta.origen_lng } : { lat: 8.75, lng: -75.88 };
    const d = props.ruta.destino_lat && props.ruta.destino_lng ? { lat: props.ruta.destino_lat, lng: props.ruta.destino_lng } : null;

    map = new google.maps.Map(mapEl.value, {
        center: o,
        zoom: 10,
        disableDefaultUI: true,
        mapTypeControl: false,
        streetViewControl: false,
        ...(import.meta.env.VITE_GMAPS_MAP_ID ? { mapId: import.meta.env.VITE_GMAPS_MAP_ID } : {})
    });

    const { AdvancedMarkerElement } = google.maps.marker;
    if (o) {
        new AdvancedMarkerElement({
            map,
            position: o,
            title: 'Origen',
            content: createMarkerLabel('O', '#1A73E8')
        });
    }
    if (d) {
        new AdvancedMarkerElement({
            map,
            position: d,
            title: 'Destino',
            content: createMarkerLabel('D', '#D93025')
        });
    }

    if (props.ruta.polyline) {
        const decoded = google.maps.geometry.encoding.decodePath(props.ruta.polyline);
        polyline = new google.maps.Polyline({
            path: decoded,
            strokeColor: '#4285F4',
            strokeOpacity: 1.0,
            strokeWeight: 4,
            map
        });

        const bounds = new google.maps.LatLngBounds();
        decoded.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds);
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

onMounted(initMap);
watch(() => props.ruta, initMap, { deep: true });
</script>

<template>
    <div class="flex flex-col gap-1">
        <div ref="mapEl" class="h-48 rounded-md border border-surface-300 overflow-hidden"></div>
    </div>
</template>

<style scoped>
.h-48 {
    height: 12rem;
}
</style>
