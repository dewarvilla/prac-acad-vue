<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Tabla base
// -------------------------
const tableUid = `cre-${Math.random().toString(36).slice(2)}`;
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const allSelected = computed(() => selected.value.length > 0 && selected.value.length === products.value.length);
const someSelected = computed(() => selected.value.length > 0 && selected.value.length < products.value.length);

function toggleAll(e) {
    if (e.checked) selected.value = [...products.value];
    else selected.value = [];
}

const page = ref(1);
const rows = ref(10);
const total = ref(0);
const sortField = ref('nombrePractica');
const sortOrder = ref(1);

// -------------------------
// Permisos de CRUD
// -------------------------
const canViewCreaciones = computed(() => hasPerm('creaciones.view'));
const canCreateCreaciones = computed(() => hasPerm('creaciones.create'));
const canEditCreaciones = computed(() => hasPerm('creaciones.edit'));
const canDeleteCreaciones = computed(() => hasPerm('creaciones.delete'));

// -------------------------
// Restricción UI: editar/eliminar
// -------------------------
const isRejected = (row) => {
    const st = row?.estado_creacion ?? row?.estadoCreacion ?? '';
    return String(st).trim().toLowerCase() === 'rechazada';
};

const canEditRow = (row) => row?.can_edit === true;
const canDeleteRow = (row) => row?.can_delete === true;
const canBulkDelete = computed(() => selected.value.length > 0 && selected.value.every((row) => row?.can_delete === true));

const canAccessModule = computed(() => canViewCreaciones.value);

// -------------------------
// Endpoints
// -------------------------
const API_CRE = '/creaciones';

const API_ACA_FACULTADES = '/academusoft/facultades';
const API_ACA_PROGRAMAS = '/academusoft/programas';
const API_ACA_MATERIAS = '/academusoft/materias';

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// IDs únicos form
// -------------------------
const uid = Math.random().toString(36).slice(2);
const facId = `facultad-${uid}`;
const recId = `recursosNecesarios-${uid}`;
const jusId = `justificacion-${uid}`;

// -------------------------
// Utils
// -------------------------
const s = (v) => (v == null ? '' : String(v));

function extractErrorMessage(data, fallback) {
    return data?.message || data?.error?.detail || data?.error || fallback;
}

function formatDateTime(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return s(value);

    return new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function unwrapApiPayload(responseData) {
    return responseData?.data ?? responseData ?? {};
}

function unwrapCollection(responseData) {
    const payload = unwrapApiPayload(responseData);

    if (Array.isArray(payload)) {
        return { items: payload, meta: {} };
    }

    if (Array.isArray(payload?.data)) {
        return { items: payload.data, meta: payload.meta ?? {} };
    }

    if (Array.isArray(payload?.data?.items)) {
        return { items: payload.data.items, meta: payload.meta ?? payload.data.meta ?? {} };
    }

    if (Array.isArray(payload?.items)) {
        return { items: payload.items, meta: payload.meta ?? {} };
    }

    return { items: [], meta: payload?.meta ?? {} };
}

// -------------------------
// Normalización dominio
// -------------------------
function getFacultadFromRow(row) {
    const f = row?.facultadObj ?? row?.facultad_obj ?? row?.facultad ?? null;

    const codigoFacultad = f?.codigoFacultad ?? row?.codigoFacultad ?? row?.codigo_facultad ?? row?.facultadCodigo ?? null;
    const nombreFacultad = typeof f === 'object' ? (f?.nombreFacultad ?? f?.facultad ?? f?.nombre ?? null) : (row?.facultadNombre ?? row?.facultad ?? null);

    if (!codigoFacultad && !nombreFacultad) return null;

    return {
        codigoFacultad: s(codigoFacultad).trim(),
        nombreFacultad: s(nombreFacultad).trim(),
        label: `${s(codigoFacultad).trim()} - ${s(nombreFacultad).trim()}`.replace(/^ - /, '').trim()
    };
}

function getProgramaFromRow(row) {
    const p = row?.programa ?? row?.programa_obj ?? null;

    const codigoPrograma = p?.codigoPrograma ?? row?.codigoPrograma ?? row?.codigo_programa ?? row?.programaCodigo ?? null;
    const nombrePrograma = p?.nombrePrograma ?? row?.nombrePrograma ?? row?.nombre_programa ?? row?.programaNombre ?? null;
    const codigoFacultad = p?.codigoFacultad ?? row?.codigoFacultad ?? row?.codigo_facultad ?? null;
    const facultad = p?.facultad ?? row?.facultad ?? null;
    const nivelAcademico = p?.nivelAcademico ?? row?.nivelAcademico ?? row?.nivel_academico ?? null;

    if (!codigoPrograma && !nombrePrograma) return null;

    return {
        codigoPrograma: s(codigoPrograma).trim(),
        nombrePrograma: s(nombrePrograma).trim(),
        codigoFacultad: s(codigoFacultad).trim(),
        facultad: s(facultad).trim(),
        nivelAcademico: s(nivelAcademico).trim(),
        label: `${s(codigoPrograma).trim()} - ${s(nombrePrograma).trim()}`.trim()
    };
}

function getMateriaFromRow(row) {
    const m = row?.materia ?? row?.materia_obj ?? null;

    const codigoMateria = m?.codigoMateria ?? row?.codigoMateria ?? row?.codigo_materia ?? row?.materiaCodigo ?? null;
    const nombreMateria = m?.nombreMateria ?? row?.nombreMateria ?? row?.nombre_materia ?? row?.materiaNombre ?? null;
    const codigoPrograma = m?.codigoPrograma ?? row?.codigoPrograma ?? row?.codigo_programa ?? null;

    if (!codigoMateria && !nombreMateria) return null;

    return {
        codigoPrograma: s(codigoPrograma).trim(),
        codigoMateria: s(codigoMateria).trim(),
        nombreMateria: s(nombreMateria).trim(),
        label: `${s(codigoMateria).trim()} - ${s(nombreMateria).trim()}`.trim()
    };
}

function facultadRowLabel(row) {
    const f = getFacultadFromRow(row);
    if (!f) return '—';
    return f.label || f.nombreFacultad || f.codigoFacultad || '—';
}

function programaRowLabel(row) {
    const p = getProgramaFromRow(row);
    if (!p) return '—';
    return p.label || p.nombrePrograma || p.codigoPrograma || '—';
}

function materiaRowLabel(row) {
    const m = getMateriaFromRow(row);
    if (!m) return '—';
    return m.label || m.nombreMateria || m.codigoMateria || '—';
}

// -------------------------
// Facultad (Autocomplete)
// -------------------------
const selectedFacultad = ref(null);
const facSugs = ref([]);
const facCache = ref([]);
const facLoaded = ref(false);
const loadingFacs = ref(false);

function normalizeFacultadOption(f) {
    const codigoFacultad = s(f?.codigo_facultad ?? f?.codigoFacultad ?? f?.unid_id).trim();
    const nombreFacultad = s(f?.facultad ?? f?.nombre_facultad ?? f?.nombreFacultad ?? f?.unid_nombre).trim();

    if (!codigoFacultad && !nombreFacultad) return null;

    return {
        codigoFacultad,
        nombreFacultad,
        label: `${codigoFacultad} - ${nombreFacultad}`.replace(/^ - /, '').trim()
    };
}

function filterFacultadesLocal(query = '') {
    const q = s(query).trim().toLowerCase();

    facSugs.value = facCache.value.filter((item) => {
        if (!q) return true;

        return item.codigoFacultad.toLowerCase().includes(q) || item.nombreFacultad.toLowerCase().includes(q) || item.label.toLowerCase().includes(q);
    });
}

async function fetchFacultades() {
    loadingFacs.value = true;

    try {
        const response = await api.get(API_ACA_FACULTADES);
        const { items } = unwrapCollection(response.data);

        facCache.value = items.map(normalizeFacultadOption).filter(Boolean);
        facLoaded.value = true;
        filterFacultadesLocal();
    } catch (e) {
        facCache.value = [];
        facSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Facultades',
            detail: extractErrorMessage(e?.response?.data, e.message),
            life: 4000
        });
    } finally {
        loadingFacs.value = false;
    }
}

