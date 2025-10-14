<script setup>
import axios from 'axios';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

/* ================================
   Config / axios
================================ */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api/v1';
const API_PROG = `${API_BASE}/programaciones`;
const API_CRE = `${API_BASE}/creaciones`;
const GMAPS_KEY = window.GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GMAPS_KEY || '';

const api = axios.create({
    baseURL: API_BASE,
    timeout: 20000
});

// toast
const toast = useToast();

/* ================================
   Loader único de Google Maps JS
================================ */
let gmapsLoadPromise = null;
function loadGmaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (gmapsLoadPromise) return gmapsLoadPromise;
    if (!GMAPS_KEY) {
        return Promise.reject(new Error('Falta la API key de Google Maps (VITE_GMAPS_KEY o window.GOOGLE_MAPS_API_KEY).'));
    }
    gmapsLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places,geometry&v=weekly`;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(window.google.maps);
        s.onerror = () => reject(new Error('No fue posible cargar Google Maps. Revisa restricciones de la key (HTTP referrers) y que Maps JavaScript API esté habilitada.'));
        document.head.appendChild(s);
    });
    return gmapsLoadPromise;
}

/* Al abrir el picker, garantizamos que Maps esté listo */
const routeDlg = ref(false);
watch(routeDlg, async (open) => {
    if (!open) return;
    try {
        await loadGmaps();
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: e.message, life: 6000 });
        // si no carga, cerramos el diálogo para no dejarlo roto
        routeDlg.value = false;
    }
});

/* ===== Tabla (server-side) ===== */
const rows = ref(10);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const products = ref([]);
const selected = ref([]);

const sortField = ref('fechaInicio');
const sortOrder = ref(-1);

/* ===== Búsqueda ===== */
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

const sortParam = computed(() => (!sortField.value ? undefined : `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;
    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;
    return params;
}

async function getProducts(opts = {}) {
    const { signal, force = false } = opts;
    loading.value = true;
    try {
        const { data } = await api.get('/programaciones', { params: buildParams({ force }), signal });
        if (Array.isArray(data)) {
            products.value = data;
            total.value = data.length;
        } else {
            products.value = data.data ?? [];
            total.value = Number(data.meta?.total ?? products.value.length);
            if (data.meta?.current_page) page.value = Number(data.meta.current_page);
            if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
        }
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';
        if (!canceled) {
            const status = e?.response?.status;
            const msg = e?.response?.data?.message || e.message;
            toast.add({ severity: 'error', summary: 'Error al cargar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6000 });
            products.value = [];
            total.value = 0;
        }
    } finally {
        if (!opts.signal?.aborted) loading.value = false;
    }
}

function scheduleFetch() {
    const raw = String(search.value || '').trim();
    if (raw.length === 0 || raw.length < MIN_CHARS) return;
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    typingTimer = setTimeout(() => {
        activeCtrl = new AbortController();
        getProducts({ signal: activeCtrl.signal }).finally(() => (activeCtrl = null));
    }, DEBOUNCE_MS);
}

watch(search, () => {
    page.value = 1;
    const raw = String(search.value || '').trim();
    if (raw.length === 0) {
        if (activeCtrl) {
            activeCtrl.abort();
            activeCtrl = null;
        }
        if (typingTimer) clearTimeout(typingTimer);
        getProducts();
    } else if (raw.length >= MIN_CHARS) {
        scheduleFetch();
    }
});

/* ===== DataTable events ===== */
function onPage(e) {
    page.value = Number(e.page) + 1;
    rows.value = Number(e.rows);
    getProducts();
}
function onSort(e) {
    sortField.value = e.sortField;
    sortOrder.value = e.sortOrder;
    page.value = 1;
    getProducts();
}
function forceFetch() {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    page.value = 1;
    getProducts({ force: true });
}
function clearSearch() {
    search.value = '';
    page.value = 1;
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    getProducts();
}

/* ===== Detalles ===== */
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;
    detailsLoading.value = true;
    details.value = [];
    const reqs = selected.value.map((r) => api.get(`/programaciones/${r.id}`));
    const results = await Promise.allSettled(reqs);
    details.value = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.data?.data ?? r.value.data);
    const fails = results.length - details.value.length;
    if (fails) toast.add({ severity: 'warn', summary: 'Algunos detalles fallaron', detail: `Fallaron ${fails} de ${results.length}`, life: 4000 });
    detailsDialog.value = true;
    detailsLoading.value = false;
}

