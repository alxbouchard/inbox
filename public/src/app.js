const CURRENT_USER_ID = 'user-tagger';
const STATUS_OPTIONS = [
  { value: 'nouvelle', label: 'Nouvelle' },
  { value: 'a_verifier', label: 'À vérifier' },
  { value: 'complete', label: 'Complète' },
  { value: 'archive', label: 'Archivée' },
  { value: 'ocr_error', label: 'Erreur OCR' },
];

const DOM = {
  invoiceList: document.getElementById('invoiceList'),
  invoiceTemplate: document.getElementById('invoiceItemTemplate'),
  tagTemplate: document.getElementById('tagTemplate'),
  tagList: document.getElementById('tagList'),
  tagFilter: document.getElementById('tagFilter'),
  statusFilter: document.getElementById('statusFilter'),
  periodFilter: document.getElementById('periodFilter'),
  searchInput: document.getElementById('searchInput'),
  emptyState: document.getElementById('emptyState'),
  detailEmpty: document.getElementById('detailEmpty'),
  detailContent: document.getElementById('detailContent'),
  detailVendor: document.getElementById('detailVendor'),
  detailSummary: document.getElementById('detailSummary'),
  statusSelect: document.getElementById('statusSelect'),
  preview: document.getElementById('preview'),
  appliedTags: document.getElementById('appliedTags'),
  tagPicker: document.getElementById('tagPicker'),
  ocrList: document.getElementById('ocrList'),
  chatPartner: document.getElementById('chatPartner'),
  chatList: document.getElementById('chatList'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
  toastAction: document.getElementById('toastAction'),
  openUploadDialog: document.getElementById('openUploadDialog'),
  uploadDialog: document.getElementById('uploadDialog'),
  uploadForm: document.getElementById('uploadForm'),
  tagForm: document.getElementById('tagForm'),
  toggleTagForm: document.getElementById('toggleTagForm'),
  cancelTagForm: document.getElementById('cancelTagForm'),
  removeTagDropzone: document.getElementById('removeTagDropzone'),
};

const state = {
  tags: [],
  invoices: [],
  filters: {
    search: '',
    status: 'all',
    tag: 'all',
    period: 'all',
  },
  selectedInvoiceId: null,
  selectedInvoice: null,
  messages: [],
  draggedTag: null,
};

let toastTimer = null;
let suppressDialogResetClose = false;
let toastActionHandler = null;
let undoState = null;
let applyDropDepth = 0;
let removeDropDepth = 0;

const API = {
  async fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    const isJson = response.headers.get('content-type')?.includes('application/json');
    if (!response.ok) {
      let message = `Erreur ${response.status}`;
      if (isJson) {
        try {
          const payload = await response.json();
          if (payload?.error) {
            message = payload.error;
          }
        } catch (_) {
          // ignore parse failure
        }
      }
      throw new Error(message);
    }
    if (!isJson || response.status === 204) {
      return null;
    }
    return response.json();
  },
  listTags() {
    return this.fetchJSON('/api/tags');
  },
  createTag(payload) {
    return this.fetchJSON('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  listInvoices(filters) {
    const params = new URLSearchParams({
      search: filters.search || '',
      status: filters.status || 'all',
      tag: filters.tag || 'all',
      period: filters.period || 'all',
    });
    return this.fetchJSON(`/api/invoices?${params.toString()}`);
  },
  getInvoice(id) {
    return this.fetchJSON(`/api/invoices/${id}`);
  },
  updateInvoice(id, payload) {
    return this.fetchJSON(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  addTag(invoiceId, tagId) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId, appliedByUserId: CURRENT_USER_ID }),
    });
  },
  removeTag(invoiceId, tagId) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/tags/${tagId}`, {
      method: 'DELETE',
    });
  },
  listMessages(invoiceId) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/messages`);
  },
  createMessage(invoiceId, body) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, fromUserId: CURRENT_USER_ID }),
    });
  },
  createInvoice(payload) {
    return this.fetchJSON('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
};

init().catch((error) => {
  console.error(error);
  showToast("Impossible de démarrer l'application", { type: 'error' });
});

async function init() {
  attachEventListeners();
  setupDragAndDrop();
  await Promise.all([loadTags(), loadInvoices({ initial: true })]);
}

function attachEventListeners() {
  DOM.searchInput.addEventListener('input', debounce(() => {
    state.filters.search = DOM.searchInput.value.trim();
    loadInvoices();
  }, 200));

  DOM.statusFilter.addEventListener('change', () => {
    state.filters.status = DOM.statusFilter.value;
    loadInvoices();
  });

  DOM.tagFilter.addEventListener('change', () => {
    state.filters.tag = DOM.tagFilter.value;
    loadInvoices();
  });

  DOM.periodFilter.addEventListener('change', () => {
    state.filters.period = DOM.periodFilter.value;
    loadInvoices();
  });

  DOM.chatForm.addEventListener('submit', handleChatSubmit);

  DOM.openUploadDialog.addEventListener('click', () => {
    if (typeof DOM.uploadDialog?.showModal !== 'function') {
      showToast('Votre navigateur ne supporte pas la fenêtre de dialogue.', { type: 'error' });
      return;
    }
    suppressDialogResetClose = true;
    DOM.uploadForm.reset();
    suppressDialogResetClose = false;
    DOM.uploadDialog.showModal();
    const firstField = DOM.uploadForm.querySelector('input, select, textarea');
    firstField?.focus();
  });

  DOM.uploadForm.addEventListener('reset', (event) => {
    if (suppressDialogResetClose) {
      return;
    }
    if (event.isTrusted && DOM.uploadDialog.open) {
      DOM.uploadDialog.close();
    }
  });

  DOM.uploadForm.addEventListener('submit', handleUploadSubmit);

  DOM.toggleTagForm.addEventListener('click', () => {
    const willShow = DOM.tagForm.hasAttribute('hidden');
    DOM.tagForm.toggleAttribute('hidden', !willShow);
    if (willShow) {
      DOM.tagForm.reset();
      DOM.tagForm.querySelector('input')?.focus();
    }
  });

  DOM.cancelTagForm.addEventListener('click', () => {
    DOM.tagForm.reset();
    DOM.tagForm.setAttribute('hidden', '');
  });

  DOM.tagForm.addEventListener('submit', handleTagSubmit);
}

function setupDragAndDrop() {
  if (DOM.preview) {
    DOM.preview.addEventListener('dragenter', handleApplyDragEnter);
    DOM.preview.addEventListener('dragover', handleApplyDragOver);
    DOM.preview.addEventListener('dragleave', handleApplyDragLeave);
    DOM.preview.addEventListener('drop', handleApplyDrop);
  }

  if (DOM.removeTagDropzone) {
    DOM.removeTagDropzone.addEventListener('dragenter', handleRemoveDragEnter);
    DOM.removeTagDropzone.addEventListener('dragover', handleRemoveDragOver);
    DOM.removeTagDropzone.addEventListener('dragleave', handleRemoveDragLeave);
    DOM.removeTagDropzone.addEventListener('drop', handleRemoveDrop);
  }
}

function registerDraggable(element, data) {
  if (!element) return;
  element.draggable = true;
  element.dataset.tagId = data.tagId;
  element.addEventListener('dragstart', (event) => handleTagDragStart(event, data));
  element.addEventListener('dragend', handleTagDragEnd);
}

function handleTagDragStart(event, data) {
  if (!event.dataTransfer) return;
  state.draggedTag = data;
  applyDropDepth = 0;
  removeDropDepth = 0;
  setPreviewDropState(false);
  setRemoveDropState(false);
  event.dataTransfer.effectAllowed = data.source === 'applied' ? 'move' : 'copy';
  try {
    event.dataTransfer.setData('application/x-inbox-tag', JSON.stringify(data));
  } catch (_) {
    // ignore custom mime type error
  }
  event.dataTransfer.setData('text/plain', data.tagId);
}

function handleTagDragEnd() {
  state.draggedTag = null;
  applyDropDepth = 0;
  removeDropDepth = 0;
  setPreviewDropState(false);
  setRemoveDropState(false);
}

function extractTagDragData(event) {
  const dt = event.dataTransfer;
  if (dt) {
    try {
      const payload = dt.getData('application/x-inbox-tag');
      if (payload) {
        return JSON.parse(payload);
      }
    } catch (_) {
      // ignore
    }
    const text = dt.getData('text/plain');
    if (text) {
      return { tagId: text, source: state.draggedTag?.source || 'unknown' };
    }
  }
  return state.draggedTag;
}

function canDropTagOnPreview(data) {
  if (!data || !data.tagId || !state.selectedInvoice) {
    return false;
  }
  return !state.selectedInvoice.tags?.some((link) => link.tagId === data.tagId);
}

function setPreviewDropState(active) {
  if (!DOM.preview) return;
  DOM.preview.dataset.dropActive = active ? 'true' : 'false';
}

function handleApplyDragEnter(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnPreview(data)) return;
  applyDropDepth += 1;
  setPreviewDropState(true);
  event.preventDefault();
}