async function ensureFacultadesLoaded() {
    if (facLoaded.value) {
        filterFacultadesLocal();
        return;
    }

    await fetchFacultades();
}

async function searchFacultades(event) {
    const q = s(event?.query).trim();
    await ensureFacultadesLoaded();
    filterFacultadesLocal(q);
}

function selectFacultad(it) {
    product.value.facultad = it;
    selectedFacultad.value = it;

    product.value.programa = null;
    programaQuery.value = '';
    progSugs.value = [];
    highlightedProgIndex.value = -1;

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.facultad = true;
    validateField('facultad');
    if (touched.programa) validateField('programa');
    if (touched.materia) validateField('materia');
}

function clearFacultad() {
    selectedFacultad.value = null;
    filterFacultadesLocal();

    product.value.facultad = null;

    product.value.programa = null;
    programaQuery.value = '';
    progSugs.value = [];
    highlightedProgIndex.value = -1;

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.facultad = true;
    validateField('facultad');
    if (touched.programa) validateField('programa');
    if (touched.materia) validateField('materia');
}

function onFacultadSelect(event) {
    if (event?.value) {
        selectFacultad(event.value);
    }
}

function onFacultadFocus() {
    ensureFacultadesLoaded();
}

// -------------------------
// Programa (Autocomplete)
// -------------------------
const programaQuery = ref('');
const progSugs = ref([]);
const loadingProgs = ref(false);
const showProgPanel = ref(false);
const highlightedProgIndex = ref(-1);
const hoveredProgIndex = ref(-1);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function openProgPanel() {
    closeMatPanel();
    showProgPanel.value = true;
}

function closeProgPanel() {
    showProgPanel.value = false;
    highlightedProgIndex.value = -1;
    hoveredProgIndex.value = -1;
}

async function fetchProgramas(query = '') {
    loadingProgs.value = true;

    try {
        const params = {};
        const q = s(query).trim();
        const codigoFacultad = product.value.facultad?.codigoFacultad ?? null;

        if (q) params.q = q;
        if (codigoFacultad) params.codigo_facultad = codigoFacultad;

        const response = await api.get(API_ACA_PROGRAMAS, { params });
        const { items } = unwrapCollection(response.data);

        progSugs.value = items
            .map((p) => ({
                codigoPrograma: s(p?.codigo_programa ?? p?.codigoPrograma).trim(),
                nombrePrograma: s(p?.nombre_programa ?? p?.nombrePrograma).trim(),
                nivelAcademico: s(p?.nivel_academico ?? p?.nivelAcademico).trim(),
                facultad: s(p?.facultad ?? p?.nombre_facultad ?? p?.nombreFacultad).trim(),
                codigoFacultad: s(p?.codigo_facultad ?? p?.codigoFacultad).trim()
            }))
            .map((p) => ({
                ...p,
                label: `${p.codigoPrograma} - ${p.nombrePrograma}`.trim()
            }));
    } catch (e) {
        progSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Programas',
            detail: extractErrorMessage(e?.response?.data, e.message),
            life: 4000
        });
    } finally {
        loadingProgs.value = false;
    }
}

function onProgramaInput() {
    const q = s(programaQuery.value).trim();
    showProgPanel.value = true;

    const currentLabel = s(product.value.programa?.label || product.value.programa?.nombrePrograma || '').trim();

    if (product.value.programa && q !== currentLabel) {
        product.value.programa = null;

        product.value.materia = null;
        materiaQuery.value = '';
        matSugs.value = [];
        highlightedMatIndex.value = -1;

        if (touched.programa) validateField('programa');
        if (touched.materia) validateField('materia');
    }

    if (progTimer) clearTimeout(progTimer);

    progTimer = setTimeout(() => {
        if (!q.length) {
            progSugs.value = [];
            highlightedProgIndex.value = -1;
            return;
        }
        fetchProgramas(q);
    }, PROG_DEBOUNCE);
}

