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
    const st = row?.estado_creacion ?? row?.estadoCreacion ?? row?.estado_creacion ?? row?.estadoCreacion;
    return String(st || '').toLowerCase() === 'rechazada';
};

const canEditRow = (row) => canEditCreaciones.value && isRejected(row);
const canDeleteRow = (row) => canDeleteCreaciones.value && isRejected(row);

const canBulkDelete = computed(() => canDeleteCreaciones.value && selected.value.length > 0 && selected.value.every(isRejected));

// -------------------------
// Permisos de aprobación
// -------------------------
const CRE_APPROVE_PERMS = ['approvals.aprobar.comite_acreditacion', 'approvals.aprobar.consejo_facultad', 'approvals.aprobar.consejo_academico'];

const CRE_REJECT_PERMS = ['approvals.rechazar.comite_acreditacion', 'approvals.rechazar.consejo_facultad', 'approvals.rechazar.consejo_academico'];

const isCreacionesApprover = computed(() => [...CRE_APPROVE_PERMS, ...CRE_REJECT_PERMS].some((p) => hasPerm(p)));

const isApproverMode = computed(() => isCreacionesApprover.value);
const canAccessModule = computed(() => isApproverMode.value || canViewCreaciones.value);

const currentActorKey = computed(() => {
    if (hasPerm('approvals.aprobar.comite_acreditacion') || hasPerm('approvals.rechazar.comite_acreditacion')) return 'comite_acreditacion';
    if (hasPerm('approvals.aprobar.consejo_facultad') || hasPerm('approvals.rechazar.consejo_facultad')) return 'consejo_facultad';
    if (hasPerm('approvals.aprobar.consejo_academico') || hasPerm('approvals.rechazar.consejo_academico')) return 'consejo_academico';
    return null;
});

const canApproveAtStage = computed(() => {
    const k = currentActorKey.value;
    if (k === 'comite_acreditacion') return hasPerm('approvals.aprobar.comite_acreditacion');
    if (k === 'consejo_facultad') return hasPerm('approvals.aprobar.consejo_facultad');
    if (k === 'consejo_academico') return hasPerm('approvals.aprobar.consejo_academico');
    return false;
});

const canRejectAtStage = computed(() => {
    const k = currentActorKey.value;
    if (k === 'comite_acreditacion') return hasPerm('approvals.rechazar.comite_acreditacion');
    if (k === 'consejo_facultad') return hasPerm('approvals.rechazar.consejo_facultad');
    if (k === 'consejo_academico') return hasPerm('approvals.rechazar.consejo_academico');
    return false;
});

// -------------------------
// Endpoints
// -------------------------
const API_CRE = '/creaciones';
const API_INBOX = '/approvals/inbox';
const API_APPROVAL_REQUESTS = '/approval-requests';

const API_ACA_PROGRAMAS = '/academusoft/programas_academicos';
const API_ACA_MATERIAS = '/academusoft/materias';

