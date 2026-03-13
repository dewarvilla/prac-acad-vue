<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

import ProgramacionRutaDialog from '@/components/ProgramacionRutaDialog.vue';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Tabla base
// -------------------------
const tableUid = `prg-${Math.random().toString(36).slice(2)}`;
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
const sortField = ref('fechaInicio');
const sortOrder = ref(-1);

// -------------------------
// Maps
// -------------------------
const API_SEDES_ORIGENES = '/sedes/origenes';

async function loadSedesOrigen() {
    try {
        const { data } = await api.get(API_SEDES_ORIGENES);

        const items = Array.isArray(data) ? data : (data?.data ?? []);

        sedes.value = items.map((sede) => ({
            id: sede.id,
            label: sede.label ?? `${sede.nombre}${sede.direccion ? ' - ' + sede.direccion : ''}`,
            nombre: sede.nombre ?? '',
            direccion: sede.direccion ?? '',
            lat: sede.lat ?? sede.latitud ?? null,
            lng: sede.lng ?? sede.longitud ?? null
        }));
    } catch (e) {
        sedes.value = [];
        toast.add({
            severity: 'error',
            summary: 'Sedes',
            detail: e?.response?.data?.message || e.message,
            life: 5000
        });
    }
}

// -------------------------
// Permisos CRUD
// -------------------------
const canViewProgramaciones = computed(() => hasPerm('programaciones.view'));
const canCreateProgramaciones = computed(() => hasPerm('programaciones.create'));
const canEditProgramaciones = computed(() => hasPerm('programaciones.edit'));
const canDeleteProgramaciones = computed(() => hasPerm('programaciones.delete'));

// -------------------------
// Restricción UI editar/eliminar
// -------------------------
const isRejected = (row) => {
    const st = row?.estadoProgramacion ?? row?.estado_programacion;
    return String(st || '').toLowerCase() === 'rechazada';
};

const canEditRow = (row) => canEditProgramaciones.value && isRejected(row);
const canDeleteRow = (row) => canDeleteProgramaciones.value && isRejected(row);
const canBulkDelete = computed(() => canDeleteProgramaciones.value && selected.value.length > 0 && selected.value.every(isRejected));

// -------------------------
// Permisos de aprobación
// -------------------------
const PROGRAMACION_STAGE_PERMS = {
    jefe_departamento: {
        approve: ['programaciones.aprobar.jefe_departamento', 'programaciones.aprobar.departamento'],
        reject: ['programaciones.rechazar.jefe_departamento', 'programaciones.rechazar.departamento']
    },
    decano: {
        approve: ['programaciones.aprobar.decano'],
        reject: ['programaciones.rechazar.decano']
    },
    coordinador_postgrados: {
        approve: ['programaciones.aprobar.coordinador_postgrados', 'programaciones.aprobar.postgrados'],
        reject: ['programaciones.rechazar.coordinador_postgrados', 'programaciones.rechazar.postgrados']
    },
    jefe_oficina_postgrados: {
        approve: ['programaciones.aprobar.jefe_oficina_postgrados', 'programaciones.aprobar.jefe_postgrados'],
        reject: ['programaciones.rechazar.jefe_oficina_postgrados', 'programaciones.rechazar.jefe_postgrados']
    },
    vicerrectoria_academica: {
        approve: ['programaciones.aprobar.vicerrectoria_academica', 'programaciones.aprobar.vicerrectoria'],
        reject: ['programaciones.rechazar.vicerrectoria_academica', 'programaciones.rechazar.vicerrectoria']
    }
};

const allProgramacionApprovePerms = Object.values(PROGRAMACION_STAGE_PERMS).flatMap((x) => x.approve);
const allProgramacionRejectPerms = Object.values(PROGRAMACION_STAGE_PERMS).flatMap((x) => x.reject);

const isProgramacionesApprover = computed(() => [...allProgramacionApprovePerms, ...allProgramacionRejectPerms].some((p) => hasPerm(p)));
const isApproverMode = computed(() => isProgramacionesApprover.value);
const canAccessModule = computed(() => isApproverMode.value || canViewProgramaciones.value);

const currentActorKey = computed(() => {
    for (const [key, perms] of Object.entries(PROGRAMACION_STAGE_PERMS)) {
        if ([...perms.approve, ...perms.reject].some((p) => hasPerm(p))) return key;
    }
    return null;
});

const canApproveAtStage = computed(() => {
    const k = currentActorKey.value;
    return !!k && PROGRAMACION_STAGE_PERMS[k].approve.some((p) => hasPerm(p));
});

const canRejectAtStage = computed(() => {
    const k = currentActorKey.value;
    return !!k && PROGRAMACION_STAGE_PERMS[k].reject.some((p) => hasPerm(p));
});

// -------------------------
// Endpoints
// -------------------------
const API_PRG = '/programaciones';
const API_CRE_PROGRAMABLES = '/programaciones/creaciones-disponibles';
const API_RUTAS = '/rutas';
const API_INBOX = '/approvals/inbox';
const API_APPROVAL_REQUESTS = '/approval-requests';

const approvalEndpoints = {
    approve: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/approve`,
    reject: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/reject`
};

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// Utils
// -------------------------
const s = (v) => (v == null ? '' : String(v));

function formatMoney(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(n);
}

function formatDistance(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return `${(n / 1000).toFixed(2)} km`;
}

function formatDurationSeconds(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const mins = Math.round(n / 60);
    return `${mins} min`;
}