function onProgramaKeydown(e) {
    if (!showProgPanel.value || !progSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedProgIndex.value = highlightedProgIndex.value < progSugs.value.length - 1 ? highlightedProgIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedProgIndex.value = highlightedProgIndex.value > 0 ? highlightedProgIndex.value - 1 : progSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedProgIndex.value >= 0) {
            selectPrograma(progSugs.value[highlightedProgIndex.value]);
        } else {
            touched.programa = true;
            validateField('programa');
            closeProgPanel();
        }
    }
}

function selectPrograma(it) {
    product.value.programa = it;
    programaQuery.value = it.label || it.nombrePrograma || '';

    if (!product.value.facultad || s(product.value.facultad?.codigoFacultad) !== s(it.codigoFacultad)) {
        product.value.facultad = {
            codigoFacultad: s(it.codigoFacultad).trim(),
            nombreFacultad: s(it.facultad).trim(),
            label: `${s(it.codigoFacultad).trim()} - ${s(it.facultad).trim()}`.replace(/^ - /, '').trim()
        };
        selectedFacultad.value = product.value.facultad;
    }

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.programa = true;
    validateField('programa');
    if (touched.facultad) validateField('facultad');
    if (touched.materia) validateField('materia');

    closeProgPanel();
}

function clearPrograma() {
    programaQuery.value = '';
    progSugs.value = [];
    highlightedProgIndex.value = -1;

    product.value.programa = null;

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.programa = true;
    validateField('programa');
    if (touched.materia) validateField('materia');

    closeProgPanel();
}

// -------------------------
// Materia (Autocomplete)
// -------------------------
const materiaQuery = ref('');
const matSugs = ref([]);
const loadingMats = ref(false);
const showMatPanel = ref(false);
const highlightedMatIndex = ref(-1);
const hoveredMatIndex = ref(-1);
let matTimer = null;
const MAT_DEBOUNCE = 250;

function openMatPanel() {
    closeProgPanel();
    showMatPanel.value = true;
}

function closeMatPanel() {
    showMatPanel.value = false;
    highlightedMatIndex.value = -1;
    hoveredMatIndex.value = -1;
}

async function fetchMaterias(query = '') {
    loadingMats.value = true;

    try {
        const prog = product.value.programa;
        const codigoPrograma = prog?.codigoPrograma;

        if (!codigoPrograma) {
            matSugs.value = [];
            return;
        }

        const params = { codigo_programa: codigoPrograma };
        const q = s(query).trim();

        if (q) params.q = q;

        const response = await api.get(API_ACA_MATERIAS, { params });
        const { items } = unwrapCollection(response.data);

        matSugs.value = items
            .map((m) => ({
                codigoPrograma: s(m?.codigo_programa ?? m?.codigoPrograma ?? codigoPrograma).trim(),
                codigoMateria: s(m?.codigo_materia ?? m?.codigoMateria).trim(),
                nombreMateria: s(m?.nombre_materia ?? m?.nombreMateria).trim()
            }))
            .map((m) => ({
                ...m,
                label: `${m.codigoMateria} - ${m.nombreMateria}`.trim()
            }));
    } catch (e) {
        matSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Materias',
            detail: extractErrorMessage(e?.response?.data, e.message),
            life: 4000
        });
    } finally {
        loadingMats.value = false;
    }
}

function onMateriaInput() {
    const q = s(materiaQuery.value).trim();
    showMatPanel.value = true;

    if (!product.value.programa?.codigoPrograma) {
        matSugs.value = [];
        highlightedMatIndex.value = -1;
        return;
    }

    const currentLabel = s(product.value.materia?.label || '').trim();

    if (product.value.materia && q !== currentLabel) {
        product.value.materia = null;
        if (touched.materia) validateField('materia');
    }

    if (matTimer) clearTimeout(matTimer);

    matTimer = setTimeout(() => {
        if (!q.length) {
            matSugs.value = [];
            highlightedMatIndex.value = -1;
            return;
        }
        fetchMaterias(q);
    }, MAT_DEBOUNCE);
}

function onMateriaKeydown(e) {
    if (!showMatPanel.value || !matSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedMatIndex.value = highlightedMatIndex.value < matSugs.value.length - 1 ? highlightedMatIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedMatIndex.value = highlightedMatIndex.value > 0 ? highlightedMatIndex.value - 1 : matSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedMatIndex.value >= 0) {
            selectMateria(matSugs.value[highlightedMatIndex.value]);
        } else {
            touched.materia = true;
            validateField('materia');
            closeMatPanel();
        }
    }
}

function selectMateria(it) {
    product.value.materia = it;
    materiaQuery.value = it.label || it.nombreMateria || '';

    touched.materia = true;
    validateField('materia');

    closeMatPanel();
}

function clearMateria() {
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    product.value.materia = null;

    touched.materia = true;
    validateField('materia');

    closeMatPanel();
}

// -------------------------
// Helpers estado
// -------------------------
function estadoLabel(estado) {
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

    const map = {
        en_aprobacion: 'En aprobación',
        aprobada: 'Aprobada',
        rechazada: 'Rechazada',
        creada: 'Creada',
        pending: 'En aprobación',
        approved: 'Aprobada',
        rejected: 'Rechazada',
        cancelled: 'Cancelada',
        cancelada: 'Cancelada'
    };

    if (map[st]) return map[st];

    const pretty = st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return pretty || '—';
}

function estadoSeverity(estado) {
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

    if (st === 'aprobada' || st === 'approved') return 'success';
    if (st === 'rechazada' || st === 'rejected') return 'danger';
    if (st === 'en_aprobacion' || st === 'pending') return 'warn';

    return 'info';
}

