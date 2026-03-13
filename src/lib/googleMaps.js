import { Loader } from '@googlemaps/js-api-loader';

let loaderInstance = null;
let loadPromise = null;

export function getGoogleMaps() {
    if (window.google?.maps) {
        return Promise.resolve(window.google.maps);
    }

    if (!loaderInstance) {
        const apiKey = import.meta.env.VITE_GMAPS_KEY;

        if (!apiKey) {
            return Promise.reject(new Error('Falta VITE_GMAPS_KEY en las variables de entorno.'));
        }

        loaderInstance = new Loader({
            apiKey,
            version: 'weekly',
            libraries: ['geometry', 'marker']
        });
    }

    if (!loadPromise) {
        loadPromise = loaderInstance.load().then(() => window.google.maps);
    }

    return loadPromise;
}
