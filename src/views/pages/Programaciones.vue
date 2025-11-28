<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api, ensureCsrf } from '@/api';
import RoutePickerDialog from '@/components/RoutePickerDialog.vue';
import RouteMiniMap from '@/components/RouteMiniMap.vue';
import { useAuthStore } from '@/stores/auth';

const routeEstimates = reactive({});
const tableUid = `prog-${Math.random().toString(36).slice(2)}`;
const uid = Math.random().toString(36).slice(2);
const recId = `recursos-${uid}`;
const jusId = `justificacion-${uid}`;
const numEstId = `num-est-${uid}`;

// ===== Auth / permisos =====
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// Permisos CRUD de Programaciones
const canViewProgramaciones = computed(() => hasPerm('programaciones.view'));
const canCreateProgramaciones = computed(() => hasPerm('programaciones.create'));
const canEditProgramaciones = computed(() => hasPerm('programaciones.edit'));
const canDeleteProgramaciones = computed(() => hasPerm('programaciones.delete'));

/* ========= API (relativas al baseURL de api) ========= */
const API_PROG = '/programaciones';
const API_CRE = '/creaciones';
const API_RUTAS = '/rutas';

// ======== Aprobaciones Programaciones  ========

const approvalEndpoints = {
    depart: {
        approve: (id) => `${API_PROG}/${id}/aprobar/departamento`,
        reject: (id) => `${API_PROG}/${id}/rechazar/departamento`
    },
    postg: {
        approve: (id) => `${API_PROG}/${id}/aprobar/postgrados`,
        reject: (id) => `${API_PROG}/${id}/rechazar/postgrados`
    },
    decano: {
        approve: (id) => `${API_PROG}/${id}/aprobar/decano`,
        reject: (id) => `${API_PROG}/${id}/rechazar/decano`
    },
    jefe_postg: {
        approve: (id) => `${API_PROG}/${id}/aprobar/jefe-postgrados`,
        reject: (id) => `${API_PROG}/${id}/rechazar/jefe-postgrados`
    },
    vice: {
        approve: (id) => `${API_PROG}/${id}/aprobar/vicerrectoria`,
        reject: (id) => `${API_PROG}/${id}/rechazar/vicerrectoria`
    }
};

const estadoFieldByActor = {
    depart: 'estadoDepart',
    postg: 'estadoPostg',
    decano: 'estadoDecano',
    jefe_postg: 'estadoJefePostg',
    vice: 'estadoVice'
};

const currentActorKey = computed(() => {
    if (hasPerm('programaciones.aprobar.departamento') || hasPerm('programaciones.rechazar.departamento')) {
        return 'depart';
    }
    if (hasPerm('programaciones.aprobar.postgrados') || hasPerm('programaciones.rechazar.postgrados')) {
        return 'postg';
    }
    if (hasPerm('programaciones.aprobar.decano') || hasPerm('programaciones.rechazar.decano')) {
        return 'decano';
    }
    if (hasPerm('programaciones.aprobar.jefe_postgrados') || hasPerm('programaciones.rechazar.jefe_postgrados')) {
        return 'jefe_postg';
    }
    if (hasPerm('programaciones.aprobar.vicerrectoria') || hasPerm('programaciones.rechazar.vicerrectoria')) {
        return 'vice';
    }
    return null;
});

function canApproveRow(row) {
    const actorKey = currentActorKey.value;
    if (!actorKey) return false;

    if (['aprobada', 'rechazada'].includes(row.estadoPractica)) return false;

    const field = estadoFieldByActor[actorKey];
    if (!field) return false;

    return row[field] === 'pendiente';
}

function canRejectRow(row) {
    return canApproveRow(row);
}

const toast = useToast();

const allSelected = computed(() => selected.value.length > 0 && selected.value.length === products.value.length);
const someSelected = computed(() => selected.value.length > 0 && selected.value.length < products.value.length);
function toggleAll(e) {
    if (e.checked) selected.value = [...products.value];
    else selected.value = [];
}