function handleApplyDragOver(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnPreview(data)) {
    setPreviewDropState(false);
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  setPreviewDropState(true);
}

function handleApplyDragLeave(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnPreview(data)) {
    return;
  }
  applyDropDepth = Math.max(0, applyDropDepth - 1);
  if (applyDropDepth === 0) {
    setPreviewDropState(false);
  }
}

function handleApplyDrop(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnPreview(data)) {
    setPreviewDropState(false);
    return;
  }
  event.preventDefault();
  applyDropDepth = 0;
  setPreviewDropState(false);
  applyTag(data.tagId);
}

function canDropTagOnRemove(data) {
  if (!data || !data.tagId || !state.selectedInvoice) {
    return false;
  }
  return state.selectedInvoice.tags?.some((link) => link.tagId === data.tagId);
}

function setRemoveDropState(active) {
  if (!DOM.removeTagDropzone) return;
  if (DOM.removeTagDropzone.getAttribute('aria-disabled') === 'true') {
    DOM.removeTagDropzone.dataset.active = 'false';
    return;
  }
  DOM.removeTagDropzone.dataset.active = active ? 'true' : 'false';
}

function setRemoveDropzoneEnabled(enabled) {
  if (!DOM.removeTagDropzone) return;
  if (enabled) {
    DOM.removeTagDropzone.removeAttribute('aria-disabled');
    DOM.removeTagDropzone.dataset.active = 'false';
  } else {
    DOM.removeTagDropzone.setAttribute('aria-disabled', 'true');
    DOM.removeTagDropzone.dataset.active = 'false';
  }
}

