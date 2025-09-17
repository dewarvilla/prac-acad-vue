<script setup>
import { FilterMatchMode } from '@primevue/core/api';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import axios from 'axios';

onMounted(() => {
    getProducts();
});

async function getProducts() {
    const response = await axios.get('http://127.0.0.1:8000/api/v1/creaciones');
    products.value = Array.isArray(response.data) ? response.data : response.data.data;
}

const toast = useToast();
const dt = ref(null);
const products = ref([]);
const product = ref({});
const productDialog = ref(false);
const deleteProductDialog = ref(false);
const deleteProductsDialog = ref(false);
const selectedProducts = ref([]);
const filters = ref({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS }
});
const submitted = ref(false);
const dropdownNivelAcademico = ref([
    { name: 'Pregrado', code: 'pregrado' },
    { name: 'Postgrado', code: 'postgrado' }
]);

function openNew() {
    product.value = {
        nivelAcademico: '',
        facultad: '',
        programaAcademico: '',
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: ''
    };
    submitted.value = false;
    productDialog.value = true;
}

function hideDialog() {
    productDialog.value = false;
    submitted.value = false;
}

async function saveProduct() {
    submitted.value = true;

    if (product?.value.nombrePractica?.trim()) {
        if (product.value.id) {
            /* product.value.inventoryStatus = product.value.inventoryStatus.value ? product.value.inventoryStatus.value : product.value.inventoryStatus;
            products.value[findIndexById(product.value.id)] = product.value; */
            await axios.patch(`http://127.0.0.1:8000/api/v1/creaciones/${product.value.id}`, product.value);
            toast.add({ severity: 'success', summary: 'Successful', detail: 'Product Updated', life: 3000 });
        } else {
            /*  product.value.id = createId();
            product.value.code = createId();
            product.value.image = 'product-placeholder.svg';
            product.value.inventoryStatus = product.value.inventoryStatus ? product.value.inventoryStatus.value : 'INSTOCK'; */
            await axios.post('http://127.0.0.1:8000/api/v1/creaciones', product.value);
            await getProducts();
            toast.add({ severity: 'success', summary: 'Successful', detail: 'Product Created', life: 3000 });
        }

        productDialog.value = false;
        product.value = {};
        getProducts();
    }
}

function editProduct(prod) {
    product.value = { ...prod };
    productDialog.value = true;
}

function confirmDeleteProduct(prod) {
    product.value = prod;
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    await axios.delete(`http://127.0.0.1:8000/api/v1/creaciones/${product.value.id}`);
    products.value = products.value.filter((val) => val.id !== product.value.id);
    deleteProductDialog.value = false;
    product.value = {};
    toast.add({ severity: 'success', summary: 'Successful', detail: 'Product Deleted', life: 3000 });
}

/* function findIndexById(id) {
    let index = -1;
    for (let i = 0; i < products.value.length; i++) {
        if (products.value[i].id === id) {
            index = i;
            break;
        }
    }

    return index;
} */

/* function createId() {
    let id = '';
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 5; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

function exportCSV() {
    dt.value.exportCSV();
} */

function confirmDeleteSelected() {
    deleteProductsDialog.value = true;
}

async function deleteSelectedProducts() {
    const ids = selectedProducts.value.map((p) => p.id);
    await Promise.all(ids.map((id) => axios.delete(`http://127.0.0.1:8000/api/v1/creaciones/${id}`)));
    products.value = products.value.filter((val) => !ids.includes(val.id));
    deleteProductsDialog.value = false;
    selectedProducts.value = [];
    toast.add({ severity: 'success', summary: 'Successful', detail: 'Products Deleted', life: 3000 });
}

/* function getStatusLabel(status) {
    switch (status) {
        case 'INSTOCK':
            return 'success';

        case 'LOWSTOCK':
            return 'warn';

        case 'OUTOFSTOCK':
            return 'danger';

        default:
            return null;
    }
} */
</script>