function kRoute(prog, r, i) {
    const oLat = Number(r?.origen_lat),
        oLng = Number(r?.origen_lng);
    const dLat = Number(r?.destino_lat),
        dLng = Number(r?.destino_lng);
    const idPart = r?.id ?? i;
    return `${prog?.id ?? 'p'}:${idPart}:${isFinite(oLat) ? oLat.toFixed(5) : 'x'},${isFinite(oLng) ? oLng.toFixed(5) : 'x'}>${isFinite(dLat) ? dLat.toFixed(5) : 'x'},${isFinite(dLng) ? dLng.toFixed(5) : 'x'}`;
}

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
        await ensureCsrf();
        const { data } = await api.post('/compute-route', { origin: { lat: oLat, lng: oLng }, dest: { lat: dLat, lng: dLng }, mode: 'DRIVE' }, { timeout: 15000 });

        const dist = Number(data?.distance_m ?? data?.distance ?? 0) || null;
        const dur = Number(data?.duration_s ?? data?.duration ?? 0) || null;

        routeEstimates[key].distance_m = dist;
        routeEstimates[key].duration_s = dur;

        if (r) {
            if (r.distancia_m == null) r.distancia_m = dist;
            if (r.duracion_s == null) r.duracion_s = dur;
        }
    } catch (e) {
        routeEstimates[key].error = true;
    } finally {
        routeEstimates[key].loading = false;
    }
}

/* ===== SEDES ===== */
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

const approveLoading = ref(false);

const rejectDialog = ref(false);
const rejectLoading = ref(false);
const rejectTarget = ref(null);
const rejectJustificacion = ref('');
const rejectError = ref('');

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
        const { data } = await api.get(API_PROG, { params: buildParams({ force }), signal });

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

/* ===== Autocomplete de creaciones ===== */
const creQuery = ref(''); // texto visible
const creSugs = ref([]); // sugerencias del endpoint
const loadingCre = ref(false);
const showCrePanel = ref(false);
const hiCre = ref(-1); // índice resaltado
let creTimer = null;
const CRE_DEBOUNCE = 250;
const creListId = `cre-listbox-${Math.random().toString(36).slice(2)}`;

function openCrePanel() {
    showCrePanel.value = true;
}
function closeCrePanel() {
    showCrePanel.value = false;
    hiCre.value = -1;
}

const norm = (v) => (v ?? '') + '';

async function fetchCreaciones(q = '') {
    loadingCre.value = true;
    try {
        const params = { per_page: 20, page: 1 };
        if (q.trim()) params.q = q.trim();
        const { data } = await api.get(API_CRE, { params });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        creSugs.value = items.map((c) => ({
            id: c.id,
            label: c.nombrePractica ?? c.nombre_practica,
            programa: c.programaAcademico ?? c.programa_academico,
            facultad: c.facultad,
            nivel: c.nivelAcademico ?? c.nivel_academico
        }));
    } catch (e) {
        creSugs.value = [];
        toast.add({ severity: 'error', summary: 'Creaciones', detail: e?.response?.data?.message || e.message, life: 5000 });
    } finally {
        loadingCre.value = false;
    }
}

function onCreInput() {
    const q = norm(creQuery.value).trim();
    showCrePanel.value = true;
    clearTimeout(creTimer);
    creTimer = setTimeout(() => {
        if (!q) {
            creSugs.value = [];
            hiCre.value = -1;
            return;
        }
        fetchCreaciones(q);
    }, CRE_DEBOUNCE);
}

function onCreKeydown(e) {
    if (!showCrePanel.value || !creSugs.value.length) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        hiCre.value = hiCre.value < creSugs.value.length - 1 ? hiCre.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        hiCre.value = hiCre.value > 0 ? hiCre.value - 1 : creSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (hiCre.value >= 0) selectCreacion(creSugs.value[hiCre.value]);
    }
}

function selectCreacion(it) {
    product.value.creacion = it;
    product.value.nombrePractica = it?.label ?? '';
    product.value.nivelAcademico = it?.nivel ?? null;
    creQuery.value = it?.label ?? '';
    closeCrePanel();
}

function onCreEnter() {
    closeCrePanel();
}
function clearCreacion() {
    if (!creQuery.value) return;
    creQuery.value = '';
    creSugs.value = [];
    hiCre.value = -1;
    closeCrePanel();
}

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

function normalizeRoute(it = {}) {
    const r = { ...it };

    r.origen_lat = r.origen_lat ?? r.origen?.lat ?? null;
    r.origen_lng = r.origen_lng ?? r.origen?.lng ?? null;
    r.destino_lat = r.destino_lat ?? r.destino?.lat ?? null;
    r.destino_lng = r.destino_lng ?? r.destino?.lng ?? null;

    r.distancia_m = r.distancia_m ?? r.distanciaM ?? null;
    r.duracion_s = r.duracion_s ?? r.duracionS ?? null;
    r.numero_peajes = r.numero_peajes ?? r.numeroPeajes ?? null;
    r.valor_peajes = r.valor_peajes ?? r.valorPeajes ?? null;

    return r;
}