/* =========================
   CRUD crear/editar
========================= */
const productDialog = ref(false);
const saving = ref(false);
const product = ref({
    id: null,
    creacion: null, // { id, label, programa, facultad, nivel }
    nombrePractica: '',
    descripcion: '',
    requiereTransporte: false,
    lugarDeRealizacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: ''
});

/* ==== Recorridos dentro del modal ==== */
const routesDraft = ref([]); // {id?, ...payload, _state?: 'new'|'keep'|'delete'}

function fmtKm(m) {
    if (m == null) return '—';
    const km = Number(m) / 1000;
    return isFinite(km) ? `${km.toFixed(2)} km` : '—';
}
function fmtMin(s) {
    if (s == null) return '—';
    const min = Math.round(Number(s) / 60);
    return isFinite(min) ? `${min} min` : '—';
}
function addDraftRoute(payload) {
    routesDraft.value.push({ ...payload, _state: 'new' });
}
function removeDraftRoute(idx) {
    const r = routesDraft.value[idx];
    if (r?.id) routesDraft.value[idx] = { ...r, _state: 'delete' };
    else routesDraft.value.splice(idx, 1);
}
function visibleRoutes() {
    return routesDraft.value.filter((r) => r._state !== 'delete');
}

const errors = reactive({
    creacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: ''
});
const touched = reactive({
    creacion: false,
    justificacion: false,
    recursosNecesarios: false,
    fechaInicio: false,
    fechaFinalizacion: false
});
const rules = {
    creacion: [(v) => !!v || 'Selecciona una práctica (Creación).'],
    justificacion: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    fechaInicio: [(v) => !!v || 'Requerido.'],
    fechaFinalizacion: [(v) => !!v || 'Requerido.']
};
function validateField(f) {
    errors[f] = '';
    for (const test of rules[f] || []) {
        const ok = test(product.value[f]);
        if (ok !== true) {
            errors[f] = ok;
            break;
        }
    }
    return !errors[f];
}
function onBlur(f) {
    touched[f] = true;
    validateField(f);
}
function showError(f) {
    return touched[f] && !!errors[f];
}
function validateAll() {
    let ok = true;
    Object.keys(rules).forEach((f) => {
        touched[f] = true;
        if (!validateField(f)) ok = false;
    });
    return ok;
}
function resetValidation() {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));
}

function openNew() {
    product.value = { id: null, creacion: null, nombrePractica: '', descripcion: '', requiereTransporte: false, lugarDeRealizacion: '', justificacion: '', recursosNecesarios: '', fechaInicio: '', fechaFinalizacion: '' };
    routesDraft.value = [];
    progSugs.value = [];
    resetValidation();
    productDialog.value = true;
}

