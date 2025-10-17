import { Loader } from '@googlemaps/js-api-loader';

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
        libraries: ['places']
    });

    gmapsPromise = loader.load();
    return gmapsPromise;
}
