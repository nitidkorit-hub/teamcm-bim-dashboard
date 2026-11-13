/* TEAM·CM BIM Dashboard — Library full-text search.
   The text layer of each PDF is extracted in the browser with pdf.js (free, no server),
   stored per page / per line in Realtime Database (`library_index/{docId}`), and searched
   client-side — so a hit can say which document, which page and which line, like Find in a PDF.
   Scanned PDFs have no text layer; they are detected and reported (they need OCR first). */

const PDFJS_VER = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}`;
const LIB_SEARCH_MAX_RESULTS = 300;
const _libIndexCache = {};   // docId -> { pages: [text…], norm: [[normalised line…]…] }
let _pdfjsPromise = null;

function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${PDFJS_BASE}/pdf.min.js`;
    s.onload = async () => {
      try {
        // A cross-origin worker URL silently hangs pdf.js, so run it from a same-origin blob.
        const code = await (await fetch(`${PDFJS_BASE}/pdf.worker.min.js`)).text();
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        resolve(window.pdfjsLib);
      } catch (e) { _pdfjsPromise = null; reject(e); }
    };
    s.onerror = () => { _pdfjsPromise = null; reject(new Error('โหลด pdf.js ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต')); };
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

/** Text of one PDF page as lines (items grouped by baseline, left→right). */
function _pageLines(items) {
  const its = items.filter(it => it.str && it.str.trim());
  its.sort((a, b) => b.transform[5] - a.transform[5]);
  const rows = [];
  its.forEach(it => {
    const y = it.transform[5];
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(row.y - y) <= 3) row.items.push(it);
    else rows.push({ y, items: [it] });
  });
  return rows.map(r => {
    r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let out = '';
    let lastEnd = null;
    r.items.forEach(it => {
      const x = it.transform[4];
      if (lastEnd !== null && x - lastEnd > (it.height || 10) * 0.25) out += ' ';
      out += it.str;
      lastEnd = x + (it.width || 0);
    });
    return out.trim();
  }).filter(Boolean);
}

async function extractPdfPages(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  let emptyPages = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const text = _pageLines(tc.items).join('\n');
    if (!text) emptyPages++;
    pages.push(text);
    if (onProgress && (n % 10 === 0 || n === pdf.numPages)) onProgress(n, pdf.numPages);
    page.cleanup();
  }
  return { pages, emptyPages };
}

/** Builds and stores the search index for one library PDF. Returns true on success. */
async function indexLibraryDoc(doc, file) {
  toast(`🔎 กำลังสร้างดัชนีค้นหา "${doc.title}"…`, '#3A6EA5', 60000);
  try {
    const { pages, emptyPages } = await extractPdfPages(file, (n, total) =>
      toast(`🔎 กำลังอ่านเอกสาร ${n}/${total} หน้า…`, '#3A6EA5', 60000));
    if (emptyPages === pages.length) {
      toast('⚠️ ไฟล์นี้ไม่มีข้อความให้ค้นหา (น่าจะเป็นภาพสแกน) — ต้องทำ OCR ก่อนจึงจะค้นหาได้', '#d97706', 7000);
      return false;
    }
    const index = { pages, emptyPages, indexedAt: new Date().toISOString() };
    if (JSON.stringify(index).length > 12e6) {
      toast('⚠️ เอกสารมีข้อความมากเกินไปสำหรับสร้างดัชนี (เกิน ~12MB ของข้อความ)', '#d97706', 7000);
      return false;
    }
    await fbSaveLibraryIndex(doc.id, index);
    doc.indexed = true;
    doc.indexPages = pages.length;
    doc.indexEmpty = emptyPages;
    delete _libIndexCache[doc.id];
    await fbSaveLibraryDocs(LIBRARY_DOCS);
    toast(`✓ สร้างดัชนีค้นหา "${doc.title}" แล้ว · ${pages.length} หน้า${emptyPages ? ` (ไม่มีข้อความ ${emptyPages} หน้า)` : ''}`, '#2DBE60', 4000);
    return true;
  } catch (e) {
    saveFail('ดัชนีค้นหา')(e);
    return false;
  }
}

/** "สร้างดัชนีค้นหา" button on a card: pick the local copy of the PDF, then index it. */
function indexLibraryDocPrompt(docId) {
  if (!requirePermission('library', 'สร้างดัชนีค้นหา')) return;
  const doc = LIBRARY_DOCS.find(d => d.id === docId);
  if (!doc) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    await indexLibraryDoc(doc, file);
    render();
  };
  input.click();
}

