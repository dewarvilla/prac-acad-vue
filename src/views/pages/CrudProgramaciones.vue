<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';
import RoutePickerDialog from '@/components/RoutePickerDialog.vue';

/* ========= Cache/ayudas para métricas de rutas en Detalles ========= */
const routeEstimates = reactive({}); // { [key]: { loading?, error?, distance_m?, duration_s? } }

/** Clave estable por ruta (incluye coords para evitar colisiones si no hay id) */
function kRoute(prog, r, i) {
    const oLat = Number(r?.origen_lat),
        oLng = Number(r?.origen_lng);
    const dLat = Number(r?.destino_lat),
        dLng = Number(r?.destino_lng);
    const idPart = r?.id ?? i;
    return `${prog?.id ?? 'p'}:${idPart}:${isFinite(oLat) ? oLat.toFixed(5) : 'x'},${isFinite(oLng) ? oLng.toFixed(5) : 'x'}>${isFinite(dLat) ? dLat.toFixed(5) : 'x'},${isFinite(dLng) ? dLng.toFixed(5) : 'x'}`;
}

/* Helpers de formato */
function fmtKm(m) {
    const v = Number(m);
    if (!isFinite(v) || v <= 0) return '0.00 km';
    return `${(v / 1000).toFixed(2)} km`;
}
function fmtMin(s) {
    const v = Number(s);
    if (!isFinite(v) || v <= 0) return '0 min';
    return `${Math.round(v / 60)} min`;
}

/** Calcula distancia/duración en backend para una ruta sin métricas */
async function fetchEstimateForRoute(r, key) {
    const oLat = Number(r?.origen_lat),
        oLng = Number(r?.origen_lng);
    const dLat = Number(r?.destino_lat),
        dLng = Number(r?.destino_lng);
    if (!isFinite(oLat) || !isFinite(oLng) || !isFinite(dLat) || !isFinite(dLng)) {
        routeEstimates[key] = { error: true };
        return;
    }
    if (!routeEstimates[key]) routeEstimates[key] = { loading: false, distance_m: null, duration_s: null, error: null };
    if (routeEstimates[key].loading || routeEstimates[key].distance_m || routeEstimates[key].error) return;

    routeEstimates[key].loading = true;
    routeEstimates[key].error = null;
    try {
        const { data } = await axios.post(`${API_BASE}/compute-route`, { origin: { lat: oLat, lng: oLng }, dest: { lat: dLat, lng: dLng }, mode: 'DRIVE' }, { timeout: 15000 });
        routeEstimates[key].distance_m = Number(data?.distance_m ?? data?.distance ?? 0) || null;
        routeEstimates[key].duration_s = Number(data?.duration_s ?? data?.duration ?? 0) || null;
    } catch (e) {
        routeEstimates[key].error = true;
    } finally {
        routeEstimates[key].loading = false;
    }
}

/* ========= API ========= */
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const API_PROG = `${API_BASE}/programaciones`;
const API_CRE = `${API_BASE}/creaciones`;

const toast = useToast();