async function hydrateCreacionesForDetails(progs) {
    const byId = new Map(selected.value.map((r) => [r.id, r]));

    progs.forEach((p) => {
        const base = byId.get(p.id);
        if (!base) return;
        p.creacionId = p.creacionId ?? p.creacion_id ?? base.creacionId ?? base.creacion_id ?? null;
    });

    const ids = [...new Set(progs.map((p) => p.creacionId ?? p.creacion_id).filter(Boolean))];

    if (!ids.length) return;

    const reqs = ids.map((id) => api.get(`${API_CRE}/${id}`));
    const results = await Promise.allSettled(reqs);

    const creMap = {};
    results.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const c = res.value.data?.data ?? res.value.data;
        if (!c || c.id == null) return;
        creMap[c.id] = c;
    });

    progs.forEach((p) => {
        const cid = p.creacionId ?? p.creacion_id;
        const c = cid ? creMap[cid] : null;
        if (!c) return;

        p.creacion = {
            id: c.id,
            programaAcademico: c.programaAcademico ?? c.programa_academico,
            facultad: c.facultad,
            nivelAcademico: c.nivelAcademico ?? c.nivel_academico
        };

        if (!p.nivelAcademico) {
            p.nivelAcademico = p.creacion.nivelAcademico;
        }
    });
}

async function openDetails() {
    if (!selected.value.length) return;
    const currentIds = new Set((products.value || []).map((p) => p.id));
    const ids = [...new Set(selected.value.filter((r) => currentIds.has(r.id)).map((r) => r.id))];
    if (!ids.length) return;

    detailsLoading.value = true;
    details.value = [];
    Object.keys(routeEstimates).forEach((k) => delete routeEstimates[k]);

    try {
        const progReqs = ids.map((id) => api.get(`${API_PROG}/${id}`));
        const progResults = await Promise.allSettled(progReqs);

        const progs = progResults
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value.data?.data ?? r.value.data)
            .filter(Boolean);

        await hydrateCreacionesForDetails(progs);

        const routeReqs = progs.map((p) => api.get(API_RUTAS, { params: { programacion_id: p.id, page: 1, per_page: 200 } }));
        const routeResults = await Promise.allSettled(routeReqs);

        for (const [i, p] of progs.entries()) {
            const rData = routeResults[i];
            const baseRoutes = rData.status === 'fulfilled' ? ((Array.isArray(rData.value.data) ? rData.value.data : rData.value.data?.data) ?? []) : [];

            p.routes = baseRoutes.map((it) => normalizeRoute(it));
            for (const r of p.routes) {
                try {
                    const { data } = await api.get(`${API_RUTAS}/${r.id}`);
                    const merged = normalizeRoute(data?.data ?? data ?? {});
                    Object.assign(r, merged);
                } catch {
                    console.warn(`No se pudo actualizar la ruta ${r.id}`);
                }
            }
            p.routes.forEach((r, idx) => {
                if (r?.distancia_m == null || r?.duracion_s == null) {
                    const key = kRoute(p, r, idx);
                    fetchEstimateForRoute(r, key);
                }
            });
        }

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
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

/* ========================= CRUD crear/editar ========================= */
const productDialog = ref(false);
const saving = ref(false);
const product = ref({
    id: null,
    creacion: null,
    nombrePractica: '',
    descripcion: '',
    requiereTransporte: false,
    lugarDeRealizacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: '',
    numeroEstudiantes: ''
});
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
function finalizeRoutesForCreate(progId, currentToCreate) {
    // De momento no auto-creamos ruta de regreso
    return currentToCreate;
}

const errors = reactive({
    creacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: '',
    numeroEstudiantes: null
});
const touched = reactive({
    creacion: false,
    justificacion: false,
    recursosNecesarios: false,
    fechaInicio: false,
    fechaFinalizacion: false,
    numeroEstudiantes: false
});
const rules = {
    creacion: [(v) => !!v || 'Selecciona una práctica.'],
    justificacion: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    fechaInicio: [
        (v) => !!v || 'Requerido.',
        (v) => {
            if (!v) return true;
            const hoyStr = new Date().toISOString().split('T')[0];
            const iniStr = new Date(v).toISOString().split('T')[0];
            return iniStr >= hoyStr || 'La fecha de inicio no puede ser anterior a hoy.';
        },
        (v) => {
            const fin = product.value.fechaFinalizacion ? new Date(product.value.fechaFinalizacion) : null;
            const ini = v ? new Date(v) : null;
            if (ini && fin && ini > fin) return 'La fecha de inicio no puede ser posterior a la finalización.';
            return true;
        }
    ],
    fechaFinalizacion: [
        (v) => !!v || 'Requerido.',
        (v) => {
            const ini = product.value.fechaInicio ? new Date(product.value.fechaInicio) : null;
            const fin = v ? new Date(v) : null;
            if (ini && fin && fin < ini) return 'La fecha de finalización no puede ser anterior a la de inicio.';
            return true;
        }
    ],
    numeroEstudiantes: [(v) => (v !== null && v !== undefined && v !== '' && !isNaN(v)) || 'Requerido.', (v) => Number(v) > 0 || 'Debe ser un número mayor que 0.']
};
function validateField(f) {
    errors[f] = '';
    const val = product.value[f];
    for (const test of rules[f] || []) {
        const ok = test(val);
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
        fechaFinalizacion: '',
        numeroEstudiantes: null
    };
    routesDraft.value = [];
    creSugs.value = [];
    creQuery.value = '';
    hiCre.value = -1;
    showCrePanel.value = false;
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
        fechaFinalizacion: toDateInput(row.fechaFinalizacion),
        numeroEstudiantes: row.numeroEstudiantes ?? ''
    };
    resetValidation();
    routesDraft.value = [];

    try {
        const { data } = await api.get(API_RUTAS, { params: { programacion_id: row.id, page: 1, per_page: 200 } });
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
            numero_peajes: it.numeroPeajes ?? 0,
            valor_peajes: it.valorPeajes ?? 0,
            polyline: it.polyline ?? null,
            justificacion: it.justificacion ?? '',
            _state: 'keep'
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: e?.response?.data?.message || e.message, life: 5000 });
    }

    productDialog.value = true;
}

