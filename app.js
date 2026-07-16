/* =======================================================
   ESPAÑOLIA — app.js
   App de leitura em espanhol com vocabulário salvo em
   Google Sheets (via Google Apps Script) + Flashcards SRS
   ======================================================= */

const LS_API_URL = 'espanolia_api_url';
let API_URL = localStorage.getItem(LS_API_URL) || '';

let state = {
  view: 'import',
  lessons: [],
  vocab: [],
  currentLesson: null,
  activeWordEl: null,
  flashcards: { direction: 'es-pt', queue: [], index: 0, flipped: false }
};

/* ---------------- Utilidades de API ---------------- */

async function api(action, params = {}, method = 'GET') {
  if (!API_URL) throw new Error('API não configurada');
  if (method === 'GET') {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API_URL}?${qs}`);
    return res.json();
  } else {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...params })
    });
    return res.json();
  }
}

/* ---------------- Navegação ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('bottomNav').classList.toggle('hidden', name === 'reader' || name === 'setup');
  state.view = name;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === 'vocab') renderVocab();
  });
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('apiUrlInput').value = API_URL;
  showView('setup');
});

/* ---------------- Setup inicial ---------------- */

document.getElementById('saveApiUrlBtn').addEventListener('click', async () => {
  const val = document.getElementById('apiUrlInput').value.trim();
  if (!val) return;
  API_URL = val;
  localStorage.setItem(LS_API_URL, val);
  await boot();
});

async function boot() {
  if (!API_URL) { showView('setup'); return; }
  showView('import');
  try {
    await Promise.all([loadLessons(), loadVocab()]);
  } catch (e) {
    console.error(e);
  }
}

/* ---------------- Importar lições ---------------- */

document.querySelectorAll('.import-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode;
    document.getElementById('importForm').classList.remove('hidden');
    document.getElementById('lessonUrl').classList.toggle('hidden', mode !== 'url');
    document.getElementById('lessonText').classList.toggle('hidden', mode !== 'text');
    document.getElementById('importForm').dataset.mode = mode;
  });
});

document.getElementById('doImportBtn').addEventListener('click', async () => {
  const mode = document.getElementById('importForm').dataset.mode;
  const title = document.getElementById('lessonTitle').value.trim() || 'Lección sin título';
  const statusEl = document.getElementById('importStatus');
  let content = '';
  let source = '';

  if (mode === 'url') {
    const url = document.getElementById('lessonUrl').value.trim();
    if (!url) return;
    source = url;
    statusEl.textContent = 'Baixando e extraindo texto...';
    try {
      // Usa o "reader" público do Jina AI para extrair texto legível de qualquer URL
      // (evita problemas de CORS e já retorna texto limpo, sem HTML)
      const readerUrl = 'https://r.jina.ai/' + url;
      const res = await fetch(readerUrl);
      if (!res.ok) throw new Error('Falha ao acessar a URL');
      content = await res.text();
    } catch (e) {
      statusEl.textContent = '❌ Não consegui importar essa URL. Tente colar o texto diretamente.';
      return;
    }
  } else {
    content = document.getElementById('lessonText').value.trim();
    source = 'texto colado';
    if (!content) return;
  }

  statusEl.textContent = 'Salvando na sua planilha...';
  try {
    const res = await api('saveLesson', { title, source, content }, 'POST');
    if (res.error) throw new Error(res.error);
    statusEl.textContent = '✅ Lição importada!';
    document.getElementById('lessonTitle').value = '';
    document.getElementById('lessonUrl').value = '';
    document.getElementById('lessonText').value = '';
    document.getElementById('importForm').classList.add('hidden');
    await loadLessons();
  } catch (e) {
    statusEl.textContent = '❌ Erro ao salvar: ' + e.message;
  }
});

async function loadLessons() {
  const res = await api('getLessons');
  state.lessons = (res.data || []).reverse();
  renderLessonList();
}

function renderLessonList() {
  const el = document.getElementById('lessonList');
  el.innerHTML = '';
  if (!state.lessons.length) {
    el.innerHTML = '<p class="hint">Nenhuma lição ainda. Importe uma acima!</p>';
    return;
  }
  state.lessons.forEach(lesson => {
    const div = document.createElement('div');
    div.className = 'lesson-item';
    const words = (lesson.content || '').split(/\s+/).length;
    div.innerHTML = `
      <div>
        <div class="l-title">${escapeHtml(lesson.title)}</div>
        <div class="l-meta">${words} palavras · ${new Date(lesson.dateAdded).toLocaleDateString('pt-BR')}</div>
      </div>
      <span>›</span>`;
    div.addEventListener('click', () => openReader(lesson));
    el.appendChild(div);
  });
}

/* ---------------- Leitor ---------------- */

function openReader(lesson) {
  state.currentLesson = lesson;
  document.getElementById('readerTitle').textContent = lesson.title;
  const contentEl = document.getElementById('readerContent');
  contentEl.innerHTML = '';

  const tokens = tokenize(lesson.content || '');
  tokens.forEach(tok => {
    if (tok.type === 'word') {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = tok.text;
      span.dataset.word = normalizeWord(tok.text);
      markIfSaved(span);
      span.addEventListener('click', () => openWordPopup(span));
      contentEl.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.className = 'punct';
      span.textContent = tok.text;
      contentEl.appendChild(span);
    }
  });

  showView('reader');
}

function tokenize(text) {
  // separa em palavras e "resto" (pontuação/espaços), preservando quebras de linha
  const parts = text.split(/(\s+|[.,;:!?¿¡"«»()—–-]+)/);
  return parts.filter(p => p !== '').map(p => ({
    type: /^[a-zA-ZÀ-ÿ]+$/.test(p) ? 'word' : 'other',
    text: p
  }));
}

function normalizeWord(w) {
  return w.toLowerCase();
}

function markIfSaved(span) {
  const w = span.dataset.word;
  const found = state.vocab.find(v => v.word.toLowerCase() === w);
  span.classList.remove('saved-1', 'saved-2', 'saved-3', 'saved-4', 'saved-5');
  if (found) span.classList.add('saved-' + (found.box || 1));
}

document.getElementById('backFromReader').addEventListener('click', () => showView('import'));

document.getElementById('deleteLessonBtn').addEventListener('click', async () => {
  if (!state.currentLesson) return;
  if (!confirm('Excluir esta lição?')) return;
  await api('deleteLesson', { id: state.currentLesson.id }, 'POST');
  await loadLessons();
  showView('import');
});

/* ---------------- Popup de palavra ---------------- */

let popupContext = null; // { word, existing }

function openWordPopup(span) {
  if (state.activeWordEl) state.activeWordEl.classList.remove('active-word');
  state.activeWordEl = span;
  span.classList.add('active-word');

  const word = span.dataset.word;
  const existing = state.vocab.find(v => v.word.toLowerCase() === word);

  popupContext = { word, existing, rawText: span.textContent };

  document.getElementById('popupWord').textContent = span.textContent;
  document.getElementById('popupTranslation').value = existing ? existing.translation : '';
  document.getElementById('popupCategory').value = existing ? existing.category : '';
  document.getElementById('popupExample').textContent = existing ? '' : getContextSentence(span);
  document.getElementById('popupDelete').classList.toggle('hidden', !existing);

  document.getElementById('wordPopup').classList.remove('hidden');
  document.getElementById('popupOverlay').classList.remove('hidden');
}

function closeWordPopup() {
  document.getElementById('wordPopup').classList.add('hidden');
  document.getElementById('popupOverlay').classList.add('hidden');
  if (state.activeWordEl) state.activeWordEl.classList.remove('active-word');
}

document.getElementById('popupClose').addEventListener('click', closeWordPopup);
document.getElementById('popupOverlay').addEventListener('click', closeWordPopup);

function getContextSentence(span) {
  const content = state.currentLesson ? state.currentLesson.content : '';
  const idx = content.toLowerCase().indexOf(span.textContent.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, content.lastIndexOf('.', idx) + 1);
  const end = content.indexOf('.', idx);
  return content.substring(start, end === -1 ? content.length : end + 1).trim();
}

document.getElementById('popupTranslateBtn').addEventListener('click', async () => {
  if (!popupContext) return;
  const btn = document.getElementById('popupTranslateBtn');
  btn.textContent = 'Traduzindo...';
  try {
    const res = await api('translate', { text: popupContext.rawText, source: 'es', target: 'pt' });
    document.getElementById('popupTranslation').value = res.translation || '';
  } catch (e) {
    alert('Erro ao traduzir: ' + e.message);
  }
  btn.textContent = 'Traduzir (Google)';
});

document.getElementById('popupSave').addEventListener('click', async () => {
  if (!popupContext) return;
  const translation = document.getElementById('popupTranslation').value.trim();
  const category = document.getElementById('popupCategory').value.trim();
  const example = getContextSentence(state.activeWordEl);

  try {
    if (popupContext.existing) {
      await api('updateWord', {
        id: popupContext.existing.id, translation, category
      }, 'POST');
    } else {
      await api('saveWord', {
        word: popupContext.rawText, translation, category, example
      }, 'POST');
    }
    await loadVocab();
    markIfSaved(state.activeWordEl);
    closeWordPopup();
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
  }
});

document.getElementById('popupDelete').addEventListener('click', async () => {
  if (!popupContext || !popupContext.existing) return;
  if (!confirm('Remover esta palavra do vocabulário?')) return;
  await api('deleteWord', { id: popupContext.existing.id }, 'POST');
  await loadVocab();
  markIfSaved(state.activeWordEl);
  closeWordPopup();
});

/* ---------------- Vocabulário ---------------- */

async function loadVocab() {
  const res = await api('getVocab');
  state.vocab = (res.data || []).map(v => ({ ...v, box: Number(v.box) || 1 }));
}

let vocabFilter = 'all';

document.querySelectorAll('.vocab-filters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.vocab-filters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    vocabFilter = chip.dataset.filter;
    renderVocab();
  });
});

document.getElementById('vocabSearch').addEventListener('input', renderVocab);

function renderVocab() {
  const el = document.getElementById('vocabList');
  const q = document.getElementById('vocabSearch').value.toLowerCase();
  let list = state.vocab.slice().reverse();

  if (vocabFilter !== 'all') {
    if (vocabFilter === '5') list = list.filter(v => v.box >= 5);
    else list = list.filter(v => String(v.box) === vocabFilter);
  }
  if (q) list = list.filter(v => v.word.toLowerCase().includes(q) || (v.translation || '').toLowerCase().includes(q));

  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<p class="hint">Nenhuma palavra encontrada.</p>';
    return;
  }
  const colors = { 1: 'var(--box1)', 2: 'var(--box2)', 3: 'var(--box3)', 4: 'var(--box4)', 5: 'var(--box5)' };
  list.forEach(v => {
    const div = document.createElement('div');
    div.className = 'vocab-item';
    div.innerHTML = `
      <div class="v-box" style="background:${colors[v.box] || colors[1]}"></div>
      <div class="v-main">
        <div class="v-word">${escapeHtml(v.word)}</div>
        <div class="v-trans">${escapeHtml(v.translation || '')}</div>
        ${v.category ? `<div class="v-cat">${escapeHtml(v.category)}</div>` : ''}
      </div>`;
    el.appendChild(div);
  });
}

/* ---------------- Flashcards ---------------- */

document.getElementById('dirEsPt').addEventListener('click', () => setFlashDirection('es-pt'));
document.getElementById('dirPtEs').addEventListener('click', () => setFlashDirection('pt-es'));

function setFlashDirection(dir) {
  state.flashcards.direction = dir;
  document.getElementById('dirEsPt').classList.toggle('active', dir === 'es-pt');
  document.getElementById('dirPtEs').classList.toggle('active', dir === 'pt-es');
}

document.getElementById('startFlashBtn').addEventListener('click', startFlashSession);

function startFlashSession() {
  const now = new Date();
  let due = state.vocab.filter(v => !v.nextReview || new Date(v.nextReview) <= now);
  if (!due.length) due = state.vocab.slice(); // se nada está "due", revisa tudo mesmo assim
  if (!due.length) {
    document.getElementById('flashArea').innerHTML = '<p class="hint">Você ainda não tem palavras salvas. Vá ler uma lição primeiro!</p>';
    return;
  }
  shuffle(due);
  state.flashcards.queue = due;
  state.flashcards.index = 0;
  state.flashcards.flipped = false;
  renderFlashcard();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function renderFlashcard() {
  const fc = state.flashcards;
  const area = document.getElementById('flashArea');

  if (fc.index >= fc.queue.length) {
    area.innerHTML = `
      <p class="hint">🎉 Revisão concluída! Você revisou ${fc.queue.length} palavras.</p>
      <button class="btn-primary" id="startFlashBtn2">Revisar novamente</button>`;
    document.getElementById('startFlashBtn2').addEventListener('click', startFlashSession);
    return;
  }

  const item = fc.queue[fc.index];
  const front = fc.direction === 'es-pt' ? item.word : (item.translation || '?');
  const back = fc.direction === 'es-pt' ? (item.translation || '?') : item.word;

  area.innerHTML = `
    <div class="flash-progress">${fc.index + 1} / ${fc.queue.length}</div>
    <div class="flashcard" id="flashcardEl">
      <div class="fc-front">
        <div class="fc-word">${escapeHtml(front)}</div>
        <div class="fc-hint">Toque para ver a resposta</div>
      </div>
      <div class="fc-back">
        <div class="fc-word">${escapeHtml(back)}</div>
        ${item.example ? `<div class="fc-example">${escapeHtml(item.example)}</div>` : ''}
      </div>
    </div>
    <div class="flash-buttons">
      <button class="btn-wrong" id="fcWrong">Não sabia</button>
      <button class="btn-right" id="fcRight">Sabia!</button>
    </div>`;

  const cardEl = document.getElementById('flashcardEl');
  cardEl.addEventListener('click', () => {
    fc.flipped = !fc.flipped;
    cardEl.classList.toggle('flipped', fc.flipped);
  });

  document.getElementById('fcWrong').addEventListener('click', () => answerFlash('wrong'));
  document.getElementById('fcRight').addEventListener('click', () => answerFlash('correct'));
}

async function answerFlash(result) {
  const fc = state.flashcards;
  const item = fc.queue[fc.index];
  try {
    await api('reviewWord', { id: item.id, result }, 'POST');
  } catch (e) { console.error(e); }
  fc.index++;
  fc.flipped = false;
  renderFlashcard();
  loadVocab(); // atualiza caixas em segundo plano
}

/* ---------------- Helpers ---------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- Boot ---------------- */

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
