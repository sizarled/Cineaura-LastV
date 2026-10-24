const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('workspace book actions use the digital-book document editor and stored documents', () => {
  const dashboard = read('js/creator-dashboard.js');
  const editor = read('js/documents.js');
  assert.match(dashboard, /community_documents.*kind=eq\.book/);
  assert.match(dashboard, /book%20editor\.html\?workspace=/);
  assert.match(editor, /ctx\.mode === "book"/);
  assert.match(editor, /content_type: bookMode \? "book"/);
  for (const ext of ['epub', 'mobi', 'azw3', 'fb2', 'djvu', 'cbz', 'cbr']) assert.ok(editor.includes(`"${ext}"`));
});

test('podcast editor uploads audio, persists episode metadata and dashboard supports playback', () => {
  const editor = read('js/podcast-editor.js');
  const dashboard = read('js/creator-dashboard.js');
  assert.match(editor, /storage\/v1\/object\/creator-media/);
  assert.match(editor, /content_type: "podcast"/);
  assert.match(editor, /duration_seconds:/);
  assert.match(dashboard, /<audio controls/);
  assert.match(dashboard, /data-delete-podcast/);
});

test('creator media migration extends book types and provisions the audio bucket', () => {
  const sql = read('sql/creator_workspace_media.sql');
  assert.match(sql, /'book'\)/);
  assert.match(sql, /creator-media/);
  assert.match(sql, /duration_seconds/);
});