/* ===== Guardar ===== */
async function saveProduct() {
    if (saving.value) return;
    if (!validateAll()) {
        toast.add({
            severity: 'warn',
            summary: 'Valida el formulario',
            detail: 'Corrige los campos marcados.',
            life: 3000
        });
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
        fecha_finalizacion: product.value.fechaFinalizacion,
        numero_estudiantes: product.value.numeroEstudiantes
    };

    try {
        saving.value = true;
        await ensureCsrf();

        if (product.value.id) {
            // === ACTUALIZAR ===
            await api.patch(`${API_PROG}/${product.value.id}`, payload);
            const progId = product.value.id;
            let toCreate = routesDraft.value.filter((r) => r._state === 'new');
            toCreate = finalizeRoutesForCreate(progId, toCreate);
            const toDelete = routesDraft.value.filter((r) => r._state === 'delete' && r.id);

            const reqs = [];
            for (const r of toCreate) {
                const p = { ...r, programacion_id: progId };
                delete p._state;
                delete p.id;
                reqs.push(
                    api.post(API_RUTAS, p).then(async (res) => {
                        const rutaId = res.data?.data?.id ?? res.data?.id;
                        if (rutaId) {
                            try {
                                await api.post(`${API_RUTAS}/${rutaId}/peajes/sync`, {
                                    categoria: r.categoria_peaje || 'I'
                                });
                            } catch {
                                console.warn(`No se pudieron sincronizar peajes para ruta ${rutaId}`);
                            }
                        }
                    })
                );
            }
            // eliminar rutas marcadas
            for (const r of toDelete) {
                reqs.push(api.delete(`${API_RUTAS}/${r.id}`));
            }

            if (reqs.length) await Promise.allSettled(reqs);

            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            // === CREAR NUEVO ===
            const { data } = await api.post(API_PROG, payload);
            const created = data?.data ?? data ?? {};
            const progId = created.id;

            if (progId && routesDraft.value.length) {
                let toCreate = routesDraft.value.filter((r) => r._state === 'new');
                toCreate = finalizeRoutesForCreate(progId, toCreate);

                const reqs = [];
                for (const r of toCreate) {
                    const p = { ...r, programacion_id: progId };
                    delete p._state;
                    delete p.id;
                    reqs.push(
                        api.post(API_RUTAS, p).then(async (res) => {
                            const rutaId = res.data?.data?.id ?? res.data?.id;
                            if (rutaId) {
                                try {
                                    await api.post(`${API_RUTAS}/${rutaId}/peajes/sync`, {
                                        categoria: r.categoria_peaje || 'I'
                                    });
                                } catch {
                                    console.warn(`No se pudieron sincronizar peajes para ruta ${rutaId}`);
                                }
                            }
                        })
                    );
                }

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
            errors.numeroEstudiantes = data.errors.numero_estudiantes?.[0] ?? errors.numeroEstudiantes;
        }
        toast.add({
            severity: 'error',
            summary: 'No se pudo guardar',
            detail: data?.message || e.message,
            life: 5000
        });
    } finally {
        saving.value = false;
    }
}

// ==================== Aprobación Programaciones ====================
async function approveRow(row) {
    const actorKey = currentActorKey.value;
    if (!actorKey) {
        toast.add({
            severity: 'warn',
            summary: 'Sin permisos',
            detail: 'No tienes permisos para aprobar en esta etapa.',
            life: 4000
        });
        return;
    }

    const endpoints = approvalEndpoints[actorKey];
    if (!endpoints?.approve) return;

    try {
        approveLoading.value = true;
        await ensureCsrf();

        const { data } = await api.post(endpoints.approve(row.id));

        if (!data?.ok) {
            toast.add({
                severity: 'warn',
                summary: 'No se pudo aprobar',
                detail: data?.message || 'El servidor rechazó la operación.',
                life: 5000
            });
            return;
        }

        await getProducts({ force: true });

        toast.add({
            severity: 'success',
            summary: 'Aprobado',
            detail: 'La programación fue aprobada correctamente.',
            life: 3000
        });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede aprobar' : 'Error al aprobar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6000
        });
    } finally {
        approveLoading.value = false;
    }
}