function handleRemoveDragEnter(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnRemove(data)) return;
  removeDropDepth += 1;
  setRemoveDropState(true);
  event.preventDefault();
}

function handleRemoveDragOver(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnRemove(data)) {
    setRemoveDropState(false);
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  setRemoveDropState(true);
}

function handleRemoveDragLeave(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnRemove(data)) {
    return;
  }
  removeDropDepth = Math.max(0, removeDropDepth - 1);
  if (removeDropDepth === 0) {
    setRemoveDropState(false);
  }
}

function handleRemoveDrop(event) {
  const data = extractTagDragData(event);
  if (!canDropTagOnRemove(data)) {
    setRemoveDropState(false);
    return;
  }
  event.preventDefault();
  removeDropDepth = 0;
  setRemoveDropState(false);
  removeTag(data.tagId);
}

async function loadTags() {
  try {
    const tags = await API.listTags();
    state.tags = tags;
    renderTagSidebar();
    populateTagFilter();
    renderTagPicker(state.selectedInvoice);
  } catch (error) {
    console.error(error);
    showToast('Impossible de charger les tags', { type: 'error' });
  }
}

async function loadInvoices({ initial = false } = {}) {
  try {
    const invoices = await API.listInvoices(state.filters);
    state.invoices = invoices;
    renderInvoiceList();

    if (!invoices.length) {
      showDetail(null);
      return;
    }

    if (initial && invoices[0]) {
      await selectInvoice(invoices[0].id);
      return;
    }

    if (state.selectedInvoiceId) {
      const exists = invoices.some((invoice) => invoice.id === state.selectedInvoiceId);
      if (!exists) {
        await selectInvoice(invoices[0].id);
        return;
      }
      if (state.selectedInvoice) {
        renderInvoiceList();
      }
      return;
    }

    if (invoices[0]) {
      await selectInvoice(invoices[0].id);
    }
  } catch (error) {
    console.error(error);
    showToast('Erreur lors du chargement des factures', { type: 'error' });
  }
}