// -------------------------
// Parametrización
// -------------------------
const SORT_MAP_CRE = {
    id: 'id',
    nombrePractica: 'nombre_practica',
    estadoCreacion: 'estado_creacion',
    estado: 'estado',
    codigoFacultad: 'codigo_facultad',
    codigoPrograma: 'codigo_programa',
    codigoMateria: 'codigo_materia',
    createdAt: 'fechacreacion',
    updatedAt: 'fechamodificacion'
};

function mapSort(uiField, order, map) {
    if (!uiField) return undefined;
    const apiField = map[uiField];
    if (!apiField) return undefined;
    return `${order === -1 ? '-' : ''}${apiField}`;
}

function compareValues(a, b, order = 1) {
    const av = a == null ? '' : String(a).toLowerCase();
    const bv = b == null ? '' : String(b).toLowerCase();

    if (av < bv) return -1 * order;
    if (av > bv) return 1 * order;
    return 0;
}

function sortInboxItems(items) {
    const field = sortField.value;
    const order = sortOrder.value === -1 ? -1 : 1;
    const sorted = [...items];

    sorted.sort((a, b) => {
        switch (field) {
            case 'nombrePractica':
                return compareValues(a.nombrePractica ?? a.nombre_practica, b.nombrePractica ?? b.nombre_practica, order);
            case 'codigoFacultad':
                return compareValues(a.codigoFacultad, b.codigoFacultad, order);
            case 'codigoPrograma':
                return compareValues(a.codigoPrograma, b.codigoPrograma, order);
            case 'codigoMateria':
                return compareValues(a.codigoMateria, b.codigoMateria, order);
            case 'estadoCreacion':
                return compareValues(a.estadoCreacion ?? a.estado_creacion, b.estadoCreacion ?? b.estado_creacion, order);
            case 'id':
                return compareValues(a.id, b.id, order);
            case 'createdAt':
                return compareValues(a.createdAt ?? a.created_at ?? a.fechacreacion, b.createdAt ?? b.created_at ?? b.fechacreacion, order);
            case 'updatedAt':
                return compareValues(a.updatedAt ?? a.updated_at ?? a.fechamodificacion, b.updatedAt ?? b.updated_at ?? b.fechamodificacion, order);
            default:
                return 0;
        }
    });

    return sorted;
}

const sortParamCre = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_CRE));
function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = sortParamCre.value;
    if (sp) params.sort = sp;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

// -------------------------
// Fetch principal
// -------------------------
async function getProducts(opts = {}) {
    const { signal, force = false } = opts;

    if (!canAccessModule.value) {
        products.value = [];
        total.value = 0;
        return;
    }

    loading.value = true;

    try {
        const response = await api.get(API_CRE, { params: buildParams({ force }), signal });
        const { items, meta } = unwrapCollection(response.data);
        products.value = items;
        total.value = Number(meta?.total ?? items.length);

        if (meta?.current_page) page.value = Number(meta.current_page);
        if (meta?.per_page) rows.value = Number(meta.per_page);
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';

        if (!canceled) {
            const status = e?.response?.status;
            const msg = extractErrorMessage(e?.response?.data, e.message);

            toast.add({
                severity: 'error',
                summary: 'Error al cargar',
                detail: `[${status ?? 'ERR'}] ${msg}`,
                life: 6500
            });

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

// -------------------------
// CRUD + detalles
// -------------------------
const productDialog = ref(false);
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;

    detailsLoading.value = true;
    details.value = [];

    try {
        const reqs = selected.value.map((r) => api.get(`${API_CRE}/${r.id}`));
        const results = await Promise.allSettled(reqs);

        details.value = results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => unwrapApiPayload(r.value.data))
            .filter(Boolean);
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

const product = ref({
    id: null,
    facultad: null,
    programa: null,
    materia: null,
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: '',
    comentarioRechazo: '',
    rolRechazoLabel: '',
    fechaRechazo: null
});

const errors = reactive({
    facultad: '',
    programa: '',
    materia: '',
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});

const touched = reactive({
    facultad: false,
    programa: false,
    materia: false,
    nombrePractica: false,
    recursosNecesarios: false,
    justificacion: false
});

const rules = {
    facultad: [(v) => !!v?.codigoFacultad || 'Requerido.'],
    programa: [(v) => !!v?.codigoPrograma || 'Requerido.'],
    materia: [(v) => !!v?.codigoMateria || 'Requerido.'],
    nombrePractica: [(v) => !!s(v).trim() || 'Requerido.'],
    recursosNecesarios: [(v) => !!s(v).trim() || 'Requerido.'],
    justificacion: [(v) => !!s(v).trim() || 'Requerido.']
};

function resetValidation() {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));
}

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

function openNew() {
    product.value = {
        id: null,
        facultad: null,
        programa: null,
        materia: null,
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: '',
        comentarioRechazo: '',
        rolRechazoLabel: '',
        fechaRechazo: null
    };

    selectedFacultad.value = null;
    facSugs.value = [];

    programaQuery.value = '';
    progSugs.value = [];
    closeProgPanel();

    materiaQuery.value = '';
    matSugs.value = [];
    closeMatPanel();

    resetValidation();
    productDialog.value = true;
}

function editProduct(row) {
    const fac =
        getFacultadFromRow(row) ||
        (() => {
            const p = getProgramaFromRow(row);
            if (!p?.codigoFacultad && !p?.facultad) return null;
            return {
                codigoFacultad: s(p?.codigoFacultad).trim(),
                nombreFacultad: s(p?.facultad).trim(),
                label: `${s(p?.codigoFacultad).trim()} - ${s(p?.facultad).trim()}`.replace(/^ - /, '').trim()
            };
        })();

    const prog = getProgramaFromRow(row);
    const mat = getMateriaFromRow(row);

    product.value = {
        id: row.id ?? null,
        facultad: fac,
        programa: prog,
        materia: mat,
        nombrePractica: row.nombrePractica ?? row.nombre_practica ?? '',
        recursosNecesarios: row.recursosNecesarios ?? row.recursos_necesarios ?? '',
        justificacion: row.justificacion ?? '',
        comentarioRechazo: row.comentarioRechazo ?? row.comentario_rechazo ?? '',
        rolRechazoLabel: row.rolRechazoLabel ?? row.rol_rechazo_label ?? '',
        fechaRechazo: row.fechaRechazo ?? row.fecha_rechazo ?? null
    };

    selectedFacultad.value = fac;
    facSugs.value = [];

    programaQuery.value = prog ? prog.label || prog.nombrePrograma || '' : '';
    progSugs.value = [];
    closeProgPanel();

    materiaQuery.value = mat ? mat.label || mat.nombreMateria || '' : '';
    matSugs.value = [];
    closeMatPanel();

    resetValidation();
    productDialog.value = true;
}

const saving = ref(false);

function flattenValidationErrors(errs) {
    if (!errs || typeof errs !== 'object') return [];
    return Object.values(errs).flat().filter(Boolean);
}

function summarizeValidationErrors(errs) {
    const msgs = flattenValidationErrors(errs);
    if (!msgs.length) return null;
    const first = msgs[0];
    const more = msgs.length - 1;
    return more > 0 ? `${first} (y ${more} más)` : first;
}

const SERVER_TO_FORM = {
    codigo_facultad: 'facultad',
    codigo_programa: 'programa',
    codigo_materia: 'materia',
    nombre_practica: 'nombrePractica',
    recursos_necesarios: 'recursosNecesarios',
    justificacion: 'justificacion'
};

function applyServerFieldErrors(serverErrors) {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));

    if (!serverErrors) return;

    for (const [serverKey, msgs] of Object.entries(serverErrors)) {
        const formKey = SERVER_TO_FORM[serverKey];
        if (!formKey) continue;
        errors[formKey] = Array.isArray(msgs) ? (msgs[0] ?? '') : String(msgs ?? '');
        touched[formKey] = true;
    }
}

