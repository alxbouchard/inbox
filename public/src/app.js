const CURRENT_USER_ID = 'user-tagger';
const DRAG_MIME = 'application/x-inbox-tag';

const DOM = {
  invoiceList: document.getElementById('invoiceList'),
  emptyState: document.getElementById('emptyState'),
  searchInput: document.getElementById('searchInput'),
  clearSearchButton: document.getElementById('clearSearchButton'),
  statusFilter: document.getElementById('statusFilter'),
  tagFilter: document.getElementById('tagFilter'),
  periodFilter: document.getElementById('periodFilter'),
  invoiceVendor: document.getElementById('invoiceVendor'),
  invoiceSummary: document.getElementById('invoiceSummary'),
  statusChip: document.getElementById('statusChip'),
  tagList: document.getElementById('tagList'),
  addTagButton: document.getElementById('addTagButton'),
  removeTagDropzone: document.getElementById('removeTagDropzone'),
  previewStage: document.getElementById('previewStage'),
  previewMedia: document.getElementById('previewMedia'),
  previewHint: document.getElementById('previewHint'),
  appliedTags: document.getElementById('appliedTags'),
  invoiceChannel: document.getElementById('invoiceChannel'),
  invoiceTimestamp: document.getElementById('invoiceTimestamp'),
  sendToReviewButton: document.getElementById('sendToReviewButton'),
  markCompleteButton: document.getElementById('markCompleteButton'),
  chatPartner: document.getElementById('chatPartner'),
  chatMessages: document.getElementById('chatMessages'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  ocrFieldList: document.getElementById('ocrFieldList'),
  toastContainer: document.getElementById('toastContainer'),
  newUploadButton: document.getElementById('newUploadButton'),
  newInvoiceDialog: document.getElementById('newInvoiceDialog'),
  newInvoiceForm: document.getElementById('newInvoiceForm'),
};

const TEMPLATE = {
  invoiceRow: document.getElementById('invoiceRowTemplate'),
  tag: document.getElementById('tagTemplate'),
  ocrField: document.getElementById('ocrFieldTemplate'),
  chatMessage: document.getElementById('chatMessageTemplate'),
  appliedTag: document.getElementById('appliedTagTemplate'),
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
  chatPoll: null,
  isCreatingTag: false,
  dragContext: null,
};

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
          // ignore JSON parse error
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
  addTagToInvoice(id, tagId) {
    return this.fetchJSON(`/api/invoices/${id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId, appliedByUserId: CURRENT_USER_ID }),
    });
  },
  removeTagFromInvoice(id, tagId) {
    return this.fetchJSON(`/api/invoices/${id}/tags/${tagId}`, {
      method: 'DELETE',
    });
  },
  listMessages(invoiceId) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/messages`);
  },
  createMessage(invoiceId, payload) {
    return this.fetchJSON(`/api/invoices/${invoiceId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  showToast('Initialisation impossible. Rechargez la page.', { type: 'error' });
});

async function init() {
  attachEventListeners();
  await loadTags();
  await loadInvoices({ initial: true });
}

function attachEventListeners() {
  DOM.searchInput.addEventListener('input', debounce(() => {
    state.filters.search = DOM.searchInput.value;
    loadInvoices();
  }, 250));

  DOM.clearSearchButton.addEventListener('click', () => {
    DOM.searchInput.value = '';
    state.filters.search = '';
    loadInvoices();
    DOM.searchInput.focus();
  });

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

  DOM.addTagButton.addEventListener('click', () => startTagCreation());

  DOM.previewStage.addEventListener('dragenter', handlePreviewDragEnter);
  DOM.previewStage.addEventListener('dragover', handlePreviewDragOver);
  DOM.previewStage.addEventListener('dragleave', handlePreviewDragLeave);
  DOM.previewStage.addEventListener('drop', handlePreviewDrop);

  DOM.removeTagDropzone.addEventListener('dragenter', handleRemoveDragEnter);
  DOM.removeTagDropzone.addEventListener('dragover', handleRemoveDragOver);
  DOM.removeTagDropzone.addEventListener('dragleave', handleRemoveDragLeave);
  DOM.removeTagDropzone.addEventListener('drop', handleRemoveDrop);

  DOM.sendToReviewButton.addEventListener('click', () => updateStatus('a_verifier'));
  DOM.markCompleteButton.addEventListener('click', () => {
    if (!state.selectedInvoice) return;
    const next = state.selectedInvoice.status === 'complete' ? 'a_verifier' : 'complete';
    updateStatus(next);
  });

  DOM.chatForm.addEventListener('submit', handleChatSubmit);

  DOM.newUploadButton.addEventListener('click', () => {
    if (typeof DOM.newInvoiceDialog.showModal === 'function') {
      DOM.newInvoiceForm.reset();
      DOM.newInvoiceDialog.showModal();
      const firstInput = DOM.newInvoiceForm.querySelector('input, select');
      if (firstInput) {
        firstInput.focus();
      }
    } else {
      showToast('Votre navigateur ne supporte pas l’intake manuel.', { type: 'error' });
    }
  });

  DOM.newInvoiceForm.addEventListener('submit', handleNewInvoiceSubmit);
  DOM.newInvoiceForm.addEventListener('reset', (event) => {
    if (event.isTrusted) {
      setTimeout(() => DOM.newInvoiceDialog.close(), 0);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.key.toLowerCase() === 't') {
      focusFirstTag();
    }
  });
}

async function loadTags() {
  try {
    state.tags = await API.listTags();
    renderTagPanel();
    populateTagFilterOptions();
  } catch (error) {
    console.error(error);
    showToast("Impossible de charger les tags", { type: 'error' });
  }
}

async function loadInvoices({ initial = false } = {}) {
  try {
    const invoices = await API.listInvoices(state.filters);
    state.invoices = invoices;

    if (initial && invoices.length > 0) {
      await selectInvoice(invoices[0].id);
    } else if (state.selectedInvoiceId) {
      const stillVisible = invoices.some((invoice) => invoice.id === state.selectedInvoiceId);
      if (!stillVisible && invoices.length > 0) {
        await selectInvoice(invoices[0].id);
      }
    }

    renderInvoiceList();
    DOM.emptyState.hidden = state.invoices.length > 0;
    if (!state.selectedInvoice && state.invoices.length === 0) {
      renderInvoiceDetail(null);
    }
  } catch (error) {
    console.error(error);
    showToast("Impossible de charger les factures", { type: 'error' });
  }
}

async function selectInvoice(invoiceId) {
  state.selectedInvoiceId = invoiceId;
  highlightSelectedInvoice();

  try {
    toggleDetailLoading(true);
    const [invoice, messages] = await Promise.all([
      API.getInvoice(invoiceId),
      API.listMessages(invoiceId),
    ]);

    state.selectedInvoice = invoice;
    state.messages = messages;
    renderInvoiceDetail(invoice);
    renderChatMessages(messages);
    renderTagPanel();
    toggleDetailLoading(false);
    startChatPolling();
  } catch (error) {
    console.error(error);
    toggleDetailLoading(false);
    showToast("Impossible d'ouvrir la facture", { type: 'error' });
  }
}

function toggleDetailLoading(isLoading) {
  DOM.previewStage.classList.toggle('is-loading', isLoading);
  DOM.chatForm.querySelector('button[type="submit"]').disabled = isLoading;
}

function highlightSelectedInvoice() {
  const items = DOM.invoiceList.querySelectorAll('.inbox-item');
  items.forEach((item) => {
    const button = item.querySelector('.inbox-item__button');
    const isSelected = button?.dataset.invoiceId === state.selectedInvoiceId;
    item.classList.toggle('is-selected', isSelected);
    if (isSelected) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  });
}

function renderInvoiceList() {
  DOM.invoiceList.innerHTML = '';

  state.invoices.forEach((invoice) => {
    const entry = TEMPLATE.invoiceRow.content.firstElementChild.cloneNode(true);
    const button = entry.querySelector('.inbox-item__button');
    const time = entry.querySelector('.inbox-item__time');
    const status = entry.querySelector('.status-indicator');
    const title = entry.querySelector('.inbox-item__title');
    const from = entry.querySelector('.inbox-item__from');
    const amount = entry.querySelector('.inbox-item__amount');
    const tagsContainer = entry.querySelector('.inbox-item__tags');

    button.dataset.invoiceId = invoice.id;
    button.addEventListener('click', () => selectInvoice(invoice.id));

    entry.classList.toggle('is-selected', invoice.id === state.selectedInvoiceId);

    time.textContent = formatRelativeTime(invoice.createdAt);
    status.dataset.status = invoice.status;
    status.textContent = invoice.statusLabel || invoice.status;
    title.textContent = invoice.vendor || 'Sans fournisseur';
    from.textContent = buildInvoiceSource(invoice);
    amount.textContent = invoice.amountTotal ? formatCurrency(invoice.amountTotal) : '—';

    tagsContainer.innerHTML = '';
    invoice.tags.forEach((tag) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = tag.label;
      tagsContainer.appendChild(badge);
    });

    DOM.invoiceList.appendChild(entry);
  });

  highlightSelectedInvoice();
}

function renderInvoiceDetail(invoice) {
  if (!invoice) {
    DOM.invoiceVendor.textContent = 'Sélectionnez une facture';
    DOM.invoiceSummary.textContent = 'Choisissez un élément dans la liste pour afficher les détails.';
    DOM.statusChip.textContent = '';
    DOM.statusChip.removeAttribute('data-status');
    DOM.previewMedia.style.backgroundImage = '';
    DOM.previewStage.classList.add('is-empty');
    DOM.appliedTags.innerHTML = '';
    DOM.previewHint.hidden = false;
    DOM.invoiceChannel.textContent = '';
    DOM.invoiceTimestamp.textContent = '';
    DOM.chatPartner.textContent = '';
    DOM.chatInput.disabled = true;
    DOM.sendToReviewButton.disabled = true;
    DOM.markCompleteButton.disabled = true;
    DOM.ocrFieldList.innerHTML = '';
    DOM.chatMessages.innerHTML = '';
    return;
  }

  DOM.invoiceVendor.textContent = invoice.vendor || 'Facture sans fournisseur';
  DOM.invoiceSummary.textContent = buildInvoiceSummary(invoice);
  DOM.statusChip.textContent = invoice.statusLabel || invoice.status;
  DOM.statusChip.dataset.status = invoice.status;

  if (invoice.previewUrl) {
    DOM.previewMedia.style.backgroundImage = `url(${invoice.previewUrl})`;
    DOM.previewStage.classList.remove('is-empty');
  } else {
    DOM.previewMedia.style.backgroundImage = '';
    DOM.previewStage.classList.add('is-empty');
  }

  DOM.previewHint.hidden = invoice.tags.length > 0;
  renderAppliedTags(invoice);

  DOM.invoiceChannel.textContent = buildInvoiceChannel(invoice);
  DOM.invoiceTimestamp.textContent = formatDateTime(invoice.createdAt);

  DOM.chatPartner.textContent = invoice.sender?.name || invoice.sender?.email || invoice.sender?.phone || 'Collaborateur externe';
  DOM.chatInput.disabled = false;
  DOM.sendToReviewButton.disabled = false;
  DOM.markCompleteButton.disabled = false;
  DOM.markCompleteButton.textContent = invoice.status === 'complete' ? 'Repasser en révision' : 'Marquer comme complétée';

  renderOcrFields(invoice);
}

function renderAppliedTags(invoice) {
  DOM.appliedTags.innerHTML = '';

  invoice.tags.forEach((tag) => {
    const button = TEMPLATE.appliedTag.content.firstElementChild.cloneNode(true);
    button.textContent = tag.label;
    button.dataset.tagId = tag.tagId;
    button.draggable = true;
    button.addEventListener('click', () => removeTag(tag.tagId));
    button.addEventListener('dragstart', (event) => {
      state.dragContext = { type: 'applied-tag', tagId: tag.tagId };
      event.dataTransfer.setData(DRAG_MIME, tag.tagId);
      event.dataTransfer.effectAllowed = 'move';
    });
    button.addEventListener('dragend', () => {
      state.dragContext = null;
    });
    DOM.appliedTags.appendChild(button);
  });
}

function renderTagPanel() {
  DOM.tagList.innerHTML = '';
  const applied = new Set(state.selectedInvoice?.tags.map((tag) => tag.tagId));

  state.tags.forEach((tag) => {
    const item = TEMPLATE.tag.content.firstElementChild.cloneNode(true);
    const button = item.querySelector('.tag-pill');
    button.textContent = tag.label;
    button.dataset.tagId = tag.id;
    button.draggable = true;
    button.dataset.color = tag.color;

    if (applied.has(tag.id)) {
      button.classList.add('is-applied');
    }

    const count = document.createElement('span');
    count.className = 'tag-pill__count';
    count.textContent = tag.usageCount?.toString() || '0';
    button.appendChild(count);

    button.addEventListener('click', () => applyTag(tag.id));
    button.addEventListener('dragstart', (event) => {
      state.dragContext = { type: 'tag', tagId: tag.id };
      event.dataTransfer.setData(DRAG_MIME, tag.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    button.addEventListener('dragend', () => {
      state.dragContext = null;
    });

    DOM.tagList.appendChild(item);
  });
}

function renderOcrFields(invoice) {
  DOM.ocrFieldList.innerHTML = '';

  invoice.ocrFields.forEach((field) => {
    const entry = TEMPLATE.ocrField.content.firstElementChild.cloneNode(true);
    const label = entry.querySelector('.ocr-pill__label');
    const confidence = entry.querySelector('.ocr-pill__confidence');
    const input = entry.querySelector('.ocr-pill__input');
    const confirm = entry.querySelector('.ocr-pill__confirm');

    label.textContent = field.label;
    confidence.textContent = `${Math.round((field.confidence || 0) * 100)}%`;
    input.value = field.value || '';
    input.dataset.fieldId = field.id;
    confirm.dataset.fieldId = field.id;
    confirm.setAttribute('aria-pressed', field.confirmed ? 'true' : 'false');
    confirm.classList.toggle('is-active', field.confirmed);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        persistOcrField(field.id, { value: input.value.trim() });
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        input.value = field.value || '';
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      if (input.value.trim() !== field.value) {
        persistOcrField(field.id, { value: input.value.trim() });
      }
    });

    confirm.addEventListener('click', () => {
      persistOcrField(field.id, { confirmed: !field.confirmed });
    });

    DOM.ocrFieldList.appendChild(entry);
  });
}

function renderChatMessages(messages) {
  DOM.chatMessages.innerHTML = '';
  if (!state.selectedInvoice) return;

  messages.forEach((message) => {
    const entry = TEMPLATE.chatMessage.content.firstElementChild.cloneNode(true);
    const bubbleText = entry.querySelector('.chat-bubble__text');
    const bubbleMeta = entry.querySelector('.chat-bubble__meta');

    const isCurrent = message.fromUserId === CURRENT_USER_ID;
    entry.dataset.direction = isCurrent ? 'outgoing' : 'incoming';

    bubbleText.textContent = message.body;
    const author = isCurrent ? 'Vous' : message.authorName;
    bubbleMeta.textContent = `${author} · ${formatTime(message.createdAt)}`;

    DOM.chatMessages.appendChild(entry);
  });

  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function populateTagFilterOptions() {
  const current = DOM.tagFilter.value;
  DOM.tagFilter.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = 'Tous les tags';
  DOM.tagFilter.appendChild(defaultOption);

  state.tags.forEach((tag) => {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = tag.label;
    DOM.tagFilter.appendChild(option);
  });

  DOM.tagFilter.value = state.tags.some((tag) => tag.id === current) ? current : 'all';
}

function startTagCreation() {
  if (state.isCreatingTag) return;
  state.isCreatingTag = true;

  const item = document.createElement('li');
  item.className = 'tag-item';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-edit-input';
  input.placeholder = 'Nouveau tag';
  input.setAttribute('aria-label', 'Nom du nouveau tag');
  item.appendChild(input);
  DOM.tagList.prepend(item);
  input.focus();

  const finalize = async (value) => {
    const label = value.trim();
    if (!label) {
      DOM.tagList.removeChild(item);
      state.isCreatingTag = false;
      return;
    }

    try {
      const tag = await API.createTag({ label });
      state.tags.push({ ...tag, usageCount: 0 });
      state.tags.sort((a, b) => a.label.localeCompare(b.label));
      renderTagPanel();
      populateTagFilterOptions();
      showToast(`Tag "${tag.label}" créé`);
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Impossible de créer le tag', { type: 'error' });
    } finally {
      state.isCreatingTag = false;
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finalize(input.value);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      DOM.tagList.removeChild(item);
      state.isCreatingTag = false;
    }
  });

  input.addEventListener('blur', () => finalize(input.value));
}

async function applyTag(tagId) {
  if (!state.selectedInvoice) return;
  try {
    const updated = await API.addTagToInvoice(state.selectedInvoice.id, tagId);
    mergeInvoice(updated);
    showToast('Tag appliqué');
  } catch (error) {
    console.error(error);
    showToast(error.message || "Impossible d'appliquer le tag", { type: 'error' });
  }
}

async function removeTag(tagId) {
  if (!state.selectedInvoice) return;
  try {
    const response = await API.removeTagFromInvoice(state.selectedInvoice.id, tagId);
    if (!response?.invoice) return;
    mergeInvoice(response.invoice);
    showToast('Tag retiré', {
      action: {
        label: 'Annuler',
        handler: () => applyTag(tagId),
      },
    });
  } catch (error) {
    console.error(error);
    showToast(error.message || "Impossible de retirer le tag", { type: 'error' });
  }
}

async function updateStatus(status) {
  if (!state.selectedInvoice) return;
  try {
    const updated = await API.updateInvoice(state.selectedInvoice.id, { status });
    mergeInvoice(updated);
    showToast(`Statut → ${updated.statusLabel || status}`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Changement de statut impossible', { type: 'error' });
  }
}

async function persistOcrField(fieldId, updates) {
  if (!state.selectedInvoice) return;
  const fields = state.selectedInvoice.ocrFields.map((field) =>
    field.id === fieldId ? { ...field, ...updates } : field,
  );
  try {
    const updated = await API.updateInvoice(state.selectedInvoice.id, { ocrFields: fields });
    mergeInvoice(updated);
    showToast('Champ mis à jour');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Erreur de sauvegarde OCR', { type: 'error' });
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.selectedInvoice) return;
  const value = DOM.chatInput.value.trim();
  if (!value) return;

  DOM.chatInput.disabled = true;
  try {
    const message = await API.createMessage(state.selectedInvoice.id, {
      body: value,
      fromUserId: CURRENT_USER_ID,
    });
    state.messages.push(message);
    renderChatMessages(state.messages);
    DOM.chatInput.value = '';
  } catch (error) {
    console.error(error);
    showToast(error.message || "Impossible d'envoyer le message", { type: 'error' });
  } finally {
    DOM.chatInput.disabled = false;
    DOM.chatInput.focus();
  }
}

async function handleNewInvoiceSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  const payload = {
    vendor: formData.get('vendor')?.trim(),
    amountTotal: parseFloat(formData.get('amount') || '0'),
    invoiceDate: formData.get('invoiceDate') || null,
    source: formData.get('source') || 'upload',
    paymentMethod: formData.get('paymentMethod')?.trim() || '',
    previewUrl: formData.get('previewUrl')?.trim() || '',
    notes: formData.get('notes')?.trim() || '',
    senderUserId: formData.get('senderUserId') || null,
  };

  if (!payload.vendor) {
    showToast('Le fournisseur est requis', { type: 'error' });
    return;
  }

  try {
    const invoice = await API.createInvoice(payload);
    showToast('Facture ajoutée');
    DOM.newInvoiceDialog.close();
    await loadInvoices();
    if (invoice?.id) {
      await selectInvoice(invoice.id);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Impossible de créer la facture', { type: 'error' });
  }
}

function mergeInvoice(updated) {
  if (!updated) return;
  const index = state.invoices.findIndex((invoice) => invoice.id === updated.id);
  if (index !== -1) {
    state.invoices[index] = updated;
  }
  if (state.selectedInvoice?.id === updated.id) {
    state.selectedInvoice = updated;
  }
  renderInvoiceList();
  renderInvoiceDetail(state.selectedInvoice);
}

function startChatPolling() {
  if (state.chatPoll) {
    clearInterval(state.chatPoll);
  }
  if (!state.selectedInvoiceId) return;

  state.chatPoll = setInterval(async () => {
    try {
      const messages = await API.listMessages(state.selectedInvoiceId);
      if (JSON.stringify(messages) !== JSON.stringify(state.messages)) {
        state.messages = messages;
        renderChatMessages(messages);
      }
    } catch (error) {
      clearInterval(state.chatPoll);
      state.chatPoll = null;
    }
  }, 5000);
}

function focusFirstTag() {
  const tag = DOM.tagList.querySelector('.tag-pill');
  if (tag) {
    tag.focus();
  }
}

function handlePreviewDragEnter(event) {
  if (!acceptsTagDrag(event)) return;
  event.preventDefault();
  DOM.previewStage.classList.add('is-target');
}

function handlePreviewDragOver(event) {
  if (!acceptsTagDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function handlePreviewDragLeave(event) {
  if (!acceptsTagDrag(event)) return;
  if (event.target === DOM.previewStage) {
    DOM.previewStage.classList.remove('is-target');
  }
}

function handlePreviewDrop(event) {
  if (!acceptsTagDrag(event)) return;
  event.preventDefault();
  DOM.previewStage.classList.remove('is-target');
  const tagId = event.dataTransfer.getData(DRAG_MIME) || state.dragContext?.tagId;
  if (tagId) {
    applyTag(tagId);
  }
}

function handleRemoveDragEnter(event) {
  if (!acceptsAppliedTagDrag(event)) return;
  event.preventDefault();
  DOM.removeTagDropzone.classList.add('is-target');
}

function handleRemoveDragOver(event) {
  if (!acceptsAppliedTagDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleRemoveDragLeave(event) {
  if (!acceptsAppliedTagDrag(event)) return;
  if (event.target === DOM.removeTagDropzone) {
    DOM.removeTagDropzone.classList.remove('is-target');
  }
}

function handleRemoveDrop(event) {
  if (!acceptsAppliedTagDrag(event)) return;
  event.preventDefault();
  DOM.removeTagDropzone.classList.remove('is-target');
  const tagId = event.dataTransfer.getData(DRAG_MIME) || state.dragContext?.tagId;
  if (tagId) {
    removeTag(tagId);
  }
}

function acceptsTagDrag(event) {
  if (!state.selectedInvoice) return false;
  const data = event.dataTransfer.types;
  return data?.includes(DRAG_MIME);
}

function acceptsAppliedTagDrag(event) {
  return acceptsTagDrag(event) && state.dragContext?.type === 'applied-tag';
}

function buildInvoiceSource(invoice) {
  const channel = invoice.source ? invoice.source.toUpperCase() : 'INCONNU';
  if (invoice.sender?.name) {
    return `${channel} · ${invoice.sender.name}`;
  }
  if (invoice.senderEmail) {
    return `${channel} · ${invoice.senderEmail}`;
  }
  if (invoice.senderPhone) {
    return `${channel} · ${invoice.senderPhone}`;
  }
  return channel;
}

function buildInvoiceSummary(invoice) {
  const parts = [];
  if (invoice.amountTotal) {
    parts.push(formatCurrency(invoice.amountTotal));
  }
  if (invoice.invoiceDate) {
    parts.push(formatDate(invoice.invoiceDate));
  }
  if (invoice.paymentMethod) {
    parts.push(invoice.paymentMethod);
  }
  return parts.join(' · ');
}

function buildInvoiceChannel(invoice) {
  const channelMap = {
    sms: 'Reçue par SMS',
    email: 'Reçue par courriel',
    upload: 'Import manuel',
  };
  const label = channelMap[invoice.source] || 'Source inconnue';
  if (invoice.sender?.name) {
    return `${label} · ${invoice.sender.name}`;
  }
  if (invoice.senderEmail) {
    return `${label} · ${invoice.senderEmail}`;
  }
  if (invoice.senderPhone) {
    return `${label} · ${invoice.senderPhone}`;
  }
  return label;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value);
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-CA', { timeStyle: 'short' }).format(new Date(value));
}

function formatRelativeTime(value) {
  if (!value) return '';
  const now = Date.now();
  const time = new Date(value).getTime();
  const diff = time - now;
  const abs = Math.abs(diff);
  const units = [
    { unit: 'day', ms: 86_400_000 },
    { unit: 'hour', ms: 3_600_000 },
    { unit: 'minute', ms: 60_000 },
  ];
  for (const { unit, ms } of units) {
    if (abs >= ms || unit === 'minute') {
      const formatter = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return '';
}

function debounce(fn, wait = 200) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function showToast(message, { type = 'info', action } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  const messageEl = document.createElement('span');
  messageEl.className = 'toast__message';
  messageEl.textContent = message;
  toast.appendChild(messageEl);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.handler?.();
      toast.remove();
    });
    toast.appendChild(button);
  }

  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-visible');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

window.addEventListener('beforeunload', () => {
  if (state.chatPoll) {
    clearInterval(state.chatPoll);
  }
});
