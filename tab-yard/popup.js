// popup.js — KATIE'S TAB YARD (remove-before-open so ticker drops + persists)

document.addEventListener('DOMContentLoaded', () => {
  byId('captureBtn').addEventListener('click', captureCurrentTabs);
  byId('importBtn').addEventListener('click', () => byId('importInput').click());
  byId('importInput').addEventListener('change', handleImportFiles);
  byId('randomBtn').addEventListener('click', showRandomCard);
  init();
});

let savedTabs = [];
let counts = { imported: 0, captured: 0 };
let currentPick = null;

/* ---------- helpers ---------- */
function byId(id){ return document.getElementById(id); }
function clear(el){ while (el.firstChild) el.removeChild(el.firstChild); }
function setText(t){ const r = byId('result'); clear(r); r.textContent = t; }
function updateCounters(){
  byId('countTotal').textContent = savedTabs.length;
  byId('countImported').textContent = counts.imported;
  byId('countCaptured').textContent = counts.captured;
}
function tryHost(u){ try { return new URL(u).host; } catch { return ''; } }
function safeFavicon(u){ try { return new URL(u).origin + '/favicon.ico'; } catch { return ''; } }
function el(tag, props={}){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(props)) {
    if (k === 'className') n.className = v;
    else if (k === 'textContent') n.textContent = v;
    else n.setAttribute(k, v);
  }
  return n;
}

/* ---------- init ---------- */
async function init(){
  const data = await chrome.storage.local.get(['savedTabs','counts','currentPick']);
  savedTabs = Array.isArray(data.savedTabs) ? data.savedTabs : [];
  counts = Object.assign({ imported: 0, captured: 0 }, data.counts);
  currentPick = null; // don’t render stale pick
  await chrome.storage.local.remove('currentPick');
  updateCounters();
}

/* ---------- capture/import ---------- */
async function captureCurrentTabs(){
  const tabs = await chrome.tabs.query({});
  const captured = tabs
    .filter(t => t.url && /^https?:\/\//i.test(t.url))
    .map(t => ({ title: t.title || '(untitled)', url: t.url, saved: Date.now(), source: 'captured' }));
  const { added } = await mergeAndPersist(captured);
  counts.captured += added; await chrome.storage.local.set({ counts });
  setText('Captured ' + added + ' new tab(s).');
}

async function handleImportFiles(e){
  const files = Array.from(e.target.files || []); if (!files.length) return;
  let all = [];
  for (const f of files) {
    try {
      const json = JSON.parse(await f.text());
      extractUrls(json).forEach(u => all.push({
        title: u.title || '(untitled)', url: u.url, saved: Date.now(), source: 'imported'
      }));
    } catch (err) { console.error('Import failed for', f.name, err); }
  }
  const { added } = await mergeAndPersist(all);
  counts.imported += added; await chrome.storage.local.set({ counts });
  setText('Imported ' + added + ' new URL(s).');
  e.target.value = '';
}

/* Pull URLs from arbitrary JSON */
function extractUrls(input){
  const out = [];
  const push = (o) => {
    if (!o || typeof o !== 'object') return;
    const u = o.url || o.href || o.link;
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
      out.push({ url: u, title: o.title || o.name || o.text || o.label || '' });
    }
  };
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      push(n);
      for (const v of Object.values(n)) if (v && (Array.isArray(v) || typeof v === 'object')) walk(v);
    }
  };
  try { walk(input); } catch (e) { console.error(e); }
  const map = new Map();
  for (const i of out) if (!map.has(i.url)) map.set(i.url, i);
  return [...map.values()];
}

async function mergeAndPersist(items){
  const pre = savedTabs.length;
  const map = new Map(savedTabs.map(x => [x.url, x]));
  for (const it of items) if (it?.url && !map.has(it.url)) map.set(it.url, it);
  savedTabs = [...map.values()];
  await chrome.storage.local.set({ savedTabs });
  updateCounters();
  return { added: savedTabs.length - pre };
}

/* ---------- random card ---------- */
function showRandomCard(){
  if (!savedTabs.length) {
    setText('No saved items left — Import Tabs or Capture Tabs first.');
    return;
  }
  const pick = savedTabs[Math.floor(Math.random() * savedTabs.length)];
  renderCard(pick);
}

function renderCard(tab){
  const r = byId('result'); clear(r);

  const card = el('div', { className: 'card' });
  const titleRow = el('div', { className: 'card-title' });

  const img = el('img');
  const fav = safeFavicon(tab.url);
  if (fav) {
    img.src = fav;
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
    titleRow.appendChild(img);
  }

  titleRow.appendChild(el('span', { textContent: tab.title || '(untitled)' }));
  const hostText = el('div', { className: 'site-host', textContent: tryHost(tab.url) || '' });

  const btnRow = el('div', { className: 'btn-row' });
  const visitBtn = el('button', { textContent: 'Visit page' });
  const nextBtn  = el('button', { textContent: 'Next random' });

  visitBtn.addEventListener('click', async () => {
    // 1) Remove from storage FIRST (so it persists even if popup closes)
    await removeFromPoolStorage(tab.url);

    // 2) Open the page
    await chrome.tabs.create({ url: tab.url, active: true });

    // 3) Optional: replace card with a new random pick in case popup stays open
    if (savedTabs.length) showRandomCard(); else setText('No saved items left — nice!');
  });

  nextBtn.addEventListener('click', showRandomCard);

  btnRow.appendChild(visitBtn);
  btnRow.appendChild(nextBtn);

  card.appendChild(titleRow);
  card.appendChild(hostText);
  card.appendChild(btnRow);
  r.appendChild(card);
}

/* ---------- removal that ALWAYS persists ---------- */
async function removeFromPoolStorage(url){
  // Work directly against storage to avoid stale in-memory state
  const data = await chrome.storage.local.get('savedTabs');
  const list = Array.isArray(data.savedTabs) ? data.savedTabs : [];
  const after = list.filter(x => x.url !== url);

  await chrome.storage.local.set({ savedTabs: after });
  await chrome.storage.local.remove('currentPick');

  // mirror to local state for immediate UI update
  savedTabs = after;
  updateCounters();
}