// -------------------------
// Confirmación antes de guardar
// -------------------------
const confirmSaveDialog = ref(false);
const pendingSaveAction = ref(null);
const pendingSavePayload = ref(null);

function openConfirmSave(action, payload) {
    pendingSaveAction.value = action;
    pendingSavePayload.value = payload;
    confirmSaveDialog.value = true;
}

function closeConfirmSave() {
    confirmSaveDialog.value = false;
    pendingSaveAction.value = null;
    pendingSavePayload.value = null;
}

async function confirmSave() {
    const action = pendingSaveAction.value;
    const payload = pendingSavePayload.value;

    if (!action || !payload) {
        closeConfirmSave();
        return;
    }

    try {
        saving.value = true;

        if (action === 'edit') {
            await api.patch(`${API_CRE}/${product.value.id}`, payload);
            toast.add({
                severity: 'success',
                summary: 'Actualizado',
                detail: 'La práctica fue actualizada y volvió a aprobación.',
                life: 3500
            });
        } else {
            await api.post(API_CRE, payload);
            toast.add({
                severity: 'success',
                summary: 'Creado',
                detail: 'La práctica fue creada y enviada a aprobación.',
                life: 3500
            });
        }

        productDialog.value = false;
        closeConfirmSave();
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            const detail = summarizeValidationErrors(data?.errors) || extractErrorMessage(data, 'Los datos enviados son inválidos.');
            toast.add({
                severity: 'warn',
                summary: 'No se pudo guardar',
                detail,
                life: 6500
            });
            closeConfirmSave();
            return;
        }

        const msg = extractErrorMessage(data, e.message);

        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'Conflicto' : 'No se pudo guardar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6500
        });

        closeConfirmSave();
    } finally {
        saving.value = false;
    }
}

async function saveProduct() {
    if (saving.value) return;

    const fields = ['facultad', 'programa', 'materia', 'nombrePractica', 'recursosNecesarios', 'justificacion'];

    fields.forEach((f) => {
        touched[f] = true;
        validateField(f);
    });

    const ok = fields.every((f) => !errors[f]);

    if (!ok) {
        toast.add({
            severity: 'warn',
            summary: 'No se pudo guardar',
            detail: 'Revisa los campos obligatorios.',
            life: 4500
        });
        return;
    }

    const payload = {
        codigo_facultad: product.value.facultad?.codigoFacultad ?? product.value.programa?.codigoFacultad ?? null,
        codigo_programa: product.value.programa?.codigoPrograma ?? null,
        codigo_materia: product.value.materia?.codigoMateria ?? null,
        nombre_practica: s(product.value.nombrePractica).trim(),
        recursos_necesarios: s(product.value.recursosNecesarios).trim(),
        justificacion: s(product.value.justificacion).trim()
    };

    const action = product.value.id ? 'edit' : 'create';
    openConfirmSave(action, payload);
}

// -------------------------
// Delete individual + bulk
// -------------------------
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    try {
        await api.delete(`${API_CRE}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'No se pudo eliminar',
            detail: String(extractErrorMessage(e?.response?.data, e.message)),
            life: 5000
        });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!canBulkDelete.value) {
        toast.add({
            severity: 'warn',
            summary: 'No se puede eliminar',
            detail: 'Solo puedes eliminar creaciones en estado "rechazada".',
            life: 4500
        });
        return;
    }
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);

    try {
        await api.post(`${API_CRE}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({
            severity: 'success',
            summary: `Eliminados (${ids.length})`,
            life: 2500
        });

        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = extractErrorMessage(e?.response?.data, e.message);

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

// -------------------------
// UX / teclado
// -------------------------
function onFormKeyCapture(e) {
    if (e.key !== ' ') return;

    const t = e.target;
    const tag = (t.tagName || '').toUpperCase();
    const type = (t.type || '').toLowerCase();

    const isTextInput = tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
    const isEditable = isTextInput || tag === 'TEXTAREA' || t.isContentEditable;

    if (isEditable) return;
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) return;

    e.preventDefault();
    e.stopPropagation();
}

function onSaveBtnKeydown(e) {
    if (e.key === ' ') e.preventDefault();
}

onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (progTimer) clearTimeout(progTimer);
    if (matTimer) clearTimeout(matTimer);
});