/* ===== SEDES (origen fijo) ===== */
const SEDES = [
    { id: 'monteria', label: 'Montería (Sede principal)', lat: 8.789478076658922, lng: -75.85682013983686, desc: 'Campus Montería' },
    { id: 'berastegui', label: 'Berástegui', lat: 8.882344202163397, lng: -75.7018615673633, desc: 'Sede Berástegüí' },
    { id: 'lorica', label: 'Lorica', lat: 9.243969741154956, lng: -75.80946284785088, desc: 'Sede Lorica' },
    { id: 'sahagun', label: 'Sahagún', lat: 8.944731570525947, lng: -75.43399000105987, desc: 'Sede Sahagún' },
    { id: 'montelibano', label: 'Montelíbano', lat: 7.985484181256228, lng: -75.42109965748082, desc: 'Sede Montelíbano' }
];

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
        const { data } = await axios.get(API_PROG, { params: buildParams({ force }), signal });

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
            toast.add({
                severity: 'error',
                summary: 'Error al cargar',
                detail: `[${status ?? 'ERR'}] ${msg}`,
                life: 6000
            });
            products.value = [];
            total.value = 0;
        }
    } finally {
        // Limpia selección con ids que ya no existen en la tabla
        const idsSet = new Set((products.value ?? []).map((p) => p.id));
        if (Array.isArray(selected.value)) {
            selected.value = selected.value.filter((s) => idsSet.has(s.id));
        }
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

    // ids aún visibles + sin duplicados
    const currentIds = new Set((products.value || []).map((p) => p.id));
    const ids = [...new Set(selected.value.filter((r) => currentIds.has(r.id)).map((r) => r.id))];
    if (!ids.length) return;

    detailsLoading.value = true;
    details.value = [];

    // reset cache de estimaciones
    Object.keys(routeEstimates).forEach((k) => delete routeEstimates[k]);

    // 1) Programaciones
    const progReqs = ids.map((id) => axios.get(`${API_PROG}/${id}`));
    const progResults = await Promise.allSettled(progReqs);
    const progs = progResults
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value.data?.data ?? r.value.data)
        .filter(Boolean);

    // 2) Rutas por programación
    const routeReqs = progs.map((p) => axios.get(`${API_BASE}/rutas`, { params: { programacion_id: p.id, page: 1, per_page: 200 } }));
    const routeResults = await Promise.allSettled(routeReqs);

    // 3) Unir y lanzar cálculos cuando falten métricas
    progs.forEach((p, i) => {
        p.routes = routeResults[i].status === 'fulfilled' ? ((Array.isArray(routeResults[i].value.data) ? routeResults[i].value.data : routeResults[i].value.data?.data) ?? []) : [];

        p.routes.forEach((r, idx) => {
            if (r?.distancia_m == null || r?.duracion_s == null) {
                const key = kRoute(p, r, idx);
                fetchEstimateForRoute(r, key);
            }
        });
    });

    details.value = progs;

    const fails = progResults.length - progs.length;
    if (fails) {
        toast.add({
            severity: 'warn',
            summary: 'Algunos detalles fallaron',
            detail: `No se encontraron ${fails} programación(es).`,
            life: 4000
        });
    }

    detailsDialog.value = true;
    detailsLoading.value = false;
}

/* ========================= CRUD crear/editar ========================= */
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
const routeDlg = ref(false);

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

const nextRouteOrigin = computed(() => {
    const list = visibleRoutes();
    if (!product.value.requiereTransporte || !list.length) return null;
    const last = list[list.length - 1];
    const lat = last?.destino_lat,
        lng = last?.destino_lng;
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng), desc: last?.destino_desc || 'Último destino', placeId: last?.destino_place_id || null };
});