function openRejectDialog(row) {
    const actorKey = currentActorKey.value;
    if (!actorKey) {
        toast.add({
            severity: 'warn',
            summary: 'Sin permisos',
            detail: 'No tienes permisos para rechazar en esta etapa.',
            life: 4000
        });
        return;
    }

    rejectTarget.value = { row, actorKey };
    rejectJustificacion.value = '';
    rejectError.value = '';
    rejectDialog.value = true;
}

function closeRejectDialog() {
    rejectDialog.value = false;
    rejectTarget.value = null;
    rejectJustificacion.value = '';
    rejectError.value = '';
}

async function confirmReject() {
    if (!rejectJustificacion.value || rejectJustificacion.value.trim().length < 5) {
        rejectError.value = 'La justificación debe tener mínimo 5 caracteres.';
        return;
    }

    const target = rejectTarget.value;
    if (!target) return;

    const { row, actorKey } = target;
    const endpoints = approvalEndpoints[actorKey];
    if (!endpoints?.reject) return;

    try {
        rejectLoading.value = true;
        rejectError.value = '';

        await ensureCsrf();

        const { data } = await api.post(endpoints.reject(row.id), {
            justificacion: rejectJustificacion.value.trim()
        });

        if (!data?.ok) {
            rejectError.value = data?.message || 'El servidor rechazó la operación.';
            return;
        }

        await getProducts({ force: true });

        toast.add({
            severity: 'success',
            summary: 'Rechazado',
            detail: 'La programación fue rechazada correctamente.',
            life: 3000
        });

        closeRejectDialog();
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        rejectError.value = `[${status ?? 'ERR'}] ${msg}`;
    } finally {
        rejectLoading.value = false;
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
        await ensureCsrf();
        await api.delete(`${API_PROG}/${current.value.id}`);
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
/* ===== Borrado en lote ===== */
const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!selected.value.length) return;
    bulkDeleteDialog.value = true;
}
async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);
    try {
        await ensureCsrf();
        await api.post(`${API_PROG}/bulk-delete`, { ids });
        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];
        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });
        await getProducts({ force: true });
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
    if (Number(page.value) > totalPages) {
        page.value = totalPages;
    }
    return getProducts({ force: true });
}

/* ===== Util ===== */
onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (creTimer) clearTimeout(creTimer);
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

function nivelPractica(d) {
    const raw = d?.nivelAcademico || d?.nivel_academico || d?.creacion?.nivelAcademico || d?.creacion?.nivel_academico || '';
    const norm = raw.toString().trim().toLowerCase();

    if (norm.startsWith('pre')) {
        return 'pregrado';
    }
    if (norm.startsWith('post')) {
        return 'postgrado';
    }
    return '';
}

onMounted(() => getProducts());
</script>