const approvalEndpoints = {
    approve: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/approve`,
    reject: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/reject`,
    cancel: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/cancel`
};

function getApprovalRequestId(row) {
    return row?.approvalRequestId ?? row?.approval_request_id ?? row?.approval_request?.id ?? row?.approvalRequest?.id ?? null;
}
function getApprovalCurrentRoleKey(row) {
    return row?.approvalCurrentRoleKey ?? row?.approval_current_role_key ?? row?.approval_request?.current_role_key ?? row?.approvalRequest?.current_role_key ?? null;
}

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
const recId = `recursosNecesarios-${uid}`;
const jusId = `justificacion-${uid}`;

// -------------------------
// Utils normalización
// -------------------------
const s = (v) => (v == null ? '' : String(v));

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
// Programa (Autocomplete)
// -------------------------
const programaQuery = ref('');
const progSugs = ref([]);
const loadingProgs = ref(false);
const showProgPanel = ref(false);
const highlightedIndex = ref(-1);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function openProgPanel() {
    showProgPanel.value = true;
}
function closeProgPanel() {
    showProgPanel.value = false;
    highlightedIndex.value = -1;
}

async function fetchProgramas(query = '') {
    loadingProgs.value = true;
    try {
        const { data } = await api.get(API_ACA_PROGRAMAS);
        const items = Array.isArray(data) ? data : (data?.items ?? data?.data ?? []);

        const q = s(query).trim().toLowerCase();

        progSugs.value = items
            .filter((p) => !!p?.programa_activo)
            .filter((p) => {
                if (!q) return true;
                const name = s(p?.nombre_programa).toLowerCase();
                const code = s(p?.codigo_programa).toLowerCase();
                const fac = s(p?.facultad).toLowerCase();
                return name.includes(q) || code.includes(q) || fac.includes(q);
            })
            .slice(0, 20)
            .map((p) => ({
                codigoPrograma: s(p?.codigo_programa).trim(),
                nombrePrograma: s(p?.nombre_programa).trim(),
                nivelAcademico: s(p?.nivel_academico).trim(),
                facultad: s(p?.facultad).trim(),
                codigoFacultad: s(p?.codigo_facultad).trim(),
                label: `${s(p?.codigo_programa).trim()} - ${s(p?.nombre_programa).trim()}`.trim()
            }));
    } catch (e) {
        progSugs.value = [];
        toast.add({ severity: 'error', summary: 'Programas', detail: e?.response?.data?.message || e.message, life: 4000 });
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
            highlightedIndex.value = -1;
            return;
        }
        fetchProgramas(q);
    }, PROG_DEBOUNCE);
}

function onProgramaKeydown(e) {
    if (!showProgPanel.value || !progSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIndex.value = highlightedIndex.value < progSugs.value.length - 1 ? highlightedIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex.value = highlightedIndex.value > 0 ? highlightedIndex.value - 1 : progSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex.value >= 0) selectPrograma(progSugs.value[highlightedIndex.value]);
        else {
            touched.programa = true;
            validateField('programa');
            closeProgPanel();
        }
    }
}

function selectPrograma(it) {
    product.value.programa = it;
    programaQuery.value = it.label || it.nombrePrograma || '';

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.programa = true;
    validateField('programa');
    if (touched.materia) validateField('materia');

    closeProgPanel();
}
function onProgramaEnter() {
    touched.programa = true;
    validateField('programa');
    closeProgPanel();
}
function clearPrograma() {
    programaQuery.value = '';
    progSugs.value = [];
    highlightedIndex.value = -1;

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
// Materia (Autocomplete)
// -------------------------
const materiaQuery = ref('');
const matSugs = ref([]);
const loadingMats = ref(false);
const showMatPanel = ref(false);
const highlightedMatIndex = ref(-1);
let matTimer = null;
const MAT_DEBOUNCE = 250;

function openMatPanel() {
    showMatPanel.value = true;
}
function closeMatPanel() {
    showMatPanel.value = false;
    highlightedMatIndex.value = -1;
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

        const { data } = await api.get(API_ACA_MATERIAS, { params: { codigo_programa: codigoPrograma } });
        const items = Array.isArray(data) ? data : (data?.items ?? data?.data ?? []);

        const q = s(query).trim().toLowerCase();

        matSugs.value = items
            .filter((m) => !!m?.materia_activa)
            .filter((m) => !m?.codigo_programa || s(m.codigo_programa) === s(codigoPrograma))
            .filter((m) => {
                if (!q) return true;
                const name = s(m?.nombre_materia).toLowerCase();
                const code = s(m?.codigo_materia).toLowerCase();
                return name.includes(q) || code.includes(q);
            })
            .slice(0, 20)
            .map((m) => ({
                codigoPrograma: s(m?.codigo_programa || codigoPrograma).trim(),
                codigoMateria: s(m?.codigo_materia).trim(),
                nombreMateria: s(m?.nombre_materia).trim(),
                label: `${s(m?.codigo_materia).trim()} - ${s(m?.nombre_materia).trim()}`.trim()
            }));
    } catch (e) {
        matSugs.value = [];
        toast.add({ severity: 'error', summary: 'Materias', detail: e?.response?.data?.message || e.message, life: 4000 });
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
        if (highlightedMatIndex.value >= 0) selectMateria(matSugs.value[highlightedMatIndex.value]);
        else {
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

function onMateriaEnter() {
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
// Parametrización (sort/search/paginación)
// -------------------------
const SORT_MAP_CRE = {
    id: 'id',
    nombrePractica: 'nombre_practica',
    estadoCreacion: 'estado_creacion',
    estado: 'estado',
    codigoFacultad: 'codigo_facultad',
    codigoPrograma: 'codigo_programa',
    codigoMateria: 'codigo_materia',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
};

const SORT_MAP_INBOX = {
    id: 'id',
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
                return compareValues(a.nombrePractica ?? a.nombre_practica, b.nombrePractica ?? b.nombre_practica, order);

            case 'codigoPrograma':
                return compareValues(a.codigoPrograma, b.codigoPrograma, order);

            case 'codigoMateria':
                return compareValues(a.codigoMateria, b.codigoMateria, order);

            case 'estadoCreacion':
                return compareValues(a.estadoCreacion ?? a.estado_creacion, b.estadoCreacion ?? b.estado_creacion, order);

            case 'id':
                return compareValues(a.id, b.id, order);

            case 'createdAt':
                return compareValues(a.createdAt ?? a.created_at, b.createdAt ?? b.created_at, order);

            case 'updatedAt':
                return compareValues(a.updatedAt ?? a.updated_at, b.updatedAt ?? b.updated_at, order);

            default:
                return 0;
        }
    });

    return sorted;
}

const sortParamCre = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_CRE));
const sortParamInbox = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_INBOX));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = isApproverMode.value ? sortParamInbox.value : sortParamCre.value;
    if (sp) params.sort = sp;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

// -------------------------
// Inbox helpers (ocultar inmediatamente al decidir)
// -------------------------
function removeInboxItem(approvalRequestId) {
    if (!approvalRequestId) return;
    products.value = products.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    selected.value = selected.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    total.value = Number(products.value.length);
}

function isActionable(row) {
    const status = row?.approvalStatus ?? row?._approval?.status;
    const isCurrent = row?.approvalIsCurrent ?? row?._approval?.is_current ?? row?._approval?.isCurrent;

    if (status && String(status).toLowerCase() !== 'pending') return false;
    if (isCurrent === false) return false;

    return true;
}

function canApproveRow(row) {
    if (!isApproverMode.value) return false;
    if (!currentActorKey.value) return false;
    if (!canApproveAtStage.value) return false;

    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return false;

    if (!isActionable(row)) return false;

    const roleKey = getApprovalCurrentRoleKey(row);
    if (roleKey && roleKey !== currentActorKey.value) return false;

    return true;
}

function canRejectRow(row) {
    if (!isApproverMode.value) return false;
    if (!currentActorKey.value) return false;
    if (!canRejectAtStage.value) return false;

    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return false;

    if (!isActionable(row)) return false;

    const roleKey = getApprovalCurrentRoleKey(row);
    if (roleKey && roleKey !== currentActorKey.value) return false;

    return true;
}

// -------------------------
// Normalizador Inbox (nuevo esquema Creación)
// -------------------------
function normalizeInboxItem(ar) {
    const raw = ar?.data ? ar.data : ar;
    const a = raw?.approvable?.data ?? raw?.approvable ?? {};

    const programa = a?.programa ?? null;
    const materia = a?.materia ?? null;

    return {
        _mode: 'inbox',

        approvalRequestId: raw?.id ?? null,
        approvalStatus: raw?.status ?? null,
        approvalIsCurrent: raw?.is_current ?? raw?.isCurrent ?? null,
        approvalCurrentRoleKey: raw?.current_role_key ?? raw?.currentRoleKey ?? null,
        approvalDefinitionCode: raw?.definition?.code ?? raw?.definition_code ?? null,

        id: a?.id ?? raw?.approvable_id ?? raw?.id ?? null,

        programa,
        materia,

        codigoPrograma: programa?.codigoPrograma ?? a?.codigoPrograma ?? a?.codigo_programa ?? null,
        codigoMateria: materia?.codigoMateria ?? a?.codigoMateria ?? a?.codigo_materia ?? null,

        nombrePractica: a?.nombrePractica ?? a?.nombre_practica ?? '',
        estadoCreacion: a?.estadoCreacion ?? a?.estado_creacion ?? 'en_aprobacion',
        recursosNecesarios: a?.recursosNecesarios ?? a?.recursos_necesarios ?? '',
        justificacion: a?.justificacion ?? '',

        comentarioRechazo: a?.comentarioRechazo ?? a?.comentario_rechazo ?? '',
        rolRechazo: a?.rolRechazo ?? a?.rol_rechazo ?? '',
        rolRechazoLabel: a?.rolRechazoLabel ?? a?.rol_rechazo_label ?? '',
        fechaRechazo: a?.fechaRechazo ?? a?.fecha_rechazo ?? null,

        createdAt: a?.createdAt ?? a?.created_at ?? raw?.created_at ?? null,
        updatedAt: a?.updatedAt ?? a?.updated_at ?? raw?.updated_at ?? null
    };
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
            const { data } = await api.get(API_CRE, { params: buildParams({ force }), signal });

            if (Array.isArray(data)) {
                products.value = data;
                total.value = data.length;
            } else {
                products.value = data.data ?? [];
                total.value = Number(data.meta?.total ?? products.value.length);
                if (data.meta?.current_page) page.value = Number(data.meta.current_page);
                if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
            }
            return;
        }

        const { data } = await api.get(API_INBOX, { params: buildParams({ force }), signal });

        const items = Array.isArray(data) ? data : (data.data ?? []);
        const normalized = items.map(normalizeInboxItem);

        let onlyCreaciones = normalized.filter((x) => !x.approvalDefinitionCode || x.approvalDefinitionCode === 'CREACION_PRACTICA');

        if (currentActorKey.value) {
            onlyCreaciones = onlyCreaciones.filter((x) => {
                const rk = getApprovalCurrentRoleKey(x);
                return rk ? rk === currentActorKey.value : true;
            });
        }

        const sortedInbox = sortInboxItems(onlyCreaciones);

        products.value = sortedInbox;
        total.value = sortedInbox.length;

        if (!Array.isArray(data)) {
            if (data.meta?.current_page) page.value = Number(data.meta.current_page);
            if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
        }
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';
        if (!canceled) {
            const status = e?.response?.status;
            const msg = e?.response?.data?.message || e.message;
            toast.add({ severity: 'error', summary: 'Error al cargar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6500 });
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
// Acciones aprobar/rechazar
// -------------------------
const approveLoading = ref(false);

async function approveRow(row) {
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) {
        toast.add({ severity: 'warn', summary: 'Sin solicitud', detail: 'No hay solicitud de aprobación asociada.', life: 4500 });
        return;
    }

    try {
        approveLoading.value = true;
        const { data } = await api.post(approvalEndpoints.approve(approvalRequestId));

        if (data?.ok === false) {
            toast.add({ severity: 'warn', summary: 'No se pudo aprobar', detail: data?.message || 'Operación rechazada.', life: 5000 });
            return;
        }

        removeInboxItem(approvalRequestId);
        await getProducts({ force: true });

        toast.add({ severity: 'success', summary: 'Aprobado', detail: 'Aprobación registrada.', life: 3000 });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;

        if (
            String(msg || '')
                .toLowerCase()
                .includes('finalizada')
        ) {
            removeInboxItem(approvalRequestId);
            await getProducts({ force: true });
        }

        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede aprobar' : 'Error al aprobar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6500
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
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) {
        toast.add({ severity: 'warn', summary: 'Sin solicitud', detail: 'No hay solicitud de aprobación asociada.', life: 4500 });
        return;
    }
    rejectTarget.value = { row, approvalRequestId };
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

    try {
        rejectLoading.value = true;

        const { data } = await api.post(approvalEndpoints.reject(target.approvalRequestId), {
            comment: rejectJustificacion.value.trim()
        });

        if (data?.ok === false) {
            rejectError.value = data?.message || 'Operación rechazada.';
            return;
        }

        removeInboxItem(target.approvalRequestId);
        await getProducts({ force: true });

        toast.add({ severity: 'success', summary: 'Rechazado', detail: 'Rechazo registrado.', life: 3000 });
        closeRejectDialog();
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;

        if (
            String(msg || '')
                .toLowerCase()
                .includes('finalizada')
        ) {
            removeInboxItem(target.approvalRequestId);
            await getProducts({ force: true });
            closeRejectDialog();
        }

        rejectError.value = `[${status ?? 'ERR'}] ${msg}`;
    } finally {
        rejectLoading.value = false;
    }
}

// -------------------------
// CRUD (NO aprobador) + Detalles
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
            const reqs = selected.value.map((r) => api.get(`${API_CRE}/${r.id}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => r.value.data?.data ?? r.value.data)
                .filter(Boolean);
        } else {
            const reqs = selected.value.map((r) => api.get(`${API_APPROVAL_REQUESTS}/${getApprovalRequestId(r)}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => {
                    const ar = r.value.data?.data ?? r.value.data;
                    return ar?.approvable?.data ?? null;
                })
                .filter(Boolean);
        }
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

const product = ref({
    id: null,
    programa: null,
    materia: null,
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: '',
    comentarioRechazo: '',
    rolRechazoLabel: ''
});

const errors = reactive({
    programa: '',
    materia: '',
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});

const touched = reactive({
    programa: false,
    materia: false,
    nombrePractica: false,
    recursosNecesarios: false,
    justificacion: false
});

const rules = {
    programa: [(v) => !!v?.codigoPrograma || 'Requerido.'],
    materia: [(v) => !!v?.codigoMateria || 'Requerido.'],
    nombrePractica: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    justificacion: [(v) => !!v || 'Requerido.']
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
        programa: null,
        materia: null,
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: '',
        comentarioRechazo: '',
        rolRechazoLabel: ''
    };

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
    const prog = getProgramaFromRow(row);
    const mat = getMateriaFromRow(row);

    product.value = {
        id: row.id ?? null,
        programa: prog,
        materia: mat,
        nombrePractica: row.nombrePractica ?? row.nombre_practica ?? '',
        recursosNecesarios: row.recursosNecesarios ?? row.recursos_necesarios ?? '',
        justificacion: row.justificacion ?? '',
        comentarioRechazo: row.comentarioRechazo ?? row.comentario_rechazo ?? '',
        rolRechazoLabel: row.rolRechazoLabel ?? row.rol_rechazo_label ?? ''
    };

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
// Confirmación antes de guardar (crear/editar)
// -------------------------
const confirmSaveDialog = ref(false);
const pendingSaveAction = ref(null); // 'create' | 'edit'
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
            toast.add({ severity: 'success', summary: 'Actualizado', detail: 'La práctica fue actualizada y volvió a aprobación.', life: 3500 });
        } else {
            await api.post(API_CRE, payload);
            toast.add({ severity: 'success', summary: 'Creado', detail: 'La práctica fue creada y enviada a aprobación.', life: 3500 });
        }

        productDialog.value = false;
        closeConfirmSave();
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            const detail = summarizeValidationErrors(data?.errors) || data?.message || 'Los datos enviados son inválidos.';
            toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail, life: 6500 });
            closeConfirmSave();
            return;
        }

        const msg = data?.message || data?.error || e.message;
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

    const fields = ['programa', 'materia', 'nombrePractica', 'recursosNecesarios', 'justificacion'];
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
        codigo_programa: product.value.programa?.codigoPrograma ?? null,
        codigo_materia: product.value.materia?.codigoMateria ?? null,
        nombre_practica: product.value.nombrePractica,
        recursos_necesarios: product.value.recursosNecesarios,
        justificacion: product.value.justificacion
    };

    const action = product.value.id ? 'edit' : 'create';
    openConfirmSave(action, payload);
}

// delete individual + bulk
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
        toast.add({ severity: 'error', summary: 'No se pudo eliminar', detail: String(e?.response?.data?.message || e.message), life: 5000 });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);
function confirmBulkDelete() {
    if (!canBulkDelete.value) {
        toast.add({ severity: 'warn', summary: 'No se puede eliminar', detail: 'Solo puedes eliminar creaciones en estado "rechazada".', life: 4500 });
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

// bloquear space en el form
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
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Creaciones</h2>
                <span v-if="isApproverMode" class="text-sm text-surface-500">Modo aprobador</span>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="!isApproverMode && canCreateCreaciones" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="!isApproverMode && canDeleteCreaciones" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
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
                tableStyle="width: 100%; min-width: 1150px;"
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

                <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 16rem; max-width: 34rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="data.nombrePractica ?? data.nombre_practica">
                            {{ data.nombrePractica ?? data.nombre_practica }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoPrograma" header="Programa académico" sortable style="min-width: 18rem; max-width: 28rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden" style="-webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical" v-tooltip.top="programaRowLabel(data)">
                            {{ programaRowLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="codigoMateria" header="Materia" sortable style="min-width: 18rem; max-width: 30rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden" style="-webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical" v-tooltip.top="materiaRowLabel(data)">
                            {{ materiaRowLabel(data) }}
                        </span>
                    </template>
                </Column>

                <Column field="estadoCreacion" header="Estado" sortable style="width: 12rem; max-width: 12rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estadoCreacion ?? data.estado_creacion)" :severity="estadoSeverity(data.estadoCreacion ?? data.estado_creacion)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:11rem">
                    <template #body="{ data }">
                        <!-- APROBADOR: solo aprobar/rechazar -->
                        <template v-if="isApproverMode">
                            <Button v-if="canApproveRow(data)" icon="pi pi-check" rounded text severity="success" class="mr-1" :disabled="approveLoading" @click.stop="approveRow(data)" />
                            <Button v-if="canRejectRow(data)" icon="pi pi-times" rounded text severity="warning" class="mr-1" :disabled="approveLoading" @click.stop="openRejectDialog(data)" />
                        </template>

                        <!-- CREADOR: editar/borrar -->
                        <template v-else>
                            <Button v-if="canEditRow(data)" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                            <Button v-if="canDeleteRow(data)" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                        </template>
                    </template>
                </Column>
            </DataTable>

            <!-- Crear/Editar -->
            <Dialog v-if="!isApproverMode" v-model:visible="productDialog" header="Creación de práctica" :style="{ width: '36rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div v-if="product.comentarioRechazo" class="p-3 rounded border border-red-200 bg-red-50">
                        <div class="font-semibold text-red-700 mb-1">Motivo del rechazo</div>
                        <div class="text-sm text-red-700 whitespace-pre-line">
                            {{ product.comentarioRechazo }}
                        </div>
                        <div v-if="product.rolRechazoLabel" class="text-xs text-surface-500 mt-2">Rechazado por: {{ product.rolRechazoLabel }}</div>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="nombrePractica">Nombre práctica</label>
                        <InputText id="nombrePractica" name="nombrePractica" v-model.trim="product.nombrePractica" :invalid="showError('nombrePractica')" @blur="onBlur('nombrePractica')" @keydown.space.stop fluid />
                        <small v-if="showError('nombrePractica')" class="text-red-500">{{ errors.nombrePractica }}</small>
                    </div>

                    <div class="flex flex-col gap-2 relative">
                        <label for="programaAcademico">Programa académico</label>

                        <IconField class="w-full relative">
                            <InputIcon :class="loadingProgs ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                            <InputText
                                id="programaAcademico"
                                name="programaAcademico"
                                :invalid="showError('programa')"
                                :class="{ 'rounded-b-none': showProgPanel }"
                                v-model.trim="programaQuery"
                                placeholder="Escribe para buscar…"
                                class="w-full h-10 leading-10 pl-9 pr-8"
                                autocomplete="off"
                                role="combobox"
                                aria-autocomplete="list"
                                :aria-expanded="showProgPanel ? 'true' : 'false'"
                                :aria-controls="'prog-listbox'"
                                :aria-activedescendant="highlightedIndex >= 0 ? 'prog-opt-' + highlightedIndex : undefined"
                                @focus="openProgPanel"
                                @input="onProgramaInput"
                                @blur="onBlur('programa')"
                                @keydown="onProgramaKeydown"
                                @keydown.enter.prevent="onProgramaEnter"
                                @keydown.esc.prevent="closeProgPanel"
                            />
                            <span v-if="programaQuery" class="pi pi-times cursor-pointer absolute right-3 top-1/2 -translate-y-1/2" @click="clearPrograma" aria-label="Limpiar filtro de programa" />
                        </IconField>

                        <div
                            v-if="showProgPanel && progSugs.length"
                            id="prog-listbox"
                            role="listbox"
                            class="absolute left-0 right-0 top-full -mt-px max-h-72 overflow-auto z-50 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            <div
                                v-for="(it, i) in progSugs"
                                :key="it.codigoPrograma"
                                :id="'prog-opt-' + i"
                                role="option"
                                :aria-selected="i === highlightedIndex ? 'true' : 'false'"
                                class="px-3 py-2 cursor-pointer select-none"
                                :class="i === highlightedIndex ? 'bg-primary-50' : ''"
                                @mouseenter="highlightedIndex = i"
                                @mouseleave="highlightedIndex = -1"
                                @mousedown.prevent
                                @click="selectPrograma(it)"
                            >
                                <div class="text-sm font-medium">{{ it.label || it.nombrePrograma }}</div>
                                <div class="text-xs text-surface-500" v-if="it.facultad">Facultad: {{ it.facultad }}</div>
                            </div>
                        </div>

                        <div
                            v-else-if="showProgPanel && !loadingProgs && programaQuery && !progSugs.length"
                            class="absolute left-0 right-0 top-full -mt-px z-50 px-3 py-2 text-sm text-surface-500 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            Sin coincidencias
                        </div>

                        <small v-if="showError('programa')" class="text-red-500">{{ errors.programa }}</small>
                    </div>

                    <div class="flex flex-col gap-2 relative">
                        <label for="materia">Materia</label>

                        <IconField class="w-full relative">
                            <InputIcon :class="loadingMats ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                            <InputText
                                id="materia"
                                name="materia"
                                :disabled="!product.programa"
                                :invalid="showError('materia')"
                                :class="{ 'rounded-b-none': showMatPanel }"
                                v-model.trim="materiaQuery"
                                placeholder="Escribe para buscar…"
                                class="w-full h-10 leading-10 pl-9 pr-8"
                                autocomplete="off"
                                role="combobox"
                                aria-autocomplete="list"
                                :aria-expanded="showMatPanel ? 'true' : 'false'"
                                :aria-controls="'mat-listbox'"
                                :aria-activedescendant="highlightedMatIndex >= 0 ? 'mat-opt-' + highlightedMatIndex : undefined"
                                @focus="openMatPanel"
                                @input="onMateriaInput"
                                @blur="onBlur('materia')"
                                @keydown="onMateriaKeydown"
                                @keydown.enter.prevent="onMateriaEnter"
                                @keydown.esc.prevent="closeMatPanel"
                            />
                            <span v-if="materiaQuery" class="pi pi-times cursor-pointer absolute right-3 top-1/2 -translate-y-1/2" @click="clearMateria" aria-label="Limpiar filtro de materia" />
                        </IconField>

                        <small v-if="!product.programa" class="text-xs text-surface-500">Selecciona primero un programa académico.</small>

                        <div
                            v-if="showMatPanel && matSugs.length"
                            id="mat-listbox"
                            role="listbox"
                            class="absolute left-0 right-0 top-full -mt-px max-h-72 overflow-auto z-50 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            <div
                                v-for="(it, i) in matSugs"
                                :key="it.codigoMateria"
                                :id="'mat-opt-' + i"
                                role="option"
                                :aria-selected="i === highlightedMatIndex ? 'true' : 'false'"
                                class="px-3 py-2 cursor-pointer select-none"
                                :class="i === highlightedMatIndex ? 'bg-primary-50' : ''"
                                @mouseenter="highlightedMatIndex = i"
                                @mouseleave="highlightedMatIndex = -1"
                                @mousedown.prevent
                                @click="selectMateria(it)"
                            >
                                <div class="text-sm font-medium">{{ it.label || it.codigoMateria + ' - ' + it.nombreMateria }}</div>
                            </div>
                        </div>

                        <div
                            v-else-if="showMatPanel && !loadingMats && materiaQuery && !matSugs.length"
                            class="absolute left-0 right-0 top-full -mt-px z-50 px-3 py-2 text-sm text-surface-500 border border-surface-300 border-t-0 rounded-b-md rounded-t-none bg-surface-0 shadow-lg"
                        >
                            Sin coincidencias
                        </div>

                        <small v-if="showError('materia')" class="text-red-500">{{ errors.materia }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label :for="recId">Recursos necesarios</label>
                        <textarea :id="recId" name="recursosNecesarios" v-model.trim="product.recursosNecesarios" class="p-inputtextarea p-inputtext p-component w-full" rows="3" @blur="onBlur('recursosNecesarios')" @keydown.space.stop></textarea>
                        <small v-if="showError('recursosNecesarios')" class="text-red-500">{{ errors.recursosNecesarios }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label :for="jusId">Justificación</label>
                        <textarea :id="jusId" name="justificacion" v-model.trim="product.justificacion" class="p-inputtextarea p-inputtext p-component w-full" rows="3" @blur="onBlur('justificacion')" @keydown.space.stop></textarea>
                        <small v-if="showError('justificacion')" class="text-red-500">{{ errors.justificacion }}</small>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <!-- Confirmación guardar (crear/editar) -->
            <Dialog v-if="!isApproverMode" v-model:visible="confirmSaveDialog" header="Confirmar" :style="{ width: '30rem' }" :modal="true">
                <div class="space-y-2">
                    <p v-if="pendingSaveAction === 'create'">
                        Vas a <b>solicitar crear</b> esta práctica y se enviará a <b>aprobación</b>.<br />
                        Una vez enviada, <b>no podrás editarla ni eliminarla</b>. Solo se habilitará nuevamente la edición si en algún paso del flujo la práctica resulta <b>rechazada</b>.
                    </p>
                    <p v-else>
                        Vas a <b>actualizar</b> esta práctica. Al guardar, se enviará nuevamente a <b>aprobación</b>.<br />
                        Una vez reenviada, <b>no podrás editarla ni eliminarla</b>. Solo se habilitará nuevamente la edición si en algún paso del flujo la práctica resulta <b>rechazada</b>.
                    </p>
                    <div class="text-sm text-gray-600">
                        <div><b>Programa:</b> {{ product?.programa?.label || programaQuery || '—' }}</div>
                        <div><b>Nombre:</b> {{ product?.nombrePractica || '—' }}</div>
                        <div><b>Materia:</b> {{ product?.materia?.label || materiaQuery || '—' }}</div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="closeConfirmSave" />
                    <Button :label="pendingSaveAction === 'create' ? 'Crear y enviar' : 'Guardar y reenviar'" icon="pi pi-check" :loading="saving" :disabled="saving" @click="confirmSave" />
                </template>
            </Dialog>

            <!-- Confirmación borrado -->
            <Dialog v-if="!isApproverMode" v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar la creación <b>Id:{{ current?.id }}</b> — <b>{{ current?.nombrePractica ?? current?.nombre_practica }}</b
                    >?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <!-- Rechazo -->
            <Dialog v-model:visible="rejectDialog" header="Rechazar creación" :style="{ width: '30rem' }" :modal="true">
                <div v-if="rejectTarget">
                    <p class="mb-3">
                        Vas a rechazar la creación <b>Id: {{ rejectTarget.row.id }}</b> — <b>{{ rejectTarget.row.nombrePractica ?? rejectTarget.row.nombre_practica }}</b>
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

            <!-- Detalles -->
            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '46vw', maxWidth: '860px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-4 border rounded-lg p-3 sm:p-4">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                                <div class="text-base font-semibold break-words leading-snug">
                                    {{ d.nombrePractica ?? d.nombre_practica }}
                                </div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                <Tag :value="estadoLabel(d.estadoCreacion ?? d.estado_creacion)" :severity="estadoSeverity(d.estadoCreacion ?? d.estado_creacion)" />
                                <Tag :value="programaRowLabel(d)" severity="secondary" />
                                <Tag :value="materiaRowLabel(d)" severity="secondary" />
                            </div>
                        </div>
                        <div v-if="d.comentarioRechazo ?? d.comentario_rechazo" class="mt-4">
                            <div class="text-sm font-semibold mb-1 text-red-600">Observación del rechazo</div>
                            <div class="border rounded-md p-2 whitespace-pre-line break-words bg-red-50 border-red-200 text-red-700">
                                {{ d.comentarioRechazo ?? d.comentario_rechazo }}
                            </div>
                            <div v-if="d.rolRechazoLabel ?? d.rol_rechazo_label" class="text-xs text-surface-500 mt-2">Rechazado por: {{ d.rolRechazoLabel ?? d.rol_rechazo_label }}</div>
                        </div>

                        <div class="mt-4 space-y-4">
                            <div>
                                <div class="text-sm font-semibold mb-1">Recursos necesarios</div>
                                <div class="border rounded-md p-2 whitespace-pre-line break-words">
                                    {{ d.recursosNecesarios ?? d.recursos_necesarios ?? '—' }}
                                </div>
                            </div>
                            <div>
                                <div class="text-sm font-semibold mb-1">Justificación</div>
                                <div class="border rounded-md p-2 whitespace-pre-line break-words">
                                    {{ d.justificacion ?? '—' }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
                </template>
            </Dialog>

            <Dialog v-if="!isApproverMode" v-model:visible="bulkDeleteDialog" header="Confirmar eliminado" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar <b>{{ selected.length }}</b> {{ selected.length === 1 ? 'registro' : 'registros' }}?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
                </template>
            </Dialog>
        </template>
    </div>
</template>