function renderInvoiceList() {
  DOM.invoiceList.innerHTML = '';
  if (!state.invoices.length) {
    DOM.emptyState.hidden = false;
    return;
  }
  DOM.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const invoice of state.invoices) {
    const node = DOM.invoiceTemplate.content.firstElementChild.cloneNode(true);
    const button = node.querySelector('.invoice-item__button');
    button.dataset.id = invoice.id;
    button.addEventListener('click', () => selectInvoice(invoice.id));
    if (invoice.id === state.selectedInvoiceId) {
      button.classList.add('is-selected');
    }
    node.querySelector('.invoice-item__vendor').textContent = invoice.vendor || 'Sans fournisseur';
    node.querySelector('.invoice-item__amount').textContent = formatCurrency(invoice.amountTotal);
    node.querySelector('.invoice-item__date').textContent = formatDate(invoice.invoiceDate || invoice.createdAt);
    node.querySelector('.invoice-item__status').textContent = invoice.statusLabel || '';
    fragment.appendChild(node);
  }
  DOM.invoiceList.appendChild(fragment);
}

function renderTagSidebar() {
  DOM.tagList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const tag of state.tags) {
    const node = DOM.tagTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.tag-list__color').style.background = tag.color || '#5b5bd6';
    node.querySelector('.tag-list__label').textContent = tag.label;
    node.querySelector('.tag-list__count').textContent = tag.usageCount?.toString() || '0';
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `Appliquer le tag ${tag.label}`);
    node.addEventListener('click', () => applyTag(tag.id));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        applyTag(tag.id);
      }
    });
    registerDraggable(node, { tagId: tag.id, source: 'available' });
    fragment.appendChild(node);
  }
  DOM.tagList.appendChild(fragment);
}

function populateTagFilter() {
  const current = state.filters.tag;
  DOM.tagFilter.innerHTML = '';
  const optionAll = document.createElement('option');
  optionAll.value = 'all';
  optionAll.textContent = 'Tous';
  DOM.tagFilter.appendChild(optionAll);
  for (const tag of state.tags) {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = tag.label;
    DOM.tagFilter.appendChild(option);
  }
  DOM.tagFilter.value = current;
}

async function selectInvoice(id) {
  if (!id) {
    showDetail(null);
    return;
  }
  try {
    const [invoice, messages] = await Promise.all([API.getInvoice(id), API.listMessages(id)]);
    state.selectedInvoiceId = id;
    state.selectedInvoice = invoice;
    state.messages = messages;
    const listIndex = state.invoices.findIndex((item) => item.id === id);
    if (listIndex !== -1) {
      state.invoices[listIndex] = invoice;
    }
    renderInvoiceList();
    showDetail(invoice);
    renderChat();
  } catch (error) {
    console.error(error);
    showToast('Impossible de charger la facture sélectionnée', { type: 'error' });
  }
}

function showDetail(invoice) {
  setPreviewDropState(false);
  setRemoveDropState(false);
  applyDropDepth = 0;
  removeDropDepth = 0;
  if (!invoice) {
    state.selectedInvoiceId = null;
    state.selectedInvoice = null;
    state.messages = [];
    DOM.detailContent.hidden = true;
    DOM.detailEmpty.hidden = false;
    DOM.chatForm.setAttribute('hidden', '');
    DOM.chatInput.value = '';
    DOM.chatInput.disabled = true;
    setRemoveDropzoneEnabled(false);
    clearUndoState();
    return;
  }
  if (undoState && undoState.invoiceId !== invoice.id) {
    clearUndoState({ keepToast: true });
  }
  DOM.detailEmpty.hidden = true;
  DOM.detailContent.hidden = false;

  DOM.detailVendor.textContent = invoice.vendor || 'Sans fournisseur';
  const summaryParts = [];
  if (invoice.amountTotal !== undefined && invoice.amountTotal !== null) {
    summaryParts.push(formatCurrency(invoice.amountTotal));
  }
  if (invoice.invoiceDate) {
    summaryParts.push(formatDate(invoice.invoiceDate));
  }
  DOM.detailSummary.textContent = summaryParts.join(' • ');

  populateStatusSelect(invoice.status);
  renderPreview(invoice.previewUrl);
  renderAppliedTags(invoice);
  renderTagPicker(invoice);
  renderOcr(invoice.ocrFields || []);

  if (invoice.sender) {
    DOM.chatPartner.textContent = `Échanges avec ${invoice.sender.name}`;
  } else {
    DOM.chatPartner.textContent = "Chat interne";
  }
  DOM.chatForm.removeAttribute('hidden');
  DOM.chatInput.disabled = false;
  DOM.chatInput.value = '';
}