<template>
    <div class="card">
        <Toolbar class="mb-3">
            <template #start>
                <div class="flex items-center gap-2 shrink-0">
                    <Button v-if="canCreateProgramaciones" label="Crear" icon="pi pi-plus" @click="openNew" />
                    <Button v-if="canDeleteProgramaciones" label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
                    <Button v-if="canViewProgramaciones" label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
                </div>
            </template>

            <template #end>
                <div class="flex items-center gap-3 w-full justify-end">
                    <!-- Buscador -->
                    <form role="search" class="min-w-0 w-full sm:w-80 md:w-[26rem]" @submit.prevent="forceFetch">
                        <IconField class="w-full p-input-icon-left relative">
                            <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                            <InputText
                                id="progSearch"
                                name="progSearch"
                                v-model.trim="search"
                                role="searchbox"
                                placeholder="Escribe para buscar…"
                                class="w-full h-10 leading-10 pr-8"
                                autocomplete="off"
                                @keydown.enter.prevent="forceFetch"
                                @keydown.esc.prevent="clearSearch"
                            />
                            <button v-if="search" type="button" class="absolute right-3 top-1/2 -translate-y-1/2" @click="clearSearch" aria-label="Limpiar búsqueda">X</button>
                        </IconField>
                    </form>
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
            :pt="{
                paginator: {
                    rowsPerPageDropdown: {
                        input: { id: 'prog-rows-per-page', name: 'prog-rows-per-page' }
                    },
                    firstPageButton: { root: { 'aria-label': 'Primera página' } },
                    prevPageButton: { root: { 'aria-label': 'Página anterior' } },
                    nextPageButton: { root: { 'aria-label': 'Siguiente página' } },
                    lastPageButton: { root: { 'aria-label': 'Última página' } }
                }
            }"
        >
            <!-- Columna de selección con ids únicos -->
            <Column headerStyle="width:3rem">
                <template #headercheckbox>
                    <Checkbox
                        :inputId="tableUid + '-select-all'"
                        :name="tableUid + '-select-all'"
                        :aria-label="'Seleccionar todas las filas'"
                        :binary="true"
                        :modelValue="allSelected"
                        :indeterminate="someSelected && !allSelected"
                        @change="toggleAll"
                    />
                </template>
                <template #checkbox="{ data, index }">
                    <Checkbox v-model="selected" :value="data" :inputId="`${tableUid}-row-${index + 1}`" name="row-select" :aria-label="`Seleccionar fila ${index + 1}`" />
                </template>
            </Column>

            <Column field="id" header="id" sortable style="min-width: 6rem" />
            <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 14rem" />
            <Column field="estadoPractica" header="Estado" sortable style="min-width: 10rem" />
            <Column field="numeroEstudiantes" header="Estudiantes" sortable style="min-width: 8rem" />
            <Column field="fechaInicio" header="Inicio" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaInicio) }}</template>
            </Column>
            <Column field="fechaFinalizacion" header="Fin" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaFinalizacion) }}</template>
            </Column>

            <Column :exportable="false" headerStyle="width:11rem">
                <template #body="{ data }">
                    <!-- Aprobar/Rechazar-->
                    <Button v-if="canApproveRow(data)" icon="pi pi-check" rounded text severity="success" class="mr-1" :disabled="approveLoading" @click.stop="approveRow(data)" />
                    <Button v-if="canRejectRow(data)" icon="pi pi-times" rounded text severity="warning" class="mr-1" :disabled="approveLoading" @click.stop="openRejectDialog(data)" />

                    <!-- Editar/Borrar-->
                    <Button v-if="canEditProgramaciones" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button v-if="canDeleteProgramaciones" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Programación de práctica" :style="{ width: '42rem' }" :modal="true" appendTo="body">
            <div class="flex flex-col gap-4">
                <!-- ===== Nombre Práctica (Autocomplete liviano) ===== -->
                <div class="flex flex-col gap-2 relative">
                    <label for="creacionQuery" class="font-medium">Nombre Práctica</label>

                    <IconField class="w-full relative">
                        <InputIcon :class="loadingCre ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                        <InputText
                            id="creacionQuery"
                            v-model.trim="creQuery"
                            placeholder="Escribe para buscar…"
                            class="w-full h-10 leading-10 pl-9 pr-8"
                            :class="{ 'rounded-b-none': showCrePanel }"
                            autocomplete="off"
                            role="combobox"
                            aria-autocomplete="list"
                            :aria-expanded="showCrePanel ? 'true' : 'false'"
                            :aria-controls="creListId"
                            :aria-activedescendant="hiCre >= 0 ? 'cre-opt-' + hiCre : undefined"
                            @focus="openCrePanel"
                            @input="onCreInput"
                            @keydown="onCreKeydown"
                            @keydown.enter.prevent="onCreEnter"
                            @keydown.esc.prevent="closeCrePanel"
                        />
                        <span v-if="creQuery" class="pi pi-times cursor-pointer absolute right-3 top-1/2 -translate-y-1/2" @click="clearCreacion" aria-label="Limpiar búsqueda" />
                    </IconField>

                    <!-- Panel de sugerencias (pegado al input, sin solapar) -->
                    <div
                        v-if="showCrePanel && creSugs.length"
                        :id="creListId"
                        role="listbox"
                        class="absolute left-0 right-0 top-full -mt-px max-h-72 overflow-auto z-50 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                    >
                        <div
                            v-for="(it, i) in creSugs"
                            :key="it.id"
                            :id="'cre-opt-' + i"
                            role="option"
                            :aria-selected="i === hiCre ? 'true' : 'false'"
                            class="px-3 py-2 cursor-pointer select-none"
                            :class="i === hiCre ? 'bg-primary-50' : ''"
                            @mouseenter="hiCre = i"
                            @mouseleave="hiCre = -1"
                            @mousedown.prevent
                            @click="selectCreacion(it)"
                        >
                            <div class="text-sm font-medium">{{ it.label }}</div>
                            <div class="text-xs text-gray-500">{{ it.programa }}<span v-if="it.facultad"> • </span>{{ it.facultad }}</div>
                        </div>
                    </div>

                    <!-- “Sin resultados” -->
                    <div
                        v-else-if="showCrePanel && !loadingCre && creQuery && !creSugs.length"
                        class="absolute left-0 right-0 top-full -mt-px z-50 px-3 py-2 text-sm text-surface-500 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                    >
                        Sin coincidencias
                    </div>

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

                <!-- Recursos necesarios -->
                <div class="flex flex-col gap-2">
                    <label :for="recId">Recursos necesarios</label>
                    <textarea
                        :id="recId"
                        name="recursosNecesarios"
                        v-model.trim="product.recursosNecesarios"
                        class="p-inputtextarea p-inputtext p-component w-full"
                        rows="3"
                        :class="{ 'p-invalid': showError('recursosNecesarios') }"
                        @blur="onBlur('recursosNecesarios')"
                    ></textarea>
                    <small v-if="showError('recursosNecesarios')" class="text-red-500">
                        {{ errors.recursosNecesarios }}
                    </small>
                </div>

                <!-- Justificación -->
                <div class="flex flex-col gap-2">
                    <label :for="jusId">Justificación</label>
                    <textarea
                        :id="jusId"
                        name="justificacion"
                        v-model.trim="product.justificacion"
                        class="p-inputtextarea p-inputtext p-component w-full"
                        rows="3"
                        :class="{ 'p-invalid': showError('justificacion') }"
                        @blur="onBlur('justificacion')"
                    ></textarea>
                    <small v-if="showError('justificacion')" class="text-red-500">
                        {{ errors.justificacion }}
                    </small>
                </div>

                <!-- Número de estudiantes -->
                <div class="flex flex-col gap-2">
                    <label :for="numEstId">Número de estudiantes</label>
                    <InputNumber
                        :inputId="numEstId"
                        v-model="product.numeroEstudiantes"
                        :min="0"
                        :useGrouping="false"
                        :class="{ 'p-invalid': showError('numeroEstudiantes') }"
                        @update:modelValue="validateField('numeroEstudiantes')"
                        @blur="onBlur('numeroEstudiantes')"
                        fluid
                    />
                    <small v-if="showError('numeroEstudiantes')" class="text-red-500">
                        {{ errors.numeroEstudiantes }}
                    </small>
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
                        <span id="recorridos-label" class="font-medium">Recorridos</span>
                        <Button size="small" icon="pi pi-plus" label="Añadir recorrido" @click="routeDlg = true" :pt="{ root: { 'aria-labelledby': 'recorridos-label' } }" />
                    </div>

                    <div v-if="!visibleRoutes().length" class="text-gray-500 text-sm">No hay recorridos definidos.</div>

                    <div v-else class="space-y-3">
                        <div v-for="(r, idx) in visibleRoutes()" :key="r.id ?? idx" class="border rounded p-2 space-y-2">
                            <div class="flex items-center justify-between">
                                <div class="text-sm">
                                    <div><b>Justificación:</b> {{ r.justificacion }}</div>
                                    <div class="mt-1 space-x-4">
                                        <span v-if="r.distancia_m != null"><b>Distancia:</b> {{ (r.distancia_m / 1000).toFixed(2) }} km</span>
                                        <span v-if="r.duracion_s != null"><b>Duración:</b> {{ Math.round(r.duracion_s / 60) }} min</span>
                                        <span v-if="r.numero_peajes != null"><b>Peajes:</b> {{ r.numero_peajes }}</span>
                                        <span v-if="r.valor_peajes != null && r.valor_peajes > 0">
                                            <b>Valor total:</b>
                                            {{ new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(r.valor_peajes) }}
                                        </span>
                                    </div>
                                    <template v-if="r.distancia_m == null && r.duracion_s == null && r.numero_peajes == null">
                                        <div class="text-gray-500 text-sm mt-1">Sin métricas calculadas</div>
                                    </template>
                                </div>
                                <Button icon="pi pi-times" text severity="danger" @click="removeDraftRoute(routesDraft.indexOf(r))" />
                            </div>

                            <!-- Mostrar mapa y peajes si la ruta ya existe -->
                            <RouteMiniMap v-if="r.id" :ruta="r" />
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
        <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true" appendTo="body">
            <div>
                ¿Seguro que quieres eliminar la programación <b>Id:{{ current?.id }}</b> — <b>{{ current?.nombrePractica }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Confirmar eliminar en bloque -->
        <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminación múltiple" :style="{ width: '28rem' }" :modal="true" appendTo="body">
            <div>
                ¿Seguro que deseas eliminar las <b>{{ selected.length }}</b> programaciones seleccionadas?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
            </template>
        </Dialog>

        <!-- Diálogo de rechazo de programación -->
        <Dialog v-model:visible="rejectDialog" header="Rechazar programación" :style="{ width: '30rem' }" :modal="true" appendTo="body">
            <div v-if="rejectTarget">
                <p class="mb-3">
                    Vas a rechazar la programación
                    <b>Id: {{ rejectTarget.row.id }}</b>
                    — <b>{{ rejectTarget.row.nombrePractica }}</b>
                </p>

                <div class="flex flex-col gap-2">
                    <label for="reject-just" class="font-medium">Justificación</label>
                    <Textarea id="reject-just" v-model.trim="rejectJustificacion" rows="4" autoResize :class="{ 'p-invalid': !!rejectError }" />
                    <small v-if="rejectError" class="text-red-500">{{ rejectError }}</small>
                </div>
            </div>

            <template #footer>
                <Button label="Cancelar" icon="pi pi-times" text :disabled="rejectLoading" @click="closeRejectDialog" />
                <Button label="Rechazar" icon="pi pi-check" severity="danger" :loading="rejectLoading" :disabled="rejectLoading" @click="confirmReject" />
            </template>
        </Dialog>

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de programación" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '720px' }">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>

            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                    <div class="font-semibold mb-3 break-words">Id: {{ d.id }} — {{ d.nombrePractica }}</div>
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
                            <div>
                                <dt class="text-sm font-semibold">N.º estudiantes</dt>
                                <dd>{{ d.numeroEstudiantes }}</dd>
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
                    <div v-if="d.routes?.length" class="mt-5">
                        <div class="font-semibold mb-2">Recorridos ({{ d.routes.length }})</div>

                        <div v-for="(r, i) in d.routes" :key="r.id ?? i" class="border border-surface-300 bg-surface-50 rounded-md p-3 mb-3 text-sm">
                            <div><b>Justificación:</b> {{ r.justificacion || '—' }}</div>

                            <div v-if="r.distancia_m != null || r.duracion_s != null || r.numero_peajes != null" class="mt-1 flex flex-wrap gap-x-4 text-gray-800">
                                <span v-if="r.distancia_m != null"> <b>Distancia:</b> {{ fmtKm(r.distancia_m) }} </span>
                                <span v-if="r.duracion_s != null"> <b>Duración:</b> {{ fmtMin(r.duracion_s) }} </span>
                                <span v-if="r.numero_peajes != null"> <b>Peajes:</b> {{ r.numero_peajes }} </span>
                                <span v-if="r.valor_peajes != null && r.valor_peajes > 0">
                                    <b>Valor total:</b>
                                    {{ new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(r.valor_peajes) }}
                                </span>
                            </div>

                            <div v-else class="text-gray-500 text-xs mt-1">Sin métricas calculadas</div>
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

                    <!-- Estados -->
                    <div class="mt-4 space-y-3">
                        <!-- PREGRADO -->
                        <template v-if="nivelPractica(d) === 'pregrado'">
                            <div>
                                <div class="text-sm font-semibold">Estado Jefe Departamento</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoDepart }}</div>
                            </div>
                            <div>
                                <div class="text-sm font-semibold">Estado Decano</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoDecano }}</div>
                            </div>
                            <div>
                                <div class="text-sm font-semibold">Estado Vicerrectoría</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoVice }}</div>
                            </div>
                        </template>

                        <!-- POSTGRADO-->
                        <template v-else-if="nivelPractica(d) === 'postgrado'">
                            <div>
                                <div class="text-sm font-semibold">Estado Coordinador Postgrados</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoPostg }}</div>
                            </div>
                            <div>
                                <div class="text-sm font-semibold">Estado Jefe Postgrados</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoJefePostg }}</div>
                            </div>
                            <div>
                                <div class="text-sm font-semibold">Estado Vicerrectoría</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoVice }}</div>
                            </div>
                        </template>

                        <template v-else>
                            <div>
                                <div class="text-sm font-semibold">Estado Vicerrectoría</div>
                                <div class="whitespace-pre-line break-words">{{ d.estadoVice }}</div>
                            </div>
                        </template>
                    </div>

                    <!-- Auditoria -->
                    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                            <div class="font-semibold">Creado</div>
                            <div>{{ d.fechacreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">Modificado</div>
                            <div>{{ d.fechamodificacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">IP Creación</div>
                            <div>{{ d.ipcreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">IP Modificación</div>
                            <div>{{ d.ipmodificacion }}</div>
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