/* === Helpers para regreso automático (solo al guardar) === */
function coordsEqual(a, b, tol = 1e-6) {
    if (!a || !b) return false;
    const dLat = Math.abs(Number(a.lat) - Number(b.lat));
    const dLng = Math.abs(Number(a.lng) - Number(b.lng));
    return dLat <= tol && dLng <= tol;
}
function firstOriginFromList(list) {
    if (!list.length) return null;
    const r0 = list[0];
    return { lat: r0.origen_lat, lng: r0.origen_lng, desc: r0.origen_desc || '', placeId: r0.origen_place_id || null };
}
function lastDestFromList(list) {
    if (!list.length) return null;
    const r = list[list.length - 1];
    return { lat: r.destino_lat, lng: r.destino_lng, desc: r.destino_desc || '', placeId: r.destino_place_id || null };
}
/** Extiende batch de creación con regreso al origen si hace falta */
function finalizeRoutesForCreate(progId, currentToCreate) {
    const list = visibleRoutes(); // keep + new (sin delete)
    if (!list.length) return currentToCreate;

    const firstO = firstOriginFromList(list);
    const lastD = lastDestFromList(list);
    if (!firstO || !lastD) return currentToCreate;

    const yaVuelve = coordsEqual({ lat: lastD.lat, lng: lastD.lng }, { lat: firstO.lat, lng: firstO.lng });
    if (yaVuelve) return currentToCreate;

    const extended = currentToCreate ? [...currentToCreate] : [];
    extended.push({
        programacion_id: progId,
        // origen = último destino
        origen_place_id: lastD.placeId || null,
        origen_desc: lastD.desc || '',
        origen_lat: Number(lastD.lat),
        origen_lng: Number(lastD.lng),
        // destino = primer origen
        destino_place_id: firstO.placeId || null,
        destino_desc: firstO.desc || '',
        destino_lat: Number(firstO.lat),
        destino_lng: Number(firstO.lng),
        distancia_m: null,
        duracion_s: null,
        polyline: null,
        justificacion: 'Regreso al origen de la práctica',
        _state: 'new'
    });

    return extended;
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
    product.value = {
        id: null,
        creacion: null,
        nombrePractica: '',
        descripcion: '',
        requiereTransporte: false,
        lugarDeRealizacion: '',
        justificacion: '',
        recursosNecesarios: '',
        fechaInicio: '',
        fechaFinalizacion: ''
    };
    routesDraft.value = [];
    progSugs.value = [];
    resetValidation();
    productDialog.value = true;
}
function toDateInput(v) {
    if (!v) return '';
    if (typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        const [dd, mm, yyyy] = v.split('/');
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
        fechaInicio: toDateInput(row.fechaInicio),
        fechaFinalizacion: toDateInput(row.fechaFinalizacion)
    };
    resetValidation();
    routesDraft.value = [];

    // Rutas existentes (keep)
    try {
        const { data } = await axios.get(`${API_BASE}/rutas`, { params: { programacion_id: row.id, page: 1, per_page: 200 } });
        const items = data?.data ?? data ?? [];
        routesDraft.value = items.map((it) => ({
            id: it.id,
            programacion_id: row.id,
            origen_place_id: it.origen_place_id ?? null,
            origen_desc: it.origen_desc ?? '',
            origen_lat: it.origen_lat ?? null,
            origen_lng: it.origen_lng ?? null,
            destino_place_id: it.destino_place_id ?? null,
            destino_desc: it.destino_desc ?? '',
            destino_lat: it.destino_lat ?? null,
            destino_lng: it.destino_lng ?? null,
            distancia_m: it.distancia_m ?? null,
            duracion_s: it.duracion_s ?? null,
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
        const { data } = await axios.get(API_CRE, { params });
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
            await axios.patch(`${API_PROG}/${product.value.id}`, payload);
            const progId = product.value.id;

            // nuevas
            let toCreate = routesDraft.value.filter((r) => r._state === 'new');
            // regreso auto si aplica
            toCreate = finalizeRoutesForCreate(progId, toCreate);
            // eliminadas
            const toDelete = routesDraft.value.filter((r) => r._state === 'delete' && r.id);

            const reqs = [];
            toCreate.forEach((r) => {
                const p = { ...r, programacion_id: progId };
                delete p._state;
                delete p.id;
                reqs.push(axios.post(`${API_BASE}/rutas`, p));
            });
            toDelete.forEach((r) => reqs.push(axios.delete(`${API_BASE}/rutas/${r.id}`)));
            if (reqs.length) await Promise.allSettled(reqs);

            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            // CREAR
            const { data } = await axios.post(API_PROG, payload);
            const created = data?.data ?? data ?? {};
            const progId = created.id;

            if (progId && routesDraft.value.length) {
                let toCreate = routesDraft.value.filter((r) => r._state === 'new');
                toCreate = finalizeRoutesForCreate(progId, toCreate);
                const reqs = toCreate.map((r) => {
                    const p = { ...r, programacion_id: progId };
                    delete p._state;
                    delete p.id;
                    return axios.post(`${API_BASE}/rutas`, p);
                });
                await Promise.allSettled(reqs);
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
        await axios.delete(`${API_PROG}/${current.value.id}`);
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
        await axios.post(`${API_PROG}/bulk-delete`, { ids });
        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];
        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });
        await refreshAfterDelete(ids.length);
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede eliminar' : 'Error al eliminar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6000
        });
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

<template>
    <div class="card">
        <Toolbar class="mb-3">
            <template #start>
                <div class="flex items-center gap-2 shrink-0">
                    <Button label="Crear" icon="pi pi-plus" @click="openNew" />
                    <Button label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
                    <Button label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
                </div>
            </template>

            <template #end>
                <div class="min-w-0 w-full sm:w-80 md:w-[26rem]">
                    <IconField class="w-full">
                        <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                        <InputText v-model.trim="search" placeholder="Escribe para buscar…" class="w-full" @keydown.enter.prevent="forceFetch" @keydown.esc.prevent="clearSearch" />
                        <span v-if="search" class="pi pi-times cursor-pointer p-input-icon-right" style="right: 0.75rem" @click="clearSearch" aria-label="Limpiar búsqueda" />
                    </IconField>
                </div>
            </template>
        </Toolbar>

        <DataTable
            :value="products"
            dataKey="id"
            v-model:selection="selected"
            selectionMode="multiple"
            :loading="loading"
            :lazy="true"
            :paginator="true"
            :rows="Number(rows)"
            :totalRecords="Number(total)"
            :first="(Number(page) - 1) * Number(rows)"
            :sortField="sortField"
            :sortOrder="sortOrder"
            @page="onPage"
            @sort="onSort"
            :rowsPerPageOptions="[5, 10, 25, 50]"
            currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
            emptyMessage="No hay registros"
        >
            <Column selectionMode="multiple" headerStyle="width:3rem" />
            <Column field="id" header="id" sortable style="min-width: 6rem" />
            <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 14rem" />
            <Column field="estadoPractica" header="Estado" sortable style="min-width: 10rem" />
            <Column field="fechaInicio" header="Inicio" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaInicio) }}</template>
            </Column>
            <Column field="fechaFinalizacion" header="Fin" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaFinalizacion) }}</template>
            </Column>

            <!-- Acciones -->
            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Programación de práctica" :style="{ width: '42rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="creacion" class="font-medium">Nombre Práctica</label>
                    <AutoComplete
                        inputId="creacion"
                        v-model="product.creacion"
                        :suggestions="progSugs"
                        optionLabel="label"
                        placeholder="Escribe para buscar…"
                        :dropdown="true"
                        :forceSelection="true"
                        :loading="loadingProgs"
                        @complete="onCompleteCreaciones"
                        @item-select="onSelectCreacion"
                        appendTo="self"
                        class="w-full"
                        :pt="{ root: { class: 'w-full' }, input: { class: 'w-full h-11 text-base' }, dropdownButton: { class: 'h-11' }, panel: { class: 'w-full max-h-80 overflow-auto' } }"
                    >
                        <template #option="{ option }">
                            <div class="flex flex-col">
                                <span class="font-medium">{{ option.label }}</span>
                                <small class="text-gray-500"> {{ option.programa }}<span v-if="option.facultad"> • </span>{{ option.facultad }} </small>
                            </div>
                        </template>
                    </AutoComplete>
                    <small v-if="showError('creacion')" class="text-red-500">{{ errors.creacion }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="descripcion">Descripción</label>
                    <Textarea id="descripcion" v-model.trim="product.descripcion" autoResize fluid />
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="flex flex-col gap-2">
                        <label for="fechaInicio">Fecha inicio</label>
                        <InputText id="fechaInicio" type="date" v-model="product.fechaInicio" :invalid="showError('fechaInicio')" @blur="onBlur('fechaInicio')" />
                        <small v-if="showError('fechaInicio')" class="text-red-500">{{ errors.fechaInicio }}</small>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="fechaFin">Fecha finalización</label>
                        <InputText id="fechaFin" type="date" v-model="product.fechaFinalizacion" :invalid="showError('fechaFinalizacion')" @blur="onBlur('fechaFinalizacion')" />
                        <small v-if="showError('fechaFinalizacion')" class="text-red-500">{{ errors.fechaFinalizacion }}</small>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="recursos">Recursos necesarios</label>
                    <Textarea id="recursos" v-model.trim="product.recursosNecesarios" :invalid="showError('recursosNecesarios')" @blur="onBlur('recursosNecesarios')" />
                    <small v-if="showError('recursosNecesarios')" class="text-red-500">{{ errors.recursosNecesarios }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="justificacion">Justificación</label>
                    <Textarea id="justificacion" v-model.trim="product.justificacion" :invalid="showError('justificacion')" @blur="onBlur('justificacion')" />
                    <small v-if="showError('justificacion')" class="text-red-500">{{ errors.justificacion }}</small>
                </div>

                <div class="mt-3 grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-end">
                    <div class="flex flex-col gap-2">
                        <label for="lugar" class="font-medium">Lugar de realización</label>
                        <InputText id="lugar" v-model.trim="product.lugarDeRealizacion" class="h-11" fluid />
                    </div>
                    <ToggleButton
                        inputId="reqTrans"
                        v-model="product.requiereTransporte"
                        onLabel="Requiere transporte"
                        offLabel="Sin transporte"
                        :pt="{
                            root: { class: 'h-11' },
                            box: { class: 'h-11 px-3' },
                            label: { class: 'text-sm' }
                        }"
                        class="justify-self-start"
                    />
                </div>

                <!-- Recorridos -->
                <div class="mt-2" v-if="product.requiereTransporte">
                    <div class="flex items-center justify-between mb-2">
                        <label class="font-medium">Recorridos</label>
                        <Button size="small" icon="pi pi-plus" label="Añadir recorrido" @click="routeDlg = true" />
                    </div>

                    <div v-if="!visibleRoutes().length" class="text-gray-500 text-sm">No hay recorridos definidos.</div>

                    <div v-else class="space-y-2">
                        <div v-for="(r, idx) in visibleRoutes()" :key="idx" class="border rounded p-2">
                            <div class="flex items-center justify-between">
                                <div class="text-sm">
                                    <div class="mt-1"><b>Justificación:</b> {{ r.justificacion }}</div>
                                </div>
                                <Button icon="pi pi-times" text severity="danger" @click="removeDraftRoute(routesDraft.indexOf(r))" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Picker de rutas -->
                <RoutePickerDialog v-model:visible="routeDlg" :sedes="SEDES" :origin-override="nextRouteOrigin" @picked="addDraftRoute" />
            </div>

            <template #footer>
                <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" />
                <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
            </template>
        </Dialog>

        <!-- Confirmar eliminar -->
        <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
            <div>
                ¿Seguro que quieres eliminar la programación <b>Id:{{ current?.id }}</b> — <b>{{ current?.nombrePractica }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de programación" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '720px' }">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>

            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                    <!-- Cabecera -->
                    <div class="font-semibold mb-3 break-words">Id: {{ d.id }} — {{ d.nombrePractica }}</div>

                    <!-- Info básica -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Programa</dt>
                                <dd>{{ d.programaAcademico }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Estado</dt>
                                <dd>{{ d.estadoPractica }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Fechas</dt>
                                <dd class="break-words">{{ fmtDDMMYYYY(d.fechaInicio) }} → {{ fmtDDMMYYYY(d.fechaFinalizacion) }}</dd>
                            </div>
                        </dl>

                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Transporte</dt>
                                <dd>{{ d.requiereTransporte ? 'Sí' : 'No' }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Lugar</dt>
                                <dd>{{ d.lugarDeRealizacion || '—' }}</dd>
                            </div>
                        </dl>
                    </div>

                    <!-- Recorridos -->
                    <div v-if="d.routes?.length" class="mt-4">
                        <div class="text-sm font-semibold">Recorridos ({{ d.routes.length }})</div>

                        <!-- Totales por programación -->
                        <div class="text-xs text-gray-600 mt-1">
                            <b>Total</b> —
                            <span v-if="d.routes.some((r) => r?.distancia_m != null)">
                                {{ fmtKm(d.routes.reduce((a, r) => a + (Number(r?.distancia_m) || 0), 0)) }}
                            </span>
                            <span v-if="d.routes.some((r) => r?.duracion_s != null)" class="ml-2">
                                {{ fmtMin(d.routes.reduce((a, r) => a + (Number(r?.duracion_s) || 0), 0)) }}
                            </span>
                        </div>

                        <div class="space-y-2 mt-2">
                            <div v-for="(r, i) in d.routes" :key="r.id ?? i" class="border rounded p-2">
                                <!-- Origen / Destino legibles -->
                                <div class="text-xs">
                                    <div>
                                        <b>Origen:</b>
                                        {{ r.origen_desc || (r.origen_lat != null && r.origen_lng != null ? `${r.origen_lat}, ${r.origen_lng}` : '—') }}
                                    </div>
                                    <div>
                                        <b>Destino:</b>
                                        {{ r.destino_desc || (r.destino_lat != null && r.destino_lng != null ? `${r.destino_lat}, ${r.destino_lng}` : '—') }}
                                    </div>
                                </div>

                                <!-- Justificación -->
                                <div v-if="r.justificacion" class="mt-1 text-xs"><b>Justificación:</b> {{ r.justificacion }}</div>

                                <!-- Métricas -->
                                <div class="mt-1 text-xs">
                                    <!-- Si la ruta YA trae métricas desde BD -->
                                    <template v-if="r.distancia_m != null || r.duracion_s != null">
                                        <div v-if="r.distancia_m != null"><b>Distancia:</b> {{ fmtKm(r.distancia_m) }}</div>
                                        <div v-if="r.duracion_s != null"><b>Duración:</b> {{ fmtMin(r.duracion_s) }}</div>
                                    </template>

                                    <!-- Si NO trae métricas: usamos la estimación on-the-fly -->
                                    <template v-else>
                                        <template v-if="routeEstimates[kRoute(d, r, i)]?.loading"> Calculando ruta… </template>
                                        <template v-else-if="routeEstimates[kRoute(d, r, i)]?.error">
                                            <span class="text-red-500">No se pudo calcular la ruta.</span>
                                        </template>
                                        <template v-else-if="routeEstimates[kRoute(d, r, i)]">
                                            <div><b>Distancia:</b> {{ km(routeEstimates[kRoute(d, r, i)].distance_m) }} km</div>
                                            <div><b>Duración:</b> {{ human(routeEstimates[kRoute(d, r, i)].duration_s) }}</div>
                                        </template>
                                        <template v-else> Sin métricas (ruta antigua o no calculada). </template>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Otros campos -->
                    <div class="mt-4 space-y-3">
                        <div>
                            <div class="text-sm font-semibold">Recursos necesarios</div>
                            <div class="whitespace-pre-line break-words">{{ d.recursosNecesarios }}</div>
                        </div>
                        <div>
                            <div class="text-sm font-semibold">Justificación</div>
                            <div class="whitespace-pre-line break-words">{{ d.justificacion }}</div>
                        </div>
                        <div v-if="d.descripcion">
                            <div class="text-sm font-semibold">Descripción</div>
                            <div class="whitespace-pre-line break-words">{{ d.descripcion }}</div>
                        </div>
                    </div>

                    <!-- Metadatos -->
                    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                            <div class="font-semibold">Creado</div>
                            <div>{{ d.fechacreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">Modificado</div>
                            <div>{{ d.fechamodificacion }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
            </template>
        </Dialog>
    </div>
</template>
