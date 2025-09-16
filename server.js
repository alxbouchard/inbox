const http = require('http');
const path = require('path');
const { readFile, writeFile, stat } = require('fs/promises');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 4173;
const ORG_ID = 'org-demo';
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATUS_LABEL = {
  nouvelle: 'Nouvelle',
  a_verifier: 'À vérifier',
  complete: 'Complète',
  archive: 'Archivée',
  ocr_error: 'Erreur OCR',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const routes = [
  { method: 'GET', pattern: /^\/api\/tags$/, handler: getTags },
  { method: 'POST', pattern: /^\/api\/tags$/, handler: createTag },
  { method: 'DELETE', pattern: /^\/api\/tags\/([^/]+)$/, handler: deleteTag },
  { method: 'GET', pattern: /^\/api\/invoices$/, handler: listInvoices },
  { method: 'POST', pattern: /^\/api\/invoices$/, handler: createInvoice },
  { method: 'GET', pattern: /^\/api\/invoices\/([^/]+)$/, handler: getInvoice },
  { method: 'PATCH', pattern: /^\/api\/invoices\/([^/]+)$/, handler: patchInvoice },
  { method: 'POST', pattern: /^\/api\/invoices\/([^/]+)\/tags$/, handler: addInvoiceTag },
  { method: 'DELETE', pattern: /^\/api\/invoices\/([^/]+)\/tags\/([^/]+)$/, handler: removeInvoiceTag },
  { method: 'GET', pattern: /^\/api\/invoices\/([^/]+)\/messages$/, handler: listMessages },
  { method: 'POST', pattern: /^\/api\/invoices\/([^/]+)\/messages$/, handler: createMessage },
];

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (error) {
    console.error('Unexpected error', error);
    sendJson(res, 500, { error: 'Erreur interne du serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`Inbox server running on http://localhost:${PORT}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const route of routes) {
    if (req.method !== route.method) continue;
    const match = url.pathname.match(route.pattern);
    if (match) {
      const params = match.slice(1);
      await route.handler(req, res, params, url.searchParams);
      return;
    }
  }
  sendJson(res, 404, { error: 'Route inconnue' });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Accès refusé');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      await serveFile(path.join(filePath, 'index.html'), res);
    } else {
      await serveFile(filePath, res);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      // SPA fallback for routes without extension
      if (!path.extname(pathname)) {
        await serveFile(path.join(PUBLIC_DIR, 'index.html'), res);
        return;
      }
      sendText(res, 404, 'Fichier introuvable');
    } else {
      console.error(error);
      sendText(res, 500, 'Erreur de lecture de fichier');
    }
  }
}

async function serveFile(filePath, res) {
  const data = await readFile(filePath);
  const ext = path.extname(filePath);
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
}

async function loadDb() {
  const content = await readFile(DB_PATH, 'utf-8');
  return JSON.parse(content);
}

async function saveDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function buildMaps(db) {
  const tagMap = new Map(db.tags.map((tag) => [tag.id, tag]));
  const userMap = new Map(db.users.map((user) => [user.id, user]));
  return { tagMap, userMap };
}

function decorateInvoice(invoice, db) {
  const { tagMap, userMap } = buildMaps(db);
  const sender = invoice.senderUserId ? userMap.get(invoice.senderUserId) : null;

  return {
    ...invoice,
    statusLabel: STATUS_LABEL[invoice.status] || invoice.status,
    sender: sender
      ? {
          id: sender.id,
          name: sender.name,
          email: sender.email,
          phone: sender.phone,
          role: sender.role,
        }
      : null,
    tags: invoice.tags.map((link) => {
      const tag = tagMap.get(link.tagId);
      const user = userMap.get(link.appliedByUserId);
      return {
        tagId: link.tagId,
        label: tag ? tag.label : 'Tag supprimé',
        color: tag ? tag.color : '#777',
        appliedByUserId: link.appliedByUserId,
        appliedByName: user ? user.name : 'Inconnu',
        createdAt: link.createdAt,
      };
    }),
  };
}

function decorateMessage(message, db) {
  const { userMap } = buildMaps(db);
  const author = message.fromUserId ? userMap.get(message.fromUserId) : null;

  return {
    ...message,
    authorName: author ? author.name : message.fromExternalPhone || 'Système',
    authorRole: author ? author.role : 'external',
  };
}