async function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        creacion: row.creacionId ? { id: row.creacionId, label: row.nombrePractica, programa: row.programaAcademico, facultad: row.facultad, nivel: row.nivelAcademico } : null,
        nombrePractica: row.nombrePractica ?? '',
        descripcion: row.descripcion ?? '',
        requiereTransporte: !!row.requiereTransporte,
        lugarDeRealizacion: row.lugarDeRealizacion ?? '',
        justificacion: row.justificacion ?? '',
        recursosNecesarios: row.recursosNecesarios ?? '',
        fechaInicio: row.fechaInicio ?? '',
        fechaFinalizacion: row.fechaFinalizacion ?? ''
    };
    resetValidation();
    routesDraft.value = [];

    // Cargar recorridos existentes (se marcan 'keep')
    try {
        const { data } = await api.get(`/programaciones/${row.id}/rutas`);
        const items = data?.data ?? data ?? [];
        routesDraft.value = items.map((it) => ({
            id: it.id,
            programacion_id: row.id,
            origen_place_id: it.origen?.placeId ?? null,
            origen_desc: it.origen?.desc ?? '',
            origen_lat: it.origen?.lat ?? null,
            origen_lng: it.origen?.lng ?? null,
            destino_place_id: it.destino?.placeId ?? null,
            destino_desc: it.destino?.desc ?? '',
            destino_lat: it.destino?.lat ?? null,
            destino_lng: it.destino?.lng ?? null,
            distancia_m: it.distanciaM ?? null,
            duracion_s: it.duracionS ?? null,
            polyline: it.polyline ?? null,
            justificacion: it.justificacion ?? '',
            _state: 'keep'
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: e?.response?.data?.message || e.message, life: 5000 });
    }

    productDialog.value = true;
}

