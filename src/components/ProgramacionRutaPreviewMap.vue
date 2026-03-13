<script setup>
import { getGoogleMaps } from '@/lib/googleMaps';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    ruta: {
        type: Object,
        required: true
    }
});

const mapEl = ref(null);

let map = null;
let originMarker = null;
let destMarker = null;
let routePolyline = null;

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

function clearMapArtifacts() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }

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
    clearMapArtifacts();
    map = null;

    if (mapEl.value) {
        mapEl.value.innerHTML = '';
    }
}

async function initMap() {
    await getGoogleMaps();
    await nextTick();

    if (!window.google?.maps || !mapEl.value || !props.ruta) return;

    destroyMap();

    const hasOrigin = props.ruta.origen_lat != null && props.ruta.origen_lng != null;
    const hasDest = props.ruta.destino_lat != null && props.ruta.destino_lng != null;

    const origin = hasOrigin ? { lat: Number(props.ruta.origen_lat), lng: Number(props.ruta.origen_lng) } : { lat: 8.75, lng: -75.88 };

    const dest = hasDest ? { lat: Number(props.ruta.destino_lat), lng: Number(props.ruta.destino_lng) } : null;

    map = new google.maps.Map(mapEl.value, {
        center: origin,
        zoom: 11,
        disableDefaultUI: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        ...(import.meta.env.VITE_GMAPS_MAP_ID ? { mapId: import.meta.env.VITE_GMAPS_MAP_ID } : {})
    });

    const AdvMarker = google.maps.marker?.AdvancedMarkerElement;

    if (origin) {
        if (AdvMarker) {
            originMarker = new AdvMarker({
                map,
                position: origin,
                title: 'Origen',
                content: createMarkerLabel('O', '#1A73E8')
            });
        } else {
            originMarker = new google.maps.Marker({
                map,
                position: origin,
                label: 'O',
                title: 'Origen'
            });
        }
    }

    if (dest) {
        if (AdvMarker) {
            destMarker = new AdvMarker({
                map,
                position: dest,
                title: 'Destino',
                content: createMarkerLabel('D', '#D93025')
            });
        } else {
            destMarker = new google.maps.Marker({
                map,
                position: dest,
                label: 'D',
                title: 'Destino'
            });
        }
    }

    if (props.ruta.polyline && google.maps.geometry?.encoding) {
        const decoded = google.maps.geometry.encoding.decodePath(props.ruta.polyline);

        if (decoded?.length) {
            routePolyline = new google.maps.Polyline({
                path: decoded,
                strokeColor: '#4285F4',
                strokeOpacity: 1,
                strokeWeight: 4,
                map
            });

            const bounds = new google.maps.LatLngBounds();
            decoded.forEach((p) => bounds.extend(p));
            map.fitBounds(bounds);
        }
    }
}

onMounted(initMap);

watch(
    () => props.ruta,
    async () => {
        await initMap();
    },
    { deep: true }
);

onBeforeUnmount(() => {
    destroyMap();
});
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