function computeTagUsage(db) {
  const usage = Object.fromEntries(db.tags.map((tag) => [tag.id, 0]));
  for (const invoice of db.invoices) {
    for (const link of invoice.tags) {
      if (usage[link.tagId] !== undefined) {
        usage[link.tagId] += 1;
      }
    }
  }
  return usage;
}

function matchesFilters(invoice, db, { search, status, tag, period }) {
  if (status && status !== 'all' && invoice.status !== status) {
    return false;
  }
  if (tag && tag !== 'all' && !invoice.tags.some((link) => link.tagId === tag)) {
    return false;
  }
  if (period && period !== 'all') {
    const createdAt = new Date(invoice.createdAt);
    const now = new Date();
    const diffMs = now - createdAt;
    const dayMs = 24 * 60 * 60 * 1000;
    if (period === 'today' && createdAt.toDateString() !== now.toDateString()) {
      return false;
    }
    if (period === '7d' && diffMs > 7 * dayMs) {
      return false;
    }
    if (period === '30d' && diffMs > 30 * dayMs) {
      return false;
    }
  }
  if (search) {
    const { tagMap, userMap } = buildMaps(db);
    const invoiceText = [
      invoice.vendor,
      invoice.senderEmail,
      invoice.senderPhone,
      invoice.amountTotal ? invoice.amountTotal.toString() : '',
      invoice.invoiceDate,
      invoice.status,
      ...invoice.tags.map((link) => {
        const tagEntry = tagMap.get(link.tagId);
        return tagEntry ? tagEntry.label : '';
      }),
      (() => {
        const user = userMap.get(invoice.senderUserId);
        return user ? user.name : '';
      })(),
    ]
      .join(' ')
      .toLowerCase();
    if (!invoiceText.includes(search.toLowerCase())) {
      return false;
    }
  }
  return true;
}

async function getTags(req, res) {
  const db = await loadDb();
  const usage = computeTagUsage(db);
  const tags = db.tags
    .filter((tag) => tag.orgId === ORG_ID)
    .map((tag) => ({
      ...tag,
      usageCount: usage[tag.id] ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  sendJson(res, 200, tags);
}

async function createTag(req, res) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const { label, color = '#4f46e5', createdByUserId = null } = body;
  if (!label || typeof label !== 'string' || !label.trim()) {
    sendJson(res, 400, { error: 'Label requis' });
    return;
  }
  const normalized = label.trim();
  const db = await loadDb();
  const exists = db.tags.some(
    (tag) => tag.orgId === ORG_ID && tag.label.toLowerCase() === normalized.toLowerCase(),
  );
  if (exists) {
    sendJson(res, 409, { error: 'Ce tag existe déjà' });
    return;
  }
  const tag = {
    id: `tag-${randomUUID()}`,
    orgId: ORG_ID,
    label: normalized,
    color,
    isSystem: false,
    createdAt: new Date().toISOString(),
    createdByUserId,
  };
  db.tags.push(tag);
  await saveDb(db);
  sendJson(res, 201, tag);
}

async function deleteTag(req, res, params) {
  const [id] = params;
  const db = await loadDb();
  const usage = computeTagUsage(db);
  if ((usage[id] ?? 0) > 0) {
    sendJson(res, 409, { error: 'Tag utilisé sur des factures' });
    return;
  }
  const index = db.tags.findIndex((tag) => tag.id === id && tag.orgId === ORG_ID);
  if (index === -1) {
    sendJson(res, 404, { error: 'Tag introuvable' });
    return;
  }
  const [removed] = db.tags.splice(index, 1);
  await saveDb(db);
  sendJson(res, 200, removed);
}

async function listInvoices(req, res, _params, searchParams) {
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || 'all';
  const tag = searchParams.get('tag') || 'all';
  const period = searchParams.get('period') || 'all';

  const db = await loadDb();
  const invoices = db.invoices
    .filter((invoice) => invoice.orgId === ORG_ID)
    .filter((invoice) => matchesFilters(invoice, db, { search, status, tag, period }))
    .map((invoice) => decorateInvoice(invoice, db))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  sendJson(res, 200, invoices);
}

async function getInvoice(req, res, params) {
  const [id] = params;
  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === id && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }
  sendJson(res, 200, decorateInvoice(invoice, db));
}

async function patchInvoice(req, res, params) {
  const [id] = params;
  const body = await readJsonBody(req, res);
  if (!body) return;

  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === id && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }

  const allowed = new Set(['vendor', 'amountTotal', 'invoiceDate', 'status', 'paymentMethod', 'ocrFields']);
  Object.entries(body).forEach(([key, value]) => {
    if (allowed.has(key)) {
      invoice[key] = value;
    }
  });
  invoice.updatedAt = new Date().toISOString();
  await saveDb(db);
  sendJson(res, 200, decorateInvoice(invoice, db));
}