onMounted(async () => {
    await getProducts();
});
</script>

<template>
    <div class="card">
        <Toast />

        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Creaciones</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0 flex-wrap">
                        <Button v-if="canCreateCreaciones" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canDeleteCreaciones" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
                        <Button label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
                    </div>
                </template>

                <template #center />

                <template #end>
                    <div class="flex items-center gap-3 w-full justify-end">
                        <form role="search" class="min-w-0 w-full sm:w-80 md:w-[26rem]" @submit.prevent="forceFetch">
                            <IconField class="w-full p-input-icon-left relative">
                                <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                                <InputText
                                    id="creSearch"
                                    name="creSearch"
                                    v-model.trim="search"
                                    role="searchbox"
                                    placeholder="Escribe para buscar..."
                                    class="w-full h-10 leading-10 pr-8"
                                    autocomplete="off"
                                    @keydown.enter.prevent="forceFetch"
                                    @keydown.esc.prevent="clearSearch"
                                />
                                <button v-if="search" type="button" class="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Limpiar búsqueda" @click="clearSearch">X</button>
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
                :rowsPerPageOptions="[5, 10, 25, 50, 100]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
                responsiveLayout="scroll"
                :scrollable="true"
                tableStyle="width: 100%; min-width: 1200px;"
            >
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

                <Column field="nombrePractica" header="Práctica" sortable style="min-width: 20rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap font-medium" v-tooltip.top="data.nombrePractica ?? data.nombre_practica ?? 'Sin nombre'">
                            {{ data.nombrePractica ?? data.nombre_practica ?? '—' }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoFacultad" header="Facultad" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="facultadRowLabel(data)">
                            {{ facultadRowLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoPrograma" header="Programa" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="programaRowLabel(data)">
                            {{ programaRowLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoMateria" header="Materia" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="materiaRowLabel(data)">
                            {{ materiaRowLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="estadoCreacion" header="Estado" sortable style="width: 12rem; max-width: 12rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estadoCreacion ?? data.estado_creacion ?? data.approvalStatus)" :severity="estadoSeverity(data.estadoCreacion ?? data.estado_creacion ?? data.approvalStatus)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:13rem">
                    <template #body="{ data }">
                        <Button v-if="canEditRow(data)" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteRow(data)" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <Dialog v-model:visible="productDialog" :header="product.id ? 'Editar creación' : 'Crear creación'" :style="{ width: '56rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="grid">
                        <div class="col-12 md:col-4">
                            <label :for="facId" class="block font-semibold mb-2">Facultad <span class="text-red-500">*</span></label>
                            <IconField class="w-full p-input-icon-left relative">
                                <InputIcon class="pi pi-search z-2" />
                                <AutoComplete
                                    :id="facId"
                                    v-model="selectedFacultad"
                                    :suggestions="facSugs"
                                    optionLabel="label"
                                    forceSelection
                                    completeOnFocus
                                    showClear
                                    class="w-full facultad-autocomplete"
                                    inputClass="w-full"
                                    placeholder="Escribe para buscar..."
                                    :invalid="showError('facultad')"
                                    :loading="loadingFacs"
                                    @complete="searchFacultades"
                                    @item-select="onFacultadSelect"
                                    @clear="clearFacultad"
                                    @focus="onFacultadFocus"
                                    @blur="onBlur('facultad')"
                                >
                                    <template #option="{ option }">
                                        <div class="flex flex-column gap-1 py-2">
                                            <div class="font-medium line-height-3">{{ option.nombreFacultad || option.label }}</div>
                                            <small class="text-color-secondary">{{ option.codigoFacultad || 'Sin código' }}</small>
                                        </div>
                                    </template>
                                </AutoComplete>
                            </IconField>

                            <small v-if="showError('facultad')" class="text-red-500">
                                {{ errors.facultad }}
                            </small>
                        </div>

                        <div class="col-12 md:col-4">
                            <label class="block font-semibold mb-2">Programa <span class="text-red-500">*</span></label>
                            <div class="relative" :class="{ 'pb-18rem': showProgPanel && progSugs.length, 'pb-4': showProgPanel && !progSugs.length, 'z-10': showProgPanel }">
                                <IconField class="w-full p-input-icon-left relative">
                                    <InputIcon class="pi pi-search z-2" />
                                    <InputText
                                        v-model="programaQuery"
                                        class="w-full selector-search-input"
                                        placeholder="Escribe para buscar..."
                                        :disabled="!product.facultad?.codigoFacultad"
                                        :invalid="showError('programa')"
                                        autocomplete="off"
                                        @focus="openProgPanel"
                                        @input="onProgramaInput"
                                        @keydown="onProgramaKeydown"
                                        @blur="onBlur('programa')"
                                    />
                                    <button
                                        v-if="product.programa"
                                        type="button"
                                        class="selector-search-action"
                                        aria-label="Limpiar programa"
                                        @click="clearPrograma"
                                    >
                                        <i class="pi pi-times" />
                                    </button>
                                    <span v-else-if="loadingProgs" class="selector-search-action text-color-secondary" aria-hidden="true">
                                        <i class="pi pi-spin pi-spinner" />
                                    </span>
                                </IconField>

                                <div v-if="showProgPanel" class="selector-panel absolute left-0 top-full z-30 surface-overlay border-1 border-300 border-round shadow-3 mt-2 w-full max-h-18rem overflow-auto">
                                    <div v-if="loadingProgs" class="p-3 text-sm text-color-secondary">Cargando…</div>

                                    <template v-else-if="progSugs.length">
                                        <div
                                            v-for="(item, idx) in progSugs"
                                            :key="`${item.codigoPrograma}-${idx}`"
                                            class="selector-option p-3 cursor-pointer border-bottom-1 border-100"
                                            :class="{ 'selector-option-active': idx === highlightedProgIndex || idx === hoveredProgIndex }"
                                            @mouseenter="hoveredProgIndex = idx"
                                            @mouseleave="hoveredProgIndex = -1"
                                            @mousedown.prevent="selectPrograma(item)"
                                        >
                                            <div class="font-medium">{{ item.label }}</div>
                                            <small class="text-color-secondary">
                                                {{ item.facultad || '—' }}
                                                <template v-if="item.nivelAcademico"> · {{ item.nivelAcademico }}</template>
                                            </small>
                                        </div>
                                    </template>

                                    <div v-else class="p-3 text-sm text-color-secondary">Sin resultados.</div>
                                </div>
                            </div>

                            <small v-if="showError('programa')" class="text-red-500">
                                {{ errors.programa }}
                            </small>
                        </div>

                        <div class="col-12 md:col-4">
                            <label class="block font-semibold mb-2">Materia <span class="text-red-500">*</span></label>
                            <div class="relative" :class="{ 'pb-18rem': showMatPanel && matSugs.length, 'pb-4': showMatPanel && !matSugs.length, 'z-10': showMatPanel }">
                                <IconField class="w-full p-input-icon-left relative">
                                    <InputIcon class="pi pi-search z-2" />
                                    <InputText
                                        v-model="materiaQuery"
                                        class="w-full selector-search-input"
                                        placeholder="Escribe para buscar..."
                                        :disabled="!product.programa?.codigoPrograma"
                                        :invalid="showError('materia')"
                                        autocomplete="off"
                                        @focus="openMatPanel"
                                        @input="onMateriaInput"
                                        @keydown="onMateriaKeydown"
                                        @blur="onBlur('materia')"
                                    />
                                    <button
                                        v-if="product.materia"
                                        type="button"
                                        class="selector-search-action"
                                        aria-label="Limpiar materia"
                                        @click="clearMateria"
                                    >
                                        <i class="pi pi-times" />
                                    </button>
                                    <span v-else-if="loadingMats" class="selector-search-action text-color-secondary" aria-hidden="true">
                                        <i class="pi pi-spin pi-spinner" />
                                    </span>
                                </IconField>

                                <div v-if="showMatPanel" class="selector-panel absolute left-0 top-full z-30 surface-overlay border-1 border-300 border-round shadow-3 mt-2 w-full max-h-18rem overflow-auto">
                                    <div v-if="loadingMats" class="p-3 text-sm text-color-secondary">Cargando…</div>

                                    <template v-else-if="matSugs.length">
                                        <div
                                            v-for="(item, idx) in matSugs"
                                            :key="`${item.codigoMateria}-${idx}`"
                                            class="selector-option p-3 cursor-pointer border-bottom-1 border-100"
                                            :class="{ 'selector-option-active': idx === highlightedMatIndex || idx === hoveredMatIndex }"
                                            @mouseenter="hoveredMatIndex = idx"
                                            @mouseleave="hoveredMatIndex = -1"
                                            @mousedown.prevent="selectMateria(item)"
                                        >
                                            <div class="font-medium">{{ item.label }}</div>
                                        </div>
                                    </template>

                                    <div v-else class="p-3 text-sm text-color-secondary">Sin resultados.</div>
                                </div>
                            </div>

                            <small v-if="showError('materia')" class="text-red-500">
                                {{ errors.materia }}
                            </small>
                        </div>

                        <div class="col-12">
                            <label class="block font-semibold mb-2">Nombre de la práctica <span class="text-red-500">*</span></label>
                            <InputText v-model="product.nombrePractica" class="w-full" maxlength="200" :invalid="showError('nombrePractica')" @blur="onBlur('nombrePractica')" />
                            <small v-if="showError('nombrePractica')" class="text-red-500">
                                {{ errors.nombrePractica }}
                            </small>
                        </div>

                        <div class="col-12">
                            <label :for="recId" class="block font-semibold mb-2">Recursos necesarios <span class="text-red-500">*</span></label>
                            <Textarea :id="recId" v-model="product.recursosNecesarios" rows="5" autoResize class="w-full" :invalid="showError('recursosNecesarios')" @blur="onBlur('recursosNecesarios')" />
                            <small v-if="showError('recursosNecesarios')" class="text-red-500">
                                {{ errors.recursosNecesarios }}
                            </small>
                        </div>

                        <div class="col-12">
                            <label :for="jusId" class="block font-semibold mb-2">Justificación <span class="text-red-500">*</span></label>
                            <Textarea :id="jusId" v-model="product.justificacion" rows="6" autoResize class="w-full" :invalid="showError('justificacion')" @blur="onBlur('justificacion')" />
                            <small v-if="showError('justificacion')" class="text-red-500">
                                {{ errors.justificacion }}
                            </small>
                        </div>

                        <div v-if="product.comentarioRechazo" class="col-12">
                            <Message severity="warn" :closable="false">
                                <div class="font-semibold mb-1">
                                    Motivo de rechazo
                                    <template v-if="product.rolRechazoLabel"> · {{ product.rolRechazoLabel }} </template>
                                </div>
                                <div v-if="product.fechaRechazo" class="text-sm text-color-secondary mb-2">
                                    {{ formatDateTime(product.fechaRechazo) }}
                                </div>
                                <div>{{ product.comentarioRechazo }}</div>
                            </Message>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" :label="product.id ? 'Guardar cambios' : 'Guardar'" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <Dialog v-model:visible="confirmSaveDialog" header="Confirmar" :style="{ width: '30rem' }" :modal="true">
                <div class="flex align-items-start gap-3">
                    <i class="pi pi-exclamation-triangle text-yellow-500 text-2xl mt-1" />
                    <div>
                        <p class="m-0">
                            <template v-if="pendingSaveAction === 'edit'"> La creación será actualizada y volverá al flujo de aprobación. </template>
                            <template v-else> La creación será enviada al flujo de aprobación. </template>
                        </p>
                    </div>
                </div>

                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="closeConfirmSave" />
                    <Button label="Sí, continuar" icon="pi pi-check" :loading="saving" @click="confirmSave" />
                </template>
            </Dialog>

            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div class="flex flex-column gap-3">
                    <div>
                        ¿Seguro que quieres eliminar la creación <b>{{ current?.nombrePractica ?? current?.nombre_practica }}</b
                        >?
                    </div>

                    <Message v-if="current?.comentarioRechazo ?? current?.comentario_rechazo" severity="warn" :closable="false">
                        <div class="font-semibold mb-1">
                            Motivo de rechazo
                            <template v-if="current?.rolRechazoLabel ?? current?.rol_rechazo_label">
                                · {{ current?.rolRechazoLabel ?? current?.rol_rechazo_label }}
                            </template>
                        </div>
                        <div v-if="current?.fechaRechazo ?? current?.fecha_rechazo" class="text-sm text-color-secondary mb-2">
                            {{ formatDateTime(current?.fechaRechazo ?? current?.fecha_rechazo) }}
                        </div>
                        <div class="white-space-pre-line">
                            {{ current?.comentarioRechazo ?? current?.comentario_rechazo }}
                        </div>
                    </Message>
                </div>

                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminado" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar <b>{{ selected.length }}</b> {{ selected.length === 1 ? 'registro' : 'registros' }}?
                </div>

                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
                </template>
            </Dialog>

            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '70vw', '768px': '85vw', '560px': '95vw' }" :style="{ width: '56vw', maxWidth: '980px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-4 border rounded-lg p-3 sm:p-4">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                                <div class="text-base font-semibold break-words leading-snug">
                                    {{ d.nombrePractica ?? d.nombre_practica ?? '—' }}
                                </div>
                                <div class="text-sm text-surface-600 break-words">
                                    {{ programaRowLabel(d) }}
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                <Tag :value="estadoLabel(d.estadoCreacion ?? d.estado_creacion)" :severity="estadoSeverity(d.estadoCreacion ?? d.estado_creacion)" />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
                            <div><b>Facultad:</b> {{ facultadRowLabel(d) }}</div>
                            <div><b>Programa:</b> {{ programaRowLabel(d) }}</div>
                            <div><b>Materia:</b> {{ materiaRowLabel(d) }}</div>
                            <div><b>Nivel académico:</b> {{ d.nivel_academico ?? d.nivelAcademico ?? '—' }}</div>
                        </div>

                        <div class="mt-4 pt-4 border-t">
                            <div class="text-sm font-semibold mb-3">Contenido</div>

                            <div class="mb-3">
                                <div class="text-sm text-surface-600 mb-1">Recursos necesarios</div>
                                <div class="line-height-3 white-space-pre-line">
                                    {{ d.recursosNecesarios ?? d.recursos_necesarios ?? '—' }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm text-surface-600 mb-1">Justificación</div>
                                <div class="line-height-3 white-space-pre-line">
                                    {{ d.justificacion ?? '—' }}
                                </div>
                            </div>
                        </div>

                        <div v-if="d.comentarioRechazo ?? d.comentario_rechazo" class="mt-4 pt-4 border-t">
                            <Message severity="warn" :closable="false">
                                <div class="font-semibold mb-1">
                                    Motivo de rechazo
                                    <template v-if="d.rolRechazoLabel ?? d.rol_rechazo_label"> · {{ d.rolRechazoLabel ?? d.rol_rechazo_label }} </template>
                                </div>
                                <div v-if="d.fechaRechazo ?? d.fecha_rechazo" class="text-sm text-color-secondary mb-2">
                                    {{ formatDateTime(d.fechaRechazo ?? d.fecha_rechazo) }}
                                </div>
                                <div class="white-space-pre-line">
                                    {{ d.comentarioRechazo ?? d.comentario_rechazo }}
                                </div>
                            </Message>
                        </div>
                    </div>

                    <div v-if="!details.length" class="text-surface-500">No fue posible cargar los detalles de los registros seleccionados.</div>
                </div>

                <template #footer>
                    <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
                </template>
            </Dialog>
        </template>
    </div>
</template>

<style scoped>
:deep(.facultad-autocomplete .p-autocomplete-input) {
    min-height: 2.9rem;
    border-radius: 10px;
    padding-left: 2.5rem;
}

:deep(.facultad-autocomplete .p-autocomplete-input::placeholder) {
    color: var(--text-color-secondary);
}

:deep(.facultad-autocomplete .p-autocomplete-overlay) {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    box-shadow:
        0 10px 28px rgba(15, 23, 42, 0.08),
        0 2px 8px rgba(15, 23, 42, 0.06);
}

:deep(.facultad-autocomplete .p-autocomplete-list) {
    padding-block: 0.35rem;
}

:deep(.facultad-autocomplete .p-autocomplete-option) {
    border-radius: 10px;
    margin: 0 0.35rem;
    transition:
        background-color 0.15s ease,
        color 0.15s ease;
}

:deep(.facultad-autocomplete .p-autocomplete-option:hover),
:deep(.facultad-autocomplete .p-autocomplete-option.p-focus) {
    background: var(--surface-100);
}

:deep(.selector-search-input) {
    min-height: 2.9rem;
    border-radius: 10px;
    padding-left: 2.5rem;
    padding-right: 2.5rem;
}

.selector-search-action {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    z-index: 2;
}

:deep(.surface-overlay) {
    background: var(--surface-overlay);
}

.selector-panel {
    border-radius: 12px;
    border-color: var(--surface-border) !important;
    box-shadow:
        0 10px 28px rgba(15, 23, 42, 0.08),
        0 2px 8px rgba(15, 23, 42, 0.06) !important;
}

.selector-option {
    border-radius: 10px;
    margin: 0.2rem 0.35rem;
    transition:
        background-color 0.15s ease,
        color 0.15s ease;
}

.selector-option:hover,
.selector-option-active {
    background: var(--surface-100) !important;
}
</style>