function populateStatusSelect(current) {
  DOM.statusSelect.innerHTML = '';
  for (const option of STATUS_OPTIONS) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    DOM.statusSelect.appendChild(node);
  }
  DOM.statusSelect.value = current || 'nouvelle';
  DOM.statusSelect.onchange = async (event) => {
    if (!state.selectedInvoice) return;
    const newStatus = event.target.value;
    try {
      const updated = await API.updateInvoice(state.selectedInvoice.id, { status: newStatus });
      state.selectedInvoice = updated;
      mergeInvoice(updated);
      showToast('Statut mis à jour');
    } catch (error) {
      console.error(error);
      showToast('Impossible de mettre à jour le statut', { type: 'error' });
      DOM.statusSelect.value = state.selectedInvoice.status;
    }
  };
}

function renderPreview(previewUrl) {
  DOM.preview.innerHTML = '';
  if (previewUrl) {
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = 'Aperçu de la facture';
    DOM.preview.appendChild(img);
  } else {
    const fallback = document.createElement('p');
    fallback.textContent = "Aucun aperçu disponible";
    DOM.preview.appendChild(fallback);
  }
}

function renderAppliedTags(invoice) {
  DOM.appliedTags.innerHTML = '';
  if (!invoice.tags?.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun tag appliqué pour le moment.';
    empty.className = 'detail__hint';
    DOM.appliedTags.appendChild(empty);
    setRemoveDropzoneEnabled(false);
    return;
  }
  setRemoveDropzoneEnabled(true);
  for (const tag of invoice.tags) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-chip';
    button.dataset.active = 'true';
    button.style.borderColor = `${tag.color || '#5b5bd6'}33`;
    button.style.background = `${tag.color || '#5b5bd6'}26`;
    button.textContent = tag.label;
    button.title = 'Retirer ce tag';
    button.setAttribute('aria-label', `Retirer le tag ${tag.label}`);
    button.addEventListener('click', () => removeTag(tag.tagId));
    registerDraggable(button, { tagId: tag.tagId, source: 'applied' });
    DOM.appliedTags.appendChild(button);
  }
}

function renderTagPicker(invoice) {
  DOM.tagPicker.innerHTML = '';
  if (!invoice) {
    return;
  }
  const appliedIds = new Set(invoice.tags?.map((tag) => tag.tagId));
  const available = state.tags.filter((tag) => !appliedIds.has(tag.id));
  if (!available.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Tous les tags sont appliqués.';
    empty.className = 'detail__hint';
    DOM.tagPicker.appendChild(empty);
    return;
  }
  for (const tag of available) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-chip';
    button.style.borderColor = `${tag.color || '#5b5bd6'}33`;
    button.textContent = `Ajouter ${tag.label}`;
    button.addEventListener('click', () => applyTag(tag.id));
    registerDraggable(button, { tagId: tag.id, source: 'available' });
    DOM.tagPicker.appendChild(button);
  }
}

function renderOcr(fields) {
  DOM.ocrList.innerHTML = '';
  if (!fields.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun champ OCR disponible.';
    empty.className = 'detail__hint';
    DOM.ocrList.appendChild(empty);
    return;
  }
  for (const field of fields) {
    const item = document.createElement('li');
    item.className = 'ocr-item';
    const label = document.createElement('div');
    label.className = 'ocr-item__label';
    label.textContent = field.label || field.id;
    const value = document.createElement('div');
    value.className = 'ocr-item__value';
    value.textContent = field.value || '—';
    const confidence = document.createElement('div');
    confidence.className = 'ocr-item__confidence';
    if (typeof field.confidence === 'number') {
      confidence.textContent = `Confiance ${(field.confidence * 100).toFixed(0)}%`;
    } else {
      confidence.textContent = 'Confiance inconnue';
    }
    item.append(label, value, confidence);
    DOM.ocrList.appendChild(item);
  }
}