async function createInvoice(req, res) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const {
    vendor,
    amountTotal,
    invoiceDate,
    senderUserId,
    source = 'upload',
    paymentMethod = '',
    previewUrl = '',
    notes = '',
  } = body;

  if (!vendor) {
    sendJson(res, 400, { error: 'Fournisseur requis' });
    return;
  }

  const db = await loadDb();
  const invoice = {
    id: `inv-${randomUUID()}`,
    orgId: ORG_ID,
    senderUserId: senderUserId || null,
    source,
    originalFilename: null,
    driveFileId: null,
    driveFileUrl: null,
    previewUrl,
    amountTotal: amountTotal !== undefined && amountTotal !== null ? Number(amountTotal) : null,
    invoiceDate: invoiceDate || null,
    vendor,
    paymentMethod,
    status: 'nouvelle',
    notes,
    tags: [],
    ocrFields: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.invoices.push(invoice);
  await saveDb(db);
  sendJson(res, 201, decorateInvoice(invoice, db));
}

async function addInvoiceTag(req, res, params) {
  const [invoiceId] = params;
  const body = await readJsonBody(req, res);
  if (!body) return;
  const { tagId, appliedByUserId = null } = body;
  if (!tagId) {
    sendJson(res, 400, { error: 'tagId requis' });
    return;
  }
  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === invoiceId && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }
  const hasTag = invoice.tags.some((link) => link.tagId === tagId);
  if (!hasTag) {
    invoice.tags.push({
      tagId,
      appliedByUserId,
      createdAt: new Date().toISOString(),
    });
    invoice.updatedAt = new Date().toISOString();
    await saveDb(db);
  }
  sendJson(res, 200, decorateInvoice(invoice, db));
}

async function removeInvoiceTag(req, res, params) {
  const [invoiceId, tagId] = params;
  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === invoiceId && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }
  const index = invoice.tags.findIndex((link) => link.tagId === tagId);
  if (index === -1) {
    sendJson(res, 404, { error: 'Tag non appliqué' });
    return;
  }
  const [removed] = invoice.tags.splice(index, 1);
  invoice.updatedAt = new Date().toISOString();
  await saveDb(db);
  sendJson(res, 200, { removed, invoice: decorateInvoice(invoice, db) });
}

async function listMessages(req, res, params) {
  const [invoiceId] = params;
  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === invoiceId && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }
  const messages = db.messages
    .filter((message) => message.invoiceId === invoiceId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((message) => decorateMessage(message, db));
  sendJson(res, 200, messages);
}

async function createMessage(req, res, params) {
  const [invoiceId] = params;
  const body = await readJsonBody(req, res);
  if (!body) return;
  const { body: messageBody, fromUserId = null, fromExternalPhone = null, attachments = [] } = body;
  if (!messageBody || typeof messageBody !== 'string' || !messageBody.trim()) {
    sendJson(res, 400, { error: 'Message vide' });
    return;
  }
  const db = await loadDb();
  const invoice = db.invoices.find((item) => item.id === invoiceId && item.orgId === ORG_ID);
  if (!invoice) {
    sendJson(res, 404, { error: 'Facture introuvable' });
    return;
  }
  const message = {
    id: `msg-${randomUUID()}`,
    invoiceId,
    fromUserId,
    fromExternalPhone,
    body: messageBody.trim(),
    attachments,
    sentVia: fromExternalPhone ? 'sms' : 'inapp',
    deliveryStatus: 'sent',
    createdAt: new Date().toISOString(),
  };
  db.messages.push(message);
  invoice.updatedAt = new Date().toISOString();
  await saveDb(db);
  sendJson(res, 201, decorateMessage(message, db));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function readJsonBody(req, res) {
  try {
    const raw = await readBody(req);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (error) {
    sendJson(res, 400, { error: 'JSON invalide' });
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req
      .on('data', (chunk) => {
        chunks.push(chunk);
      })
      .on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      })
      .on('error', reject);
  });
}