function estadoLabel(estado) {
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

    const map = {
        creada: 'Creada',
        en_aprobacion: 'En aprobación',
        aprobada: 'Aprobada',
        rechazada: 'Rechazada',
        cancelada: 'Cancelada',
        pending: 'En aprobación',
        approved: 'Aprobada',
        rejected: 'Rechazada',
        cancelled: 'Cancelada'
    };

    return map[st] || (st ? st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
}

function estadoSeverity(estado) {
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

    if (st === 'aprobada' || st === 'approved') return 'success';
    if (st === 'rechazada' || st === 'rejected') return 'danger';
    if (st === 'en_aprobacion' || st === 'pending') return 'warn';
    if (st === 'cancelada' || st === 'cancelled') return 'secondary';
    return 'info';
}

function approvalRoleLabel(roleKey) {
    const labels = {
        jefe_departamento: 'Jefe de Departamento',
        decano: 'Decano',
        vicerrectoria_academica: 'Vicerrectoría Académica',
        coordinador_postgrados: 'Coordinador de Postgrados',
        jefe_oficina_postgrados: 'Jefe de Oficina de Postgrados'
    };
    return labels[roleKey] ?? roleKey ?? '—';
}

function boolLabel(v, yes = 'Sí', no = 'No') {
    return v ? yes : no;
}

function boolSeverity(v, yesSeverity = 'success', noSeverity = 'secondary') {
    return v ? yesSeverity : noSeverity;
}

function getApprovalRequestId(row) {
    return row?.approval?.id ?? row?.approvalRequestId ?? row?.approval_request_id ?? null;
}

function getApprovalCurrentRoleKey(row) {
    return row?.approval?.current_role_key ?? row?.approvalCurrentRoleKey ?? row?.approval_current_role_key ?? null;
}

function getNombrePractica(row) {
    return row?.creacion?.nombre_practica || row?.creacion?.nombrePractica || row?.nombre_practica || row?.nombrePractica || '—';
}

function getMateriaLabel(row) {
    const c = row?.creacion;
    if (!c) return '—';
    const codigo = c.codigo_materia ?? c.codigoMateria ?? '';
    const nombre = c.nombre_materia ?? c.nombreMateria ?? '';
    return `${codigo} - ${nombre}`.trim() || '—';
}

function getProgramaLabel(row) {
    const c = row?.creacion;
    if (!c) return '—';
    const codigo = c.codigo_programa ?? c.codigoPrograma ?? '';
    const nombre = c.nombre_programa ?? c.nombrePrograma ?? '';
    return `${codigo} - ${nombre}`.trim() || '—';
}

function normalizeCreacionSummary(raw) {
    if (!raw) return null;

    return {
        id: raw?.id ?? null,
        codigoPrograma: s(raw?.codigo_programa ?? raw?.codigoPrograma).trim(),
        nombrePrograma: s(raw?.nombre_programa ?? raw?.nombrePrograma).trim(),
        codigoMateria: s(raw?.codigo_materia ?? raw?.codigoMateria).trim(),
        nombreMateria: s(raw?.nombre_materia ?? raw?.nombreMateria).trim(),
        codigoFacultad: s(raw?.codigo_facultad ?? raw?.codigoFacultad).trim(),
        facultad: s(raw?.facultad).trim(),
        nivelAcademico: s(raw?.nivel_academico ?? raw?.nivelAcademico).trim(),
        nombrePractica: s(raw?.nombre_practica ?? raw?.nombrePractica).trim(),
        label: s(raw?.nombre_practica ?? raw?.nombrePractica).trim(),
        secondaryLabel: `${s(raw?.codigo_programa ?? raw?.codigoPrograma).trim()} - ${s(raw?.nombre_programa ?? raw?.nombrePrograma).trim()}`.trim()
    };
}

function normalizeProgramacionRow(raw) {
    return {
        id: raw?.id ?? null,
        creacion_id: raw?.creacion_id ?? raw?.creacionId ?? null,
        creacion: raw?.creacion ?? null,

        requiere_transporte: !!(raw?.requiere_transporte ?? raw?.requiereTransporte),
        fecha_inicio: raw?.fecha_inicio ?? raw?.fechaInicio ?? '',
        fecha_fin: raw?.fecha_fin ?? raw?.fechaFin ?? '',
        pernocta: !!raw?.pernocta,
        categoria_vehiculo: raw?.categoria_vehiculo ?? raw?.categoriaVehiculo ?? '',

        distancia_total_m: raw?.distancia_total_m ?? raw?.distanciaTotalM ?? null,
        valor_peajes_total: raw?.valor_peajes_total ?? raw?.valorPeajesTotal ?? null,
        valor_auxilios_total: raw?.valor_auxilios_total ?? raw?.valorAuxiliosTotal ?? null,

        requiere_recursos_especiales: !!(raw?.requiere_recursos_especiales ?? raw?.requiereRecursosEspeciales),
        recursos_especiales_descripcion: raw?.recursos_especiales_descripcion ?? raw?.recursosEspecialesDescripcion ?? '',
        valor_recursos_especiales: raw?.valor_recursos_especiales ?? raw?.valorRecursosEspeciales ?? null,

        justificacion: raw?.justificacion ?? '',
        estado_programacion: raw?.estado_programacion ?? raw?.estadoProgramacion ?? 'en_aprobacion',
        estado: !!(raw?.estado ?? true),
        approval: raw?.approval ?? null,
        estado_flujo: raw?.estado_flujo ?? raw?.estadoFlujo ?? null,

        created_at: raw?.created_at ?? raw?.createdAt ?? null,
        updated_at: raw?.updated_at ?? raw?.updatedAt ?? null
    };
}

function normalizeInboxItem(ar) {
    const raw = ar?.data ? ar.data : ar;
    const a = raw?.approvable?.data ?? raw?.approvable ?? {};

    return {
        ...normalizeProgramacionRow(a),
        approval: {
            id: raw?.id ?? null,
            status: raw?.status ?? null,
            current_role_key: raw?.current_role_key ?? null,
            current_role_label: approvalRoleLabel(raw?.current_role_key ?? null),
            definition_code: raw?.definition?.code ?? raw?.definition_code ?? null
        }
    };
}

// -------------------------
// Sedes / Rutas
// -------------------------
const sedes = ref([]);
const routeDialog = ref(false);
const rutaDraft = ref(null);

// -------------------------
// Creación aprobada (autocomplete)
// -------------------------
const creacionQuery = ref('');
const creacionSugs = ref([]);
const loadingCreaciones = ref(false);
const showCrePanel = ref(false);
const highlightedCreIndex = ref(-1);
let creTimer = null;
const CRE_DEBOUNCE = 250;

function openCrePanel() {
    showCrePanel.value = true;
}
function closeCrePanel() {
    showCrePanel.value = false;
    highlightedCreIndex.value = -1;
}

async function fetchCreaciones(query = '') {
    loadingCreaciones.value = true;

    try {
        const { data } = await api.get(API_CRE_PROGRAMABLES, {
            params: {
                per_page: 20,
                q: s(query).trim(),
                sort: '-updated_at'
            }
        });

        const items = Array.isArray(data) ? data : (data?.data ?? []);
        creacionSugs.value = items.map(normalizeCreacionSummary).filter(Boolean);
    } catch (e) {
        creacionSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Creaciones disponibles',
            detail: e?.response?.data?.message || e.message,
            life: 4000
        });
    } finally {
        loadingCreaciones.value = false;
    }
}