function renderChat() {
  DOM.chatList.innerHTML = '';
  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun message pour le moment.';
    empty.className = 'detail__hint';
    DOM.chatList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const message of state.messages) {
    const item = document.createElement('li');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.dataset.role = message.authorRole || 'tagger';
    const text = document.createElement('p');
    text.textContent = message.body;
    const meta = document.createElement('span');
    meta.className = 'chat-bubble__meta';
    const author = message.authorName || 'Utilisateur';
    meta.textContent = `${author} • ${formatDateTime(message.createdAt)}`;
    bubble.append(text, meta);
    item.appendChild(bubble);
    fragment.appendChild(item);
  }
  DOM.chatList.appendChild(fragment);
}

async function applyTag(tagId) {
  if (!state.selectedInvoice) return;
  if (state.selectedInvoice.tags?.some((tag) => tag.tagId === tagId)) {
    return;
  }
  try {
    const invoiceId = state.selectedInvoice.id;
    const label = resolveTagLabel(tagId);
    const updated = await API.addTag(invoiceId, tagId);
    state.selectedInvoice = updated;
    mergeInvoice(updated);
    await loadTags();
    undoState = { kind: 'add', invoiceId, tagId, label };
    showToast(`Tag « ${label} » ajouté`, {
      actionLabel: 'Annuler',
      duration: 8000,
      onAction: handleUndo,
    });
  } catch (error) {
    console.error(error);
    showToast('Impossible d\'ajouter le tag', { type: 'error' });
  }
}

async function removeTag(tagId) {
  if (!state.selectedInvoice) return;
  try {
    const invoiceId = state.selectedInvoice.id;
    const label = resolveTagLabel(tagId);
    const result = await API.removeTag(invoiceId, tagId);
    const updated = result?.invoice || state.selectedInvoice;
    state.selectedInvoice = updated;
    mergeInvoice(updated);
    await loadTags();
    undoState = { kind: 'remove', invoiceId, tagId, label };
    showToast(`Tag « ${label} » retiré`, {
      actionLabel: 'Annuler',
      duration: 8000,
      onAction: handleUndo,
    });
  } catch (error) {
    console.error(error);
    showToast('Impossible de retirer le tag', { type: 'error' });
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.selectedInvoice) return;
  const message = DOM.chatInput.value.trim();
  if (!message) return;
  DOM.chatInput.disabled = true;
  try {
    const created = await API.createMessage(state.selectedInvoice.id, message);
    state.messages.push(created);
    renderChat();
    DOM.chatInput.value = '';
    showToast('Message envoyé');
  } catch (error) {
    console.error(error);
    showToast("Impossible d'envoyer le message", { type: 'error' });
  } finally {
    DOM.chatInput.disabled = false;
    DOM.chatInput.focus();
  }
}

async function handleUploadSubmit(event) {
  event.preventDefault();
  const formData = new FormData(DOM.uploadForm);
  const payload = {
    vendor: formData.get('vendor')?.toString().trim() || '',
    amountTotal: parseFloat(formData.get('amountTotal')) || 0,
    invoiceDate: formData.get('invoiceDate') || null,
    source: formData.get('source') || 'upload',
    paymentMethod: formData.get('paymentMethod')?.toString().trim() || '',
    previewUrl: formData.get('previewUrl')?.toString().trim() || '',
    notes: formData.get('notes')?.toString().trim() || '',
    senderUserId: formData.get('senderUserId') || null,
  };

  if (!payload.vendor) {
    showToast('Le fournisseur est requis', { type: 'error' });
    return;
  }

  try {
    const invoice = await API.createInvoice(payload);
    DOM.uploadDialog.close();
    showToast('Facture créée');
    await loadInvoices();
    if (invoice?.id) {
      await selectInvoice(invoice.id);
    }
  } catch (error) {
    console.error(error);
    showToast('Impossible de créer la facture', { type: 'error' });
  }
}