function _normText(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

async function _loadLibraryIndex(doc) {
  if (_libIndexCache[doc.id]) return _libIndexCache[doc.id];
  const raw = await fbLoadLibraryIndex(doc.id);
  if (!raw) return null;
  const pages = Array.isArray(raw.pages) ? raw.pages : Object.values(raw.pages || {});
  const entry = { pages, norm: pages.map(t => String(t || '').split('\n').map(_normText)) };
  _libIndexCache[doc.id] = entry;
  return entry;
}

/** Every line (document · page · line) containing the query; whitespace-insensitive, also matches across a line break. */
async function searchLibraryIndexes(query) {
  const nq = _normText(query);
  const results = [];
  let searched = 0;
  let truncated = false;
  for (const doc of LIBRARY_DOCS) {
    if (!doc.indexed) continue;
    const idx = await _loadLibraryIndex(doc);
    if (!idx) continue;
    searched++;
    for (let p = 0; p < idx.pages.length && !truncated; p++) {
      const lines = String(idx.pages[p] || '').split('\n');
      const norm = idx.norm[p];
      for (let l = 0; l < lines.length; l++) {
        let hit = norm[l].includes(nq);
        let text = lines[l];
        if (!hit && l + 1 < lines.length && norm[l].length && (norm[l] + norm[l + 1]).includes(nq) && !norm[l + 1].includes(nq)) {
          hit = true;
          text = lines[l] + ' ' + lines[l + 1];
        }
        if (hit) {
          results.push({ doc, page: p + 1, line: l + 1, text });
          if (results.length >= LIB_SEARCH_MAX_RESULTS) { truncated = true; break; }
        }
      }
    }
    if (truncated) break;
  }
  return { results, searched, truncated };
}

function _highlight(line, query) {
  const chars = [...String(query).replace(/\s+/g, '')];
  if (!chars.length) return esc(line);
  const re = new RegExp(chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(line.slice(last));
}

async function runLibrarySearch() {
  const el = $('#lib-search-q');
  const q = el ? el.value.trim() : '';
  if (!q) return;
  state.libSearch = { q, loading: true, results: null };
  render();
  try {
    const r = await searchLibraryIndexes(q);
    state.libSearch = { q, loading: false, ...r };
  } catch (e) {
    state.libSearch = { q, loading: false, results: [], searched: 0, error: (e && e.message) || String(e) };
  }
  render();
}
function clearLibrarySearch() {
  state.libSearch = null;
  render();
}
function openLibraryHit(docId, page) {
  const d = LIBRARY_DOCS.find(x => x.id === docId);
  if (d) window.open(`${d.fileUrl}#page=${page}`, '_blank');
}

/** Search box + results, shown above the document grid on the Library page. */
function renderLibrarySearch() {
  const s = state.libSearch;
  const indexed = LIBRARY_DOCS.filter(d => d.indexed).length;
  const pdfs = LIBRARY_DOCS.filter(d => /\.pdf$/i.test(d.fileName || '')).length;
  let body = '';
  if (s && s.loading) {
    body = '<div style="padding:18px;color:var(--muted);font-size:13px">กำลังค้นหาในเอกสาร…</div>';
  } else if (s && s.error) {
    body = `<div style="padding:18px;color:#dc2626;font-size:13px">ค้นหาไม่สำเร็จ — ${esc(s.error)}</div>`;
  } else if (s && s.results) {
    body = s.results.length === 0
      ? `<div style="padding:18px;color:var(--muted);font-size:13px">ไม่พบคำว่า "${esc(s.q)}" ในเอกสารที่ทำดัชนีไว้ (${s.searched} ฉบับ)</div>`
      : `<div style="padding:10px 18px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border-2)">พบ <strong>${s.results.length}${s.truncated ? '+' : ''}</strong> ตำแหน่งใน ${s.searched} ฉบับ${s.truncated ? ` · แสดง ${LIB_SEARCH_MAX_RESULTS} รายการแรก ลองใช้คำที่เฉพาะเจาะจงขึ้น` : ''}</div>
        <div style="max-height:420px;overflow:auto">${s.results.map(r => `
        <div class="lib-hit" onclick="openLibraryHit('${r.doc.id}', ${r.page})">
          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px">${esc(r.doc.title)}</span>
            <span class="mono" style="font-size:11.5px;color:var(--blue)">หน้า ${r.page} · บรรทัด ${r.line}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text);margin-top:3px;line-height:1.55">${_highlight(r.text, s.q)}</div>
        </div>`).join('')}</div>`;
  }
  return `<div class="card" style="margin-bottom:14px">
    <div class="card-h"><div><h3>ค้นหาในเนื้อหาเอกสาร</h3>
      <div class="ch-sub">พิมพ์คำหรือข้อความ แล้วดูว่าอยู่ในเอกสารไหน หน้าไหน บรรทัดไหน (เหมือน Find ใน PDF) · ค้นหาได้ ${indexed}/${pdfs} ฉบับ${pdfs > indexed && hasPermission('library') ? ' — กด "สร้างดัชนีค้นหา" ที่การ์ดเอกสาร' : ''}</div></div></div>
    <div style="display:flex;gap:8px;padding:14px 18px">
      <input type="text" id="lib-search-q" class="m-input" style="flex:1;font-size:14px;padding:9px 12px" placeholder="เช่น ทางหนีไฟ, ความกว้างบันได, ระยะห่างจากแนวเขตที่ดิน…" value="${esc(s ? s.q : '')}" onkeydown="if(event.key==='Enter')runLibrarySearch()" />
      <button class="btn btn-p" onclick="runLibrarySearch()">${I.search}<span>ค้นหา</span></button>
      ${s ? `<button class="btn btn-g" onclick="clearLibrarySearch()">ล้าง</button>` : ''}
    </div>
    ${body}
  </div>`;
}

/** Small status line / action on each document card. */
function libraryIndexBadge(d, canManage) {
  if (!/\.pdf$/i.test(d.fileName || '')) return '';
  if (d.indexed) {
    return `<div style="padding:6px 16px 0"><span class="badge b-resolved" style="font-size:9.5px" title="ค้นหาในเนื้อหาได้">🔎 ค้นหาได้ · ${d.indexPages || '?'} หน้า</span>${d.indexEmpty ? `<span class="muted" style="font-size:10px;margin-left:6px">(${d.indexEmpty} หน้าไม่มีข้อความ)</span>` : ''}</div>`;
  }
  return canManage
    ? `<div style="padding:6px 16px 0"><button class="btn btn-g btn-sm" onclick="indexLibraryDocPrompt('${d.id}')">🔎 <span>สร้างดัชนีค้นหา</span></button></div>`
    : '';
}
