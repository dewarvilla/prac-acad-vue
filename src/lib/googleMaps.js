import { Loader } from '@googlemaps/js-api-loader';

let loaderInstance = null;
let loadPromise = null;

export function getGoogleMaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);

    if (!loaderInstance) {
        const key = import.meta.env.VITE_GMAPS_KEY;
        loaderInstance = new Loader({
            apiKey: key,
            version: 'weekly',
            libraries: ['geometry', 'marker']
        });
    }

    if (!loadPromise) loadPromise = loaderInstance.load();
    return loadPromise.then(() => window.google.maps);
}