async function handleTagSubmit(event) {
  event.preventDefault();
  const formData = new FormData(DOM.tagForm);
  const label = formData.get('label')?.toString().trim();
  if (!label) {
    showToast('Le nom du tag est requis', { type: 'error' });
    return;
  }
  const color = formData.get('color')?.toString() || '#5b5bd6';
  try {
    const created = await API.createTag({ label, color });
    state.tags.push({ ...created, usageCount: 0 });
    renderTagSidebar();
    populateTagFilter();
    renderTagPicker(state.selectedInvoice);
    DOM.tagForm.reset();
    DOM.tagForm.setAttribute('hidden', '');
    showToast('Tag créé');
  } catch (error) {
    console.error(error);
    showToast("Impossible de créer le tag", { type: 'error' });
  }
}

function mergeInvoice(updated) {
  const index = state.invoices.findIndex((invoice) => invoice.id === updated.id);
  if (index !== -1) {
    state.invoices[index] = updated;
  }
  if (state.selectedInvoice?.id === updated.id) {
    state.selectedInvoice = updated;
    showDetail(updated);
  }
  renderInvoiceList();
}

function showToast(message, { type, actionLabel, onAction, duration = 2800 } = {}) {
  if (!DOM.toast || !DOM.toastMessage || !DOM.toastAction) return;
  DOM.toastMessage.textContent = message;
  DOM.toast.dataset.visible = 'true';
  DOM.toast.style.background =
    type === 'error' ? 'rgba(248, 113, 113, 0.9)' : 'rgba(17, 24, 39, 0.9)';
  disableToastAction();
  if (actionLabel && typeof onAction === 'function') {
    DOM.toastAction.textContent = actionLabel;
    DOM.toastAction.dataset.visible = 'true';
    DOM.toastAction.setAttribute('aria-hidden', 'false');
    toastActionHandler = (event) => {
      event.preventDefault();
      onAction();
    };
    DOM.toastAction.addEventListener('click', toastActionHandler);
  } else {
    DOM.toastAction.dataset.visible = 'false';
    DOM.toastAction.setAttribute('aria-hidden', 'true');
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    hideToast();
  }, duration);
}

function hideToast() {
  if (!DOM.toast) return;
  DOM.toast.dataset.visible = 'false';
  clearTimeout(toastTimer);
  toastTimer = null;
  disableToastAction();
}

function disableToastAction() {
  if (!DOM.toastAction) return;
  if (toastActionHandler) {
    DOM.toastAction.removeEventListener('click', toastActionHandler);
    toastActionHandler = null;
  }
  DOM.toastAction.dataset.visible = 'false';
  DOM.toastAction.setAttribute('aria-hidden', 'true');
  DOM.toastAction.textContent = '';
  DOM.toastAction.blur();
}

function clearUndoState({ keepToast = false } = {}) {
  undoState = null;
  disableToastAction();
  if (!keepToast) {
    hideToast();
  }
}

async function handleUndo() {
  if (!undoState) return;
  const action = undoState;
  undoState = null;
  hideToast();
  try {
    if (action.kind === 'add') {
      const result = await API.removeTag(action.invoiceId, action.tagId);
      const updated = result?.invoice || state.selectedInvoice;
      if (updated) {
        state.selectedInvoice = updated;
        mergeInvoice(updated);
      }
      await loadTags();
      showToast(`Ajout du tag « ${action.label} » annulé`);
    } else if (action.kind === 'remove') {
      const updated = await API.addTag(action.invoiceId, action.tagId);
      if (updated) {
        state.selectedInvoice = updated;
        mergeInvoice(updated);
      }
      await loadTags();
      showToast(`Suppression du tag « ${action.label} » annulée`);
    }
  } catch (error) {
    console.error(error);
    showToast("Impossible d'annuler l'action", { type: 'error' });
  }
}

function resolveTagLabel(tagId) {
  if (!tagId) return 'Tag';
  const inState = state.tags.find((tag) => tag.id === tagId);
  if (inState?.label) {
    return inState.label;
  }
  const inInvoice = state.selectedInvoice?.tags?.find((tag) => tag.tagId === tagId);
  if (inInvoice?.label) {
    return inInvoice.label;
  }
  return 'Tag';
}

function formatCurrency(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(value);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