<template>
    <div>
        <div class="card">
            <Toolbar class="mb-6">
                <template #start>
                    <Button label="Crear" icon="pi pi-plus" severity="secondary" class="mr-2" @click="openNew" />
                    <Button label="Borrar" icon="pi pi-trash" severity="secondary" @click="confirmDeleteSelected" :disabled="!selectedProducts || !selectedProducts.length" />
                </template>

                <!-- <template #end>
                    <Button label="Export" icon="pi pi-upload" severity="secondary" @click="exportCSV($event)" />
                </template> -->
            </Toolbar>

            <DataTable
                ref="dt"
                v-model:selection="selectedProducts"
                :value="products"
                dataKey="id"
                :paginator="true"
                :rows="10"
                :filters="filters"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
                :rowsPerPageOptions="[5, 10, 25]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
            >
                <template #header>
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                        <h4 class="m-0">Prácticas Académicas</h4>
                        <IconField>
                            <InputIcon>
                                <i class="pi pi-search" />
                            </InputIcon>
                            <InputText v-model="filters['global'].value" placeholder="Buscar..." />
                        </IconField>
                    </div>
                </template>

                <Column selectionMode="multiple" style="width: 3rem" :exportable="false"></Column>
                <Column field="id" header="id" sortable style="min-width: 8rem"></Column>
                <Column field="nombrePractica" header="Nombre Práctica" sortable style="min-width: 16rem"></Column>
                <!-- <Column header="Image">
                    <template #body="slotProps">
                        <img :src="`https://primefaces.org/cdn/primevue/images/product/${slotProps.data.image}`" :alt="slotProps.data.image" class="rounded" style="width: 64px" />
                    </template>
                </Column> --><!-- 
                <Column field="price" header="Price" sortable style="min-width: 8rem">
                    <template #body="slotProps">
                        {{ formatCurrency(slotProps.data.price) }}
                    </template>
                </Column> -->
                <Column field="facultad" header="Facultad" sortable style="min-width: 10rem"></Column>
                <Column field="nivelAcademico" header="Nivel Académico" sortable style="min-width: 10rem"></Column>
                <Column field="programaAcademico" header="Programa Académico" sortable style="min-width: 10rem"> </Column>
                <Column field="recursosNecesarios" header="Recursos Necesarios" sortable style="min-width: 10rem"></Column>
                <Column field="justificacion" header="Justificación" sortable style="min-width: 10rem"></Column>
                <!-- <template #body="slotProps">
                    <Rating :modelValue="slotProps.data.rating" :readonly="true" />
                </template> -->
                <!--</Column>
                <Column field="inventoryStatus" header="Status" sortable style="min-width: 12rem">
                    <template #body="slotProps">
                        <Tag :value="slotProps.data.inventoryStatus" :severity="getStatusLabel(slotProps.data.inventoryStatus)" />
                    </template>
                </Column>  -->
                <Column :exportable="false" style="min-width: 12rem">
                    <template #body="slotProps">
                        <Button icon="pi pi-pencil" outlined rounded class="mr-2" @click="editProduct(slotProps.data)" />
                        <Button icon="pi pi-trash" outlined rounded severity="danger" @click="confirmDeleteProduct(slotProps.data)" />
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="productDialog" :style="{ width: '40vw', maxWidth: '840px' }" header="Creación de práctica" :modal="true">
            <Fluid>
                <div class="flex flex-col gap-6">
                    <div class="md:w-full">
                        <div class="card flex flex-col gap-4">
                            <div class="flex flex-col gap-2">
                                <label for="nombrePractica">Nombre de Práctica Académica</label>
                                <InputText id="nombrePractica" v-model.trim="product.nombrePractica" type="text" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>

                            <div class="flex flex-wrap gap-2 w-full">
                                <label for="nivelAcademico">Nivel Académico</label>
                                <Select id="nivelAcademico" v-model="product.nivelAcademico" :options="dropdownNivelAcademico" optionLabel="name" optionValue="code" placeholder="Nivel Académico" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>

                            <div class="flex flex-col gap-2">
                                <label for="facultad">Facultad</label>
                                <InputText id="facultad" v-model.trim="product.facultad" type="text" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>

                            <div class="flex flex-col gap-2">
                                <label for="programaAcademico">Programa Académico</label>
                                <InputText id="programaAcademico" v-model.trim="product.programaAcademico" type="text" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>

                            <div class="flex flex-col gap-2">
                                <label for="recursosNecesarios">Recursos Necesarios</label>
                                <InputText id="recursosNecesarios" v-model.trim="product.recursosNecesarios" type="text" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>

                            <div class="flex flex-wrap">
                                <label for="justificacion">Justificación de la necesidad de la práctica y recursos</label>
                                <Textarea id="justificacion" v-model.trim="product.justificacion" rows="4" fluid />
                                <small>Este Campo es Requerido.</small>
                            </div>
                        </div>
                    </div>
                </div>
            </Fluid>

            <!-- El slot debe ir AQUÍ, como hijo directo de Dialog -->
            <template #footer>
                <Button label="Guardar" icon="pi pi-check" @click="saveProduct" />
                <Button label="Cancelar" icon="pi pi-times" text @click="hideDialog" />
            </template>
        </Dialog>

        <!-- Confirmar borrado de UN registro -->
        <Dialog v-model:visible="deleteProductDialog" :style="{ width: '450px' }" header="Confirmar" :modal="true">
            <div class="flex items-center gap-4">
                <i class="pi pi-exclamation-triangle !text-3xl" />
                <span v-if="product">
                    ¿Seguro que quieres eliminar <b>{{ product.nombrePractica }}</b
                    >?
                </span>
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>
        <Dialog v-model:visible="deleteProductsDialog" :style="{ width: '450px' }" header="Confirmar" :modal="true">
            <div class="flex items-center gap-4">
                <i class="pi pi-exclamation-triangle !text-3xl" />
                <span>¿Seguro que quieres eliminar los registros seleccionados?</span>
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductsDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteSelectedProducts" />
            </template>
        </Dialog>
    </div>
</template>