function onCreacionInput() {
    const q = s(creacionQuery.value).trim();
    showCrePanel.value = true;

    const currentLabel = s(product.value.creacion?.label || '').trim();
    if (product.value.creacion && q !== currentLabel) {
        product.value.creacion = null;
        if (touched.creacion) validateField('creacion');
    }

    if (creTimer) clearTimeout(creTimer);
    creTimer = setTimeout(() => {
        if (!q.length) {
            creacionSugs.value = [];
            highlightedCreIndex.value = -1;
            return;
        }
        fetchCreaciones(q);
    }, CRE_DEBOUNCE);
}

function onCreacionKeydown(e) {
    if (!showCrePanel.value || !creacionSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedCreIndex.value = highlightedCreIndex.value < creacionSugs.value.length - 1 ? highlightedCreIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedCreIndex.value = highlightedCreIndex.value > 0 ? highlightedCreIndex.value - 1 : creacionSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedCreIndex.value >= 0) selectCreacion(creacionSugs.value[highlightedCreIndex.value]);
        else {
            touched.creacion = true;
            validateField('creacion');
            closeCrePanel();
        }
    }
}

function selectCreacion(it) {
    product.value.creacion = it;
    creacionQuery.value = it.label || '';
    touched.creacion = true;
    validateField('creacion');
    closeCrePanel();
}

function onCreacionEnter() {
    touched.creacion = true;
    validateField('creacion');
    closeCrePanel();
}

function clearCreacion() {
    creacionQuery.value = '';
    creacionSugs.value = [];
    highlightedCreIndex.value = -1;
    product.value.creacion = null;
    touched.creacion = true;
    validateField('creacion');
    closeCrePanel();
}

// -------------------------
// Parametrización tabla
// -------------------------
const SORT_MAP_PRG = {
    id: 'id',
    creacionId: 'creacion_id',

    nombrePractica: 'nombre_practica',
    codigoFacultad: 'codigo_facultad',
    codigoPrograma: 'codigo_programa',
    codigoMateria: 'codigo_materia',
    nivelAcademico: 'nivel_academico',

    fechaInicio: 'fecha_inicio',
    fechaFin: 'fecha_fin',
    estadoProgramacion: 'estado_programacion',
    requiereTransporte: 'requiere_transporte',
    pernocta: 'pernocta',
    estado: 'estado',

    createdAt: 'created_at',
    updatedAt: 'updated_at'
};

const SORT_MAP_INBOX = {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
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
                return compareValues(getNombrePractica(a), getNombrePractica(b), order);
            case 'codigoPrograma':
                return compareValues(getProgramaLabel(a), getProgramaLabel(b), order);
            case 'codigoMateria':
                return compareValues(getMateriaLabel(a), getMateriaLabel(b), order);
            case 'fechaInicio':
                return compareValues(a.fecha_inicio, b.fecha_inicio, order);
            case 'fechaFin':
                return compareValues(a.fecha_fin, b.fecha_fin, order);
            case 'estadoProgramacion':
                return compareValues(a.estado_programacion, b.estado_programacion, order);
            case 'id':
                return compareValues(a.id, b.id, order);
            case 'createdAt':
                return compareValues(a.created_at, b.created_at, order);
            case 'updatedAt':
                return compareValues(a.updated_at, b.updated_at, order);
            default:
                return 0;
        }
    });

    return sorted;
}