/* ===== AutoComplete de Creaciones ===== */
const progSugs = ref([]);
const loadingProgs = ref(false);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function norm(v) {
    try {
        return (v ?? '') + '';
    } catch {
        return '';
    }
}
async function fetchCreaciones(q = '') {
    loadingProgs.value = true;
    try {
        const params = { per_page: 20, page: 1 };
        if (q.trim() !== '') params.q = q.trim();
        const { data } = await api.get('/creaciones', { params });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        progSugs.value = items.map((c) => ({
            id: c.id,
            label: c.nombrePractica ?? c.nombre_practica,
            programa: c.programaAcademico ?? c.programa_academico,
            facultad: c.facultad,
            nivel: c.nivelAcademico ?? c.nivel_academico
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Creaciones', detail: e?.response?.data?.message || e.message, life: 5000 });
        progSugs.value = [];
    } finally {
        loadingProgs.value = false;
    }
}
function onCompleteCreaciones(e) {
    const q = norm(e?.query);
    clearTimeout(progTimer);
    progTimer = setTimeout(() => fetchCreaciones(q), PROG_DEBOUNCE);
}
function onSelectCreacion(e) {
    const it = e.value || null;
    product.value.creacion = it;
    product.value.nombrePractica = it?.label ?? '';
}

/* =========================
   Post-acciones ruta (BE)
========================= */
async function calcularYPeajes(rutaId, categoria /* 'I'..'VII' o null */) {
    try {
        await api.post(`/rutas/${rutaId}/calcular`);
    } catch (e) {
        toast.add({ severity: 'warn', summary: 'Cálculo de ruta', detail: e?.response?.data?.message || e.message, life: 5000 });
    }
    try {
        await api.post(`/rutas/${rutaId}/peajes/recalcular`);
    } catch (e) {
        toast.add({ severity: 'warn', summary: 'Peajes', detail: e?.response?.data?.message || e.message, life: 5000 });
    }
    try {
        if (categoria) await api.post(`/rutas/${rutaId}/peajes/total`, { cat: categoria });
        else await api.post(`/rutas/${rutaId}/peajes/total`);
    } catch {
        /* opcional; no bloquea UX */
    }
}

/* ===== Guardar ===== */
async function saveProduct() {
    if (saving.value) return;
    if (!validateAll()) {
        toast.add({ severity: 'warn', summary: 'Valida el formulario', detail: 'Corrige los campos marcados.', life: 3000 });
        return;
    }

    const payload = {
        creacion_id: product.value.creacion?.id,
        descripcion: product.value.descripcion || null,
        requiere_transporte: !!product.value.requiereTransporte,
        lugar_de_realizacion: product.value.lugarDeRealizacion || null,
        justificacion: product.value.justificacion,
        recursos_necesarios: product.value.recursosNecesarios,
        fecha_inicio: product.value.fechaInicio,
        fecha_finalizacion: product.value.fechaFinalizacion
    };

    try {
        saving.value = true;

        if (product.value.id) {
            // EDITAR
            await api.patch(`/programaciones/${product.value.id}`, payload);

            const progId = product.value.id;
            const toCreate = routesDraft.value.filter((r) => r._state === 'new');
            const toDelete = routesDraft.value.filter((r) => r._state === 'delete' && r.id);

            const createdIds = [];
            const reqs = [];

            toCreate.forEach((r) => {
                const p = { ...r, programacion_id: progId };
                delete p._state;
                delete p.id;
                reqs.push(
                    api.post(`/programaciones/${progId}/rutas`, p).then((res) => {
                        const ruta = res?.data?.data ?? res?.data;
                        if (ruta?.id) createdIds.push(ruta.id);
                    })
                );
            });
            toDelete.forEach((r) => reqs.push(api.delete(`/programaciones/${progId}/rutas/${r.id}`)));

            if (reqs.length) await Promise.allSettled(reqs);

            // cálculo + peajes en segundo plano
            createdIds.forEach((rid) => calcularYPeajes(rid, null));

            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            // CREAR
            const { data } = await api.post('/programaciones', payload);
            const created = data?.data ?? data ?? {};
            const progId = created.id;

            if (progId && routesDraft.value.length) {
                const createdIds = [];
                const reqs = routesDraft.value.map(async (r) => {
                    const p = { ...r, programacion_id: progId };
                    delete p._state;
                    delete p.id;
                    const res = await api.post(`/programaciones/${progId}/rutas`, p);
                    const ruta = res?.data?.data ?? res?.data;
                    if (ruta?.id) createdIds.push(ruta.id);
                });
                await Promise.allSettled(reqs);
                createdIds.forEach((rid) => calcularYPeajes(rid, null));
            }

            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        if (status === 422 && data?.errors) {
            errors.creacion = data.errors.creacion_id?.[0] ?? errors.creacion;
            errors.justificacion = data.errors.justificacion?.[0] ?? errors.justificacion;
            errors.recursosNecesarios = data.errors.recursos_necesarios?.[0] ?? errors.recursosNecesarios;
            errors.fechaInicio = data.errors.fecha_inicio?.[0] ?? errors.fechaInicio;
            errors.fechaFinalizacion = data.errors.fecha_finalizacion?.[0] ?? errors.fechaFinalizacion;
        }
        toast.add({ severity: 'error', summary: 'No se pudo guardar', detail: data?.message || e.message, life: 5000 });
    } finally {
        saving.value = false;
    }
}

/* ===== Delete / Bulk ===== */
const deleteProductDialog = ref(false);
const current = ref(null);
function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}
async function deleteProduct() {
    try {
        await api.delete(`/programaciones/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await refreshAfterDelete(1);
    } catch (e) {
        toast.add({ severity: 'error', summary: 'No se pudo eliminar', detail: e?.response?.data?.message || e.message, life: 5000 });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);
function confirmBulkDelete() {
    if (!selected.value.length) return;
    bulkDeleteDialog.value = true;
}
async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);
    try {
        await api.post('/programaciones/bulk-delete', { ids });
        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];
        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });
        await refreshAfterDelete(ids.length);
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({ severity: status === 409 ? 'warn' : 'error', summary: status === 409 ? 'No se puede eliminar' : 'Error al eliminar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6000 });
    } finally {
        bulkDeleteDialog.value = false;
    }
}

function refreshAfterDelete(deletedCount = 1) {
    total.value = Math.max(0, Number(total.value) - Number(deletedCount));
    const r = Number(rows.value) || 10;
    const totalPages = Math.max(1, Math.ceil(total.value / r));
    if (Number(page.value) > totalPages) page.value = totalPages;
    return getProducts({ force: true });
}

/* ===== Util ===== */
onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (progTimer) clearTimeout(progTimer);
});
function fmtDDMMYYYY(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    const useUTC = typeof v === 'string' && /Z$/i.test(v);
    const day = useUTC ? d.getUTCDate() : d.getDate();
    const month = useUTC ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const year = useUTC ? d.getUTCFullYear() : d.getFullYear();
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return `${dd}/${mm}/${year}`;
}

onMounted(() => getProducts());
</script>
