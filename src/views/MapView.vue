<template>
    <div id="map" style="height: 80vh"></div>
</template>

<script setup>
import { onMounted } from 'vue';
import L from 'leaflet';
import polyline from '@mapbox/polyline';
import axios from 'axios';

onMounted(async () => {
    const map = L.map('map').setView([8.79, -75.85], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Llama a tu API de Laravel
    const { data } = await axios.post('http://127.0.0.1:8000/api/v1/compute-route', {
        origin: { lat: 8.789478076658922, lng: -75.85682013938368 },
        dest: { lat: 8.882344202163397, lng: -75.7018615673633 },
        mode: 'DRIVE'
    });

    // Decodifica y dibuja la ruta
    const coords = polyline.decode(data.polyline); // => [[lat, lng], ...]
    const latlngs = coords.map(([lat, lng]) => [lat, lng]);

    L.polyline(latlngs, { weight: 5 }).addTo(map);
    map.fitBounds(L.polyline(latlngs).getBounds());

    // Marcadores opcionales
    L.marker(latlngs[0]).addTo(map).bindPopup('Origen');
    L.marker(latlngs[latlngs.length - 1])
        .addTo(map)
        .bindPopup('Destino');
});
</script>