const sortParamPrg = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_PRG));
const sortParamInbox = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_INBOX));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = isApproverMode.value ? sortParamInbox.value : sortParamPrg.value;
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
        if (!isApproverMode.value) {
            const { data } = await api.get(API_PRG, {
                params: buildParams({ force }),
                signal
            });

            const items = Array.isArray(data) ? data : (data?.data ?? []);
            products.value = items.map(normalizeProgramacionRow);
            total.value = Number(data?.meta?.total ?? products.value.length);

            if (!Array.isArray(data)) {
                if (data.meta?.current_page) page.value = Number(data.meta.current_page);
                if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
            }
            return;
        }

        const { data } = await api.get(API_INBOX, {
            params: buildParams({ force }),
            signal
        });

        const items = Array.isArray(data) ? data : (data?.data ?? []);
        let normalized = items.map(normalizeInboxItem);

        normalized = normalized.filter((x) => x.approval?.id && (!x.approval?.definition_code || true));

        if (currentActorKey.value) {
            normalized = normalized.filter((x) => {
                const rk = getApprovalCurrentRoleKey(x);
                return rk ? rk === currentActorKey.value : true;
            });
        }

        const sortedInbox = sortInboxItems(normalized);

        products.value = sortedInbox;
        total.value = Number(data?.meta?.total ?? sortedInbox.length);
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';
        if (!canceled) {
            const status = e?.response?.status;
            const msg = e?.response?.data?.message || e.message;
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
// Acciones aprobación
// -------------------------
function isActionable(row) {
    const status = row?.approval?.status;
    return !status || String(status).toLowerCase() === 'pending';
}

function canApproveRow(row) {
    if (!isApproverMode.value || !currentActorKey.value || !canApproveAtStage.value) return false;
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId || !isActionable(row)) return false;
    const roleKey = getApprovalCurrentRoleKey(row);
    return roleKey ? roleKey === currentActorKey.value : true;
}

function canRejectRow(row) {
    if (!isApproverMode.value || !currentActorKey.value || !canRejectAtStage.value) return false;
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId || !isActionable(row)) return false;
    const roleKey = getApprovalCurrentRoleKey(row);
    return roleKey ? roleKey === currentActorKey.value : true;
}

function removeInboxItem(approvalRequestId) {
    products.value = products.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    selected.value = selected.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    total.value = Number(products.value.length);
}

const approveLoading = ref(false);

async function approveRow(row) {
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return;

    try {
        approveLoading.value = true;
        await api.post(approvalEndpoints.approve(approvalRequestId));
        removeInboxItem(approvalRequestId);
        await getProducts({ force: true });
        toast.add({ severity: 'success', summary: 'Aprobado', detail: 'Aprobación registrada.', life: 3000 });
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'Error al aprobar',
            detail: e?.response?.data?.message || e.message,
            life: 6000
        });
    } finally {
        approveLoading.value = false;
    }
}

const rejectDialog = ref(false);
const rejectLoading = ref(false);
const rejectTarget = ref(null);
const rejectJustificacion = ref('');
const rejectError = ref('');

function openRejectDialog(row) {
    rejectTarget.value = row;
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

    try {
        rejectLoading.value = true;
        const approvalRequestId = getApprovalRequestId(rejectTarget.value);
        await api.post(approvalEndpoints.reject(approvalRequestId), {
            comment: rejectJustificacion.value.trim()
        });

        removeInboxItem(approvalRequestId);
        await getProducts({ force: true });
        toast.add({ severity: 'success', summary: 'Rechazado', detail: 'Rechazo registrado.', life: 3000 });
        closeRejectDialog();
    } catch (e) {
        rejectError.value = e?.response?.data?.message || e.message;
    } finally {
        rejectLoading.value = false;
    }
}

