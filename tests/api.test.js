const assert = require('node:assert/strict');
const { mkdtemp, copyFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = resolve(__dirname, '..');
const ORIGINAL_DB = join(ROOT_DIR, 'data', 'db.json');

(async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'inbox-test-'));
  const tempDb = join(tempDir, 'db.json');
  await copyFile(ORIGINAL_DB, tempDb);

  const port = 4100 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(port), DB_PATH: tempDb },
    stdio: 'inherit',
  });

  try {
    await waitForServer(port);
    const client = createClient(port);

    const tags = await client.get('/api/tags');
    assert.ok(Array.isArray(tags) && tags.length > 0, 'tags should load');

    const createdTag = await client.post('/api/tags', { label: 'Test QA', color: '#ff6ad5' });
    assert.ok(createdTag.id, 'created tag should have id');

    const removed = await client.delete(`/api/tags/${createdTag.id}`);
    assert.equal(removed.id, createdTag.id, 'removed tag should match created tag');

    const createdInvoice = await client.post('/api/invoices', {
      vendor: 'Testeur Inc.',
      amountTotal: 42.5,
      invoiceDate: '2024-01-01',
      source: 'upload',
      paymentMethod: 'Visa',
      previewUrl: '',
    });
    assert.equal(createdInvoice.vendor, 'Testeur Inc.');

    const fetchedInvoice = await client.get(`/api/invoices/${createdInvoice.id}`);
    assert.equal(fetchedInvoice.id, createdInvoice.id, 'created invoice should be retrievable');

    const message = await client.post(`/api/invoices/${createdInvoice.id}/messages`, {
      body: 'Bonjour! Peux-tu confirmer?',
    });
    assert.equal(message.body, 'Bonjour! Peux-tu confirmer?');

    const tagged = await client.post(`/api/invoices/${createdInvoice.id}/tags`, {
      tagId: tags[0].id,
      appliedByUserId: 'user-tagger',
    });
    assert.ok(tagged.tags.some((entry) => entry.tagId === tags[0].id), 'tag should be applied');

    console.log('Tests API réussis.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.on('exit', resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
})();

async function waitForServer(port) {
  const url = `http://localhost:${port}/api/tags`;
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_) {
      // retry
    }
    await delay(150);
  }
  throw new Error('Le serveur ne répond pas.');
}

function createClient(port) {
  const base = `http://localhost:${port}`;
  return {
    get: (path) => fetchJSON(`${base}${path}`),
    post: (path, body) =>
      fetchJSON(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    delete: (path) => fetchJSON(`${base}${path}`, { method: 'DELETE' }),
  };
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    if (isJson) {
      try {
        const payload = await response.json();
        if (payload?.error) {
          message = payload.error;
        }
      } catch (_) {
        // ignore
      }
    }
    throw new Error(message);
  }
  if (!isJson || response.status === 204) {
    return null;
  }
  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