// -------------------------
// CRUD + Detalles
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
        if (!isApproverMode.value) {
            const reqs = selected.value.map((r) => api.get(`${API_PRG}/${r.id}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => normalizeProgramacionRow(r.value.data?.data ?? r.value.data))
                .filter(Boolean);
        } else {
            const reqs = selected.value.map((r) => api.get(`${API_APPROVAL_REQUESTS}/${getApprovalRequestId(r)}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => normalizeInboxItem(r.value.data?.data ?? r.value.data))
                .filter(Boolean);
        }
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

// -------------------------
// Form state
// -------------------------
function defaultProduct() {
    return {
        id: null,
        creacion: null,
        fecha_inicio: '',
        fecha_fin: '',
        requiere_transporte: false,
        requiere_recursos_especiales: false,
        recursos_especiales_descripcion: '',
        valor_recursos_especiales: '',
        justificacion: ''
    };
}

const product = ref(defaultProduct());

const errors = reactive({
    creacion: '',
    fecha_inicio: '',
    fecha_fin: '',
    ruta: '',
    recursos_especiales_descripcion: '',
    valor_recursos_especiales: '',
    justificacion: ''
});

const touched = reactive({
    creacion: false,
    fecha_inicio: false,
    fecha_fin: false,
    ruta: false,
    recursos_especiales_descripcion: false,
    valor_recursos_especiales: false,
    justificacion: false
});

const rules = {
    creacion: [(v) => !!v?.id || 'Requerido.'],
    fecha_inicio: [(v) => !!v || 'Requerido.'],
    fecha_fin: [(v) => !!v || 'Requerido.', (v) => !v || !product.value.fecha_inicio || v >= product.value.fecha_inicio || 'Debe ser igual o posterior a la fecha inicial.'],
    ruta: [() => !product.value.requiere_transporte || !!rutaDraft.value || 'Debes definir el recorrido cuando la programación requiere transporte.'],
    recursos_especiales_descripcion: [(v) => !product.value.requiere_recursos_especiales || !!s(v).trim() || 'Requerido cuando hay recursos especiales.'],
    valor_recursos_especiales: [
        (v) => {
            if (!product.value.requiere_recursos_especiales) return true;
            if (v === '' || v == null) return 'Requerido cuando hay recursos especiales.';
            return Number(v) >= 0 || 'Debe ser mayor o igual a 0.';
        }
    ],
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

watch(
    () => product.value.requiere_transporte,
    (v) => {
        if (!v) {
            rutaDraft.value = null;
            touched.ruta = false;
            errors.ruta = '';
        }
    }
);

watch(
    () => product.value.requiere_recursos_especiales,
    (v) => {
        if (!v) {
            product.value.recursos_especiales_descripcion = '';
            product.value.valor_recursos_especiales = '';
            touched.recursos_especiales_descripcion = false;
            touched.valor_recursos_especiales = false;
            errors.recursos_especiales_descripcion = '';
            errors.valor_recursos_especiales = '';
        }
    }
);

async function openNew() {
    if (!sedes.value.length) {
        await loadSedesOrigen();
    }

    product.value = defaultProduct();
    rutaDraft.value = null;
    creacionQuery.value = '';
    creacionSugs.value = [];
    closeCrePanel();
    resetValidation();
    productDialog.value = true;
}

async function editProduct(row) {
    if (!sedes.value.length) {
        await loadSedesOrigen();
    }

    product.value = {
        id: row.id ?? null,
        creacion: normalizeCreacionSummary(row.creacion),
        fecha_inicio: row.fecha_inicio ?? '',
        fecha_fin: row.fecha_fin ?? '',
        requiere_transporte: !!row.requiere_transporte,
        requiere_recursos_especiales: !!row.requiere_recursos_especiales,
        recursos_especiales_descripcion: row.recursos_especiales_descripcion ?? '',
        valor_recursos_especiales: row.valor_recursos_especiales != null ? String(row.valor_recursos_especiales) : '',
        justificacion: row.justificacion ?? ''
    };

    creacionQuery.value = product.value.creacion?.label || '';
    creacionSugs.value = [];
    closeCrePanel();

    rutaDraft.value = null;

    resetValidation();
    productDialog.value = true;
}

async function openRouteDialog() {
    if (!sedes.value.length) {
        await loadSedesOrigen();
    }

    if (!sedes.value.length) {
        toast.add({
            severity: 'warn',
            summary: 'Sedes',
            detail: 'No hay sedes de origen disponibles.',
            life: 4000
        });
        return;
    }

    routeDialog.value = true;
}

function onRoutePicked(payload) {
    rutaDraft.value = {
        ...payload,
        origen_desc: payload.origen_desc ?? payload.origen_descripcion ?? '',
        destino_desc: payload.destino_desc ?? payload.destino_descripcion ?? '',
        destino_descripcion: payload.destino_descripcion ?? payload.destino_desc ?? '',
        categoria_vehiculo: payload.categoria_vehiculo ?? payload.categoria_peaje ?? null
    };

    touched.ruta = true;
    validateField('ruta');
}

function routeSummaryLabel() {
    if (!rutaDraft.value) return 'No definido';
    return `${rutaDraft.value.origen_desc || 'Origen'} → ${rutaDraft.value.destino_desc || rutaDraft.value.destino_descripcion || 'Destino'}`;
}

// -------------------------
// Guardado
// -------------------------
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
    creacion_id: 'creacion',
    fecha_inicio: 'fecha_inicio',
    fecha_fin: 'fecha_fin',
    justificacion: 'justificacion',
    recursos_especiales_descripcion: 'recursos_especiales_descripcion',
    valor_recursos_especiales: 'valor_recursos_especiales'
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

async function persistRutaForProgramacion(programacionId) {
    if (!rutaDraft.value || !product.value.requiere_transporte) return;

    const payload = {
        programacion_id: programacionId,
        sede_id: rutaDraft.value.sede_id ?? null,

        destino_place_id: rutaDraft.value.destino_place_id ?? null,
        destino_descripcion: rutaDraft.value.destino_descripcion ?? rutaDraft.value.destino_desc ?? null,
        destino_lat: rutaDraft.value.destino_lat ?? null,
        destino_lng: rutaDraft.value.destino_lng ?? null,

        travel_mode: 'DRIVE',
        categoria_vehiculo: rutaDraft.value.categoria_vehiculo ?? null,
        justificacion: rutaDraft.value.justificacion ?? null,
        orden: 1
    };

    await api.post(API_RUTAS, payload);
}

async function saveProduct() {
    if (saving.value) return;

    const fields = ['creacion', 'fecha_inicio', 'fecha_fin', 'ruta', 'recursos_especiales_descripcion', 'valor_recursos_especiales', 'justificacion'];
    fields.forEach((f) => {
        touched[f] = true;
        validateField(f);
    });

    const ok = fields.every((f) => !errors[f]);
    if (!ok) {
        toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail: 'Revisa los campos obligatorios.', life: 4500 });
        return;
    }

    const payload = {
        creacion_id: product.value.creacion?.id ?? null,
        fecha_inicio: product.value.fecha_inicio,
        fecha_fin: product.value.fecha_fin,
        requiere_transporte: !!product.value.requiere_transporte,
        categoria_vehiculo: product.value.requiere_transporte ? (rutaDraft.value?.categoria_vehiculo ?? null) : null,
        requiere_recursos_especiales: !!product.value.requiere_recursos_especiales,
        recursos_especiales_descripcion: product.value.requiere_recursos_especiales ? s(product.value.recursos_especiales_descripcion).trim() : null,
        valor_recursos_especiales: product.value.requiere_recursos_especiales ? Number(product.value.valor_recursos_especiales) : null,
        justificacion: s(product.value.justificacion).trim()
    };

    try {
        saving.value = true;

        let programacion;
        if (product.value.id) {
            const { data } = await api.patch(`${API_PRG}/${product.value.id}`, payload);
            programacion = data?.data ?? data;
            toast.add({ severity: 'success', summary: 'Actualizado', detail: 'La programación fue actualizada y volvió a aprobación.', life: 3500 });
        } else {
            const { data } = await api.post(API_PRG, payload);
            programacion = data?.data ?? data;
            toast.add({ severity: 'success', summary: 'Creada', detail: 'La programación fue creada y enviada a aprobación.', life: 3500 });
        }

        const programacionId = programacion?.id ?? null;
        if (programacionId && product.value.requiere_transporte && rutaDraft.value) {
            try {
                await persistRutaForProgramacion(programacionId);
            } catch (routeError) {
                toast.add({
                    severity: 'warn',
                    summary: 'Programación guardada',
                    detail: `La programación se guardó, pero la ruta no se pudo persistir: ${routeError?.response?.data?.message || routeError.message}`,
                    life: 6500
                });
            }
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            const detail = summarizeValidationErrors(data?.errors) || data?.message || 'Los datos enviados son inválidos.';
            toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail, life: 6500 });
            return;
        }

        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'Conflicto' : 'No se pudo guardar',
            detail: `[${status ?? 'ERR'}] ${data?.message || e.message}`,
            life: 6500
        });
    } finally {
        saving.value = false;
    }
}

// -------------------------
// Eliminar
// -------------------------
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    try {
        await api.delete(`${API_PRG}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'No se pudo eliminar',
            detail: String(e?.response?.data?.message || e.message),
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
            detail: 'Solo puedes eliminar programaciones en estado "rechazada".',
            life: 4500
        });
        return;
    }
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);
    try {
        await api.post(`${API_PRG}/bulk-delete`, { ids });
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

// -------------------------
// Lifecycle
// -------------------------
onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (creTimer) clearTimeout(creTimer);
});

onMounted(async () => {
    await getProducts();
});
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Programaciones</h2>
                <span v-if="isApproverMode" class="text-sm text-surface-500">Modo aprobador</span>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="!isApproverMode && canCreateProgramaciones" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="!isApproverMode && canDeleteProgramaciones" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
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
                                    id="prgSearch"
                                    name="prgSearch"
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
                :rowsPerPageOptions="[5, 10, 25, 50, 100]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
                responsiveLayout="scroll"
                :scrollable="true"
                tableStyle="width: 100%; min-width: 1320px;"
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

                <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 18rem; max-width: 24rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="getNombrePractica(data)">
                            {{ getNombrePractica(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoPrograma" header="Programa académico" sortable style="min-width: 18rem; max-width: 24rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden" style="-webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical" v-tooltip.top="getProgramaLabel(data)">
                            {{ getProgramaLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoMateria" header="Materia" sortable style="min-width: 18rem; max-width: 24rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden" style="-webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical" v-tooltip.top="getMateriaLabel(data)">
                            {{ getMateriaLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="fechaInicio" header="Fecha inicio" sortable style="width: 11rem; min-width: 11rem">
                    <template #body="{ data }">
                        {{ data.fecha_inicio || '—' }}
                    </template>
                </Column>

                <Column field="fechaFin" header="Fecha fin" sortable style="width: 11rem; min-width: 11rem">
                    <template #body="{ data }">
                        {{ data.fecha_fin || '—' }}
                    </template>
                </Column>

                <Column field="estadoProgramacion" header="Estado" sortable style="width: 12rem; min-width: 12rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estado_programacion)" :severity="estadoSeverity(data.estado_programacion)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:11rem">
                    <template #body="{ data }">
                        <template v-if="isApproverMode">
                            <Button v-if="canApproveRow(data)" icon="pi pi-check" rounded text severity="success" class="mr-1" :disabled="approveLoading" @click.stop="approveRow(data)" />
                            <Button v-if="canRejectRow(data)" icon="pi pi-times" rounded text severity="warning" class="mr-1" :disabled="approveLoading" @click.stop="openRejectDialog(data)" />
                        </template>

                        <template v-else>
                            <Button v-if="canEditRow(data)" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                            <Button v-if="canDeleteRow(data)" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                        </template>
                    </template>
                </Column>
            </DataTable>

            <Dialog v-if="!isApproverMode" v-model:visible="productDialog" header="Programación" :style="{ width: '42rem' }" :modal="true">
                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-2 relative">
                        <label for="creacionAprobada">Creación aprobada</label>

                        <IconField class="w-full relative">
                            <InputIcon :class="loadingCreaciones ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                            <InputText
                                id="creacionAprobada"
                                name="creacionAprobada"
                                :invalid="showError('creacion')"
                                :class="{ 'rounded-b-none': showCrePanel }"
                                v-model.trim="creacionQuery"
                                placeholder="Escribe para buscar una creación aprobada…"
                                class="w-full h-10 leading-10 pl-9 pr-8"
                                autocomplete="off"
                                role="combobox"
                                aria-autocomplete="list"
                                :aria-expanded="showCrePanel ? 'true' : 'false'"
                                :aria-controls="'cre-listbox'"
                                :aria-activedescendant="highlightedCreIndex >= 0 ? 'cre-opt-' + highlightedCreIndex : undefined"
                                @focus="openCrePanel"
                                @input="onCreacionInput"
                                @blur="onBlur('creacion')"
                                @keydown="onCreacionKeydown"
                                @keydown.enter.prevent="onCreacionEnter"
                                @keydown.esc.prevent="closeCrePanel"
                            />
                            <span v-if="creacionQuery" class="pi pi-times cursor-pointer absolute right-3 top-1/2 -translate-y-1/2" @click="clearCreacion" aria-label="Limpiar creación" />
                        </IconField>

                        <div
                            v-if="showCrePanel && creacionSugs.length"
                            id="cre-listbox"
                            role="listbox"
                            class="absolute left-0 right-0 top-full -mt-px max-h-72 overflow-auto z-50 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            <div
                                v-for="(it, i) in creacionSugs"
                                :key="it.id"
                                :id="'cre-opt-' + i"
                                role="option"
                                :aria-selected="i === highlightedCreIndex ? 'true' : 'false'"
                                class="px-3 py-2 cursor-pointer select-none"
                                :class="i === highlightedCreIndex ? 'bg-primary-50' : ''"
                                @mouseenter="highlightedCreIndex = i"
                                @mouseleave="highlightedCreIndex = -1"
                                @mousedown.prevent
                                @click="selectCreacion(it)"
                            >
                                <div class="text-sm font-medium">{{ it.label }}</div>
                                <div class="text-xs text-surface-500">{{ it.secondaryLabel }}</div>
                                <div class="text-xs text-surface-500">{{ it.codigoMateria }} - {{ it.nombreMateria }}</div>
                            </div>
                        </div>

                        <div
                            v-else-if="showCrePanel && !loadingCreaciones && creacionQuery && !creacionSugs.length"
                            class="absolute left-0 right-0 top-full -mt-px z-50 px-3 py-2 text-sm text-surface-500 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            Sin coincidencias
                        </div>

                        <small v-if="showError('creacion')" class="text-red-500">{{ errors.creacion }}</small>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="flex flex-col gap-2">
                            <label for="fechaInicio">Fecha inicio</label>
                            <input id="fechaInicio" v-model="product.fecha_inicio" type="date" class="p-inputtext p-component w-full" :class="{ 'p-invalid': showError('fecha_inicio') }" @blur="onBlur('fecha_inicio')" />
                            <small v-if="showError('fecha_inicio')" class="text-red-500">{{ errors.fecha_inicio }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="fechaFin">Fecha fin</label>
                            <input id="fechaFin" v-model="product.fecha_fin" type="date" class="p-inputtext p-component w-full" :class="{ 'p-invalid': showError('fecha_fin') }" @blur="onBlur('fecha_fin')" />
                            <small v-if="showError('fecha_fin')" class="text-red-500">{{ errors.fecha_fin }}</small>
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <Checkbox v-model="product.requiere_transporte" :binary="true" inputId="requiereTransporte" />
                        <label for="requiereTransporte">Requiere transporte</label>
                    </div>

                    <div v-if="product.requiere_transporte" class="border rounded-md p-3 bg-surface-50">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <div class="font-medium">Recorrido</div>
                                <div class="text-sm text-surface-600">{{ routeSummaryLabel() }}</div>
                            </div>
                            <Button label="Definir recorrido" icon="pi pi-map-marker" @click="openRouteDialog" />
                        </div>

                        <div v-if="rutaDraft" class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div><b>Origen:</b> {{ rutaDraft.origen_desc || '—' }}</div>
                            <div><b>Destino:</b> {{ rutaDraft.destino_desc || rutaDraft.destino_descripcion || '—' }}</div>
                            <div><b>Distancia:</b> {{ formatDistance(rutaDraft.distancia_m) }}</div>
                            <div><b>Duración:</b> {{ formatDurationSeconds(rutaDraft.duracion_s) }}</div>
                            <div><b>Categoría vehículo:</b> {{ rutaDraft.categoria_vehiculo || '—' }}</div>
                            <div><b>Polyline:</b> {{ rutaDraft.polyline ? 'Sí' : 'No' }}</div>
                        </div>

                        <small v-if="showError('ruta')" class="text-red-500 block mt-2">{{ errors.ruta }}</small>
                    </div>

                    <div class="flex items-center gap-2">
                        <Checkbox v-model="product.requiere_recursos_especiales" :binary="true" inputId="requiereRecursosEspeciales" />
                        <label for="requiereRecursosEspeciales">Requiere recursos especiales</label>
                    </div>

                    <div v-if="product.requiere_recursos_especiales" class="grid grid-cols-1 gap-4">
                        <div class="flex flex-col gap-2">
                            <label for="recursosEspecialesDescripcion">Descripción recursos especiales</label>
                            <textarea
                                id="recursosEspecialesDescripcion"
                                v-model.trim="product.recursos_especiales_descripcion"
                                class="p-inputtextarea p-inputtext p-component w-full"
                                rows="3"
                                @blur="onBlur('recursos_especiales_descripcion')"
                            ></textarea>
                            <small v-if="showError('recursos_especiales_descripcion')" class="text-red-500">{{ errors.recursos_especiales_descripcion }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="valorRecursosEspeciales">Valor recursos especiales</label>
                            <InputText
                                id="valorRecursosEspeciales"
                                v-model.trim="product.valor_recursos_especiales"
                                inputmode="decimal"
                                placeholder="0"
                                :invalid="showError('valor_recursos_especiales')"
                                @blur="onBlur('valor_recursos_especiales')"
                                fluid
                            />
                            <small v-if="showError('valor_recursos_especiales')" class="text-red-500">{{ errors.valor_recursos_especiales }}</small>
                        </div>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="justificacion">Justificación</label>
                        <textarea id="justificacion" v-model.trim="product.justificacion" class="p-inputtextarea p-inputtext p-component w-full" rows="4" @blur="onBlur('justificacion')"></textarea>
                        <small v-if="showError('justificacion')" class="text-red-500">{{ errors.justificacion }}</small>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <Dialog v-model:visible="rejectDialog" header="Rechazar programación" :style="{ width: '30rem' }" :modal="true">
                <div v-if="rejectTarget">
                    <p class="mb-3">
                        Vas a rechazar la programación <b>Id: {{ rejectTarget.id }}</b> — <b>{{ getNombrePractica(rejectTarget) }}</b>
                    </p>
                    <div class="flex flex-col gap-2">
                        <label for="reject-just" class="font-medium">Comentario / Justificación</label>
                        <Textarea id="reject-just" v-model.trim="rejectJustificacion" rows="4" autoResize :class="{ 'p-invalid': !!rejectError }" />
                        <small v-if="rejectError" class="text-red-500">{{ rejectError }}</small>
                    </div>
                </div>
                <template #footer>
                    <Button label="Cancelar" icon="pi pi-times" text :disabled="rejectLoading" @click="closeRejectDialog" />
                    <Button label="Rechazar" icon="pi pi-check" severity="danger" :loading="rejectLoading" :disabled="rejectLoading" @click="confirmReject" />
                </template>
            </Dialog>

            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1280px': '72vw', '1024px': '82vw', '768px': '92vw', '560px': '96vw' }" :style="{ width: '60vw', maxWidth: '1080px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-5 border rounded-xl p-4 sm:p-5">
                        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                            <div class="min-w-0">
                                <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                                <div class="text-lg font-semibold break-words leading-snug">
                                    {{ getNombrePractica(d) }}
                                </div>
                                <div class="text-sm text-surface-600 mt-1 break-words">
                                    {{ getProgramaLabel(d) }}
                                </div>
                                <div class="text-sm text-surface-600 break-words">
                                    {{ getMateriaLabel(d) }}
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                                <Tag :value="estadoLabel(d.estado_programacion)" :severity="estadoSeverity(d.estado_programacion)" />
                                <Tag :value="boolLabel(d.requiere_transporte, 'Con transporte', 'Sin transporte')" :severity="boolSeverity(d.requiere_transporte)" />
                                <Tag :value="boolLabel(d.pernocta)" :severity="boolSeverity(d.pernocta)" />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
                            <div class="border rounded-lg p-3">
                                <div class="text-xs text-surface-500 mb-1">Fecha inicio</div>
                                <div class="font-medium">{{ d.fecha_inicio || '—' }}</div>
                            </div>

                            <div class="border rounded-lg p-3">
                                <div class="text-xs text-surface-500 mb-1">Fecha fin</div>
                                <div class="font-medium">{{ d.fecha_fin || '—' }}</div>
                            </div>

                            <div class="border rounded-lg p-3">
                                <div class="text-xs text-surface-500 mb-1">Distancia</div>
                                <div class="font-medium">{{ formatDistance(d.distancia_total_m) }}</div>
                            </div>

                            <div class="border rounded-lg p-3">
                                <div class="text-xs text-surface-500 mb-1">Categoría vehículo</div>
                                <div class="font-medium">{{ d.categoria_vehiculo || '—' }}</div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
                            <div class="border rounded-lg p-4">
                                <div class="text-sm font-semibold mb-3">Información general</div>
                                <div class="space-y-2 text-sm">
                                    <div><b>Creación asociada:</b> {{ d.creacion_id || '—' }}</div>
                                    <div><b>Estado:</b> {{ estadoLabel(d.estado_programacion) }}</div>
                                    <div><b>Estado activo:</b> {{ boolLabel(d.estado) }}</div>
                                    <div><b>Flujo actual:</b> {{ d.estado_flujo || approvalRoleLabel(d.approval?.current_role_key) || '—' }}</div>
                                    <div><b>Requiere transporte:</b> {{ boolLabel(d.requiere_transporte) }}</div>
                                    <div><b>Pernocta:</b> {{ boolLabel(d.pernocta) }}</div>
                                </div>
                            </div>

                            <div class="border rounded-lg p-4">
                                <div class="text-sm font-semibold mb-3">Valores calculados</div>
                                <div class="space-y-2 text-sm">
                                    <div><b>Peajes:</b> {{ d.valor_peajes_total != null ? formatMoney(d.valor_peajes_total) : '—' }}</div>
                                    <div><b>Auxilios:</b> {{ d.valor_auxilios_total != null ? formatMoney(d.valor_auxilios_total) : '—' }}</div>
                                    <div><b>Recursos especiales:</b> {{ d.valor_recursos_especiales != null ? formatMoney(d.valor_recursos_especiales) : '—' }}</div>
                                </div>
                            </div>

                            <div class="border rounded-lg p-4 xl:col-span-2">
                                <div class="text-sm font-semibold mb-3">Justificación</div>
                                <div class="border rounded-md p-3 whitespace-pre-line break-words text-sm">
                                    {{ d.justificacion || '—' }}
                                </div>
                            </div>

                            <div v-if="d.requiere_recursos_especiales" class="border rounded-lg p-4 xl:col-span-2">
                                <div class="text-sm font-semibold mb-3">Recursos especiales</div>
                                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div>
                                        <div class="text-xs text-surface-500 mb-1">Descripción</div>
                                        <div class="border rounded-md p-3 whitespace-pre-line break-words text-sm">
                                            {{ d.recursos_especiales_descripcion || '—' }}
                                        </div>
                                    </div>

                                    <div>
                                        <div class="text-xs text-surface-500 mb-1">Valor</div>
                                        <div class="border rounded-md p-3 text-sm">
                                            {{ d.valor_recursos_especiales != null ? formatMoney(d.valor_recursos_especiales) : '—' }}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="border rounded-lg p-4 xl:col-span-2">
                                <div class="text-sm font-semibold mb-3">Participantes</div>
                                <div class="text-sm text-surface-600">Cuando el endpoint <b>show</b> de programación devuelva estudiantes y acompañantes, aquí puedes pintarlos en una tabla o en chips.</div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
                </template>
            </Dialog>

            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '30rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar la programación <b>Id:{{ current?.id }}</b> — <b>{{ getNombrePractica(current) }}</b
                    >?
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

            <ProgramacionRutaDialog v-model:visible="routeDialog" :sedes="sedes" :originOverride="null" @picked="onRoutePicked" />
        </template>
    </div>
</template>
