/* =======================================================
   ESPAÑOLIA — app.js
   App de leitura em espanhol com vocabulário salvo em
   Google Sheets (via Google Apps Script) + Flashcards SRS
   ======================================================= */

const LS_API_URL = 'espanolia_api_url';

// ---------------------------------------------------------------
// Cole aqui a URL do seu Apps Script (a que termina em /exec).
// Preenchendo isso, o app conecta sozinho e nunca mais pede a tela
// de configuração — nem em outro navegador ou celular.
// Exemplo: 'https://script.google.com/macros/s/AKfycb.../exec'
// ---------------------------------------------------------------
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyuOQsM1xVM-E-_08YEO-gE5MaCBrycFI7iyuw6uKyla9um_je6uX6AHMeoDsq654WJ/exec';

let API_URL = localStorage.getItem(LS_API_URL) || DEFAULT_API_URL || '';
if (DEFAULT_API_URL) localStorage.setItem(LS_API_URL, DEFAULT_API_URL);

let state = {
  view: 'import',
  lessons: [],
  vocab: [],
  currentLesson: null,
  activeWordEl: null,
  flashcards: { direction: 'es-pt', queue: [], index: 0, flipped: false }
};

/* ---------------- Utilidades de API ---------------- */

async function api(action, params = {}) {
  if (!API_URL) throw new Error('API não configurada');
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Resposta inesperada da API:', raw.slice(0, 300));
    throw new Error('A API não retornou JSON. Verifique se a implantação do Apps Script está com acesso "Qualquer pessoa" e se foi criada uma NOVA VERSÃO após a última edição do código.');
  }
}

// Usado só para textos longos (lições), que não cabem numa URL GET.
async function apiPost(action, params = {}) {
  if (!API_URL) throw new Error('API não configurada');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
    body: JSON.stringify({ action, ...params })
  });
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Resposta inesperada da API:', raw.slice(0, 300));
    throw new Error('A API não retornou JSON ao importar a lição. Tente novamente ou verifique a implantação do Apps Script.');
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
    if (btn.dataset.view === 'sources') showSourcesHome();
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

/* ---------------- Leitor em voz alta (Text-to-Speech) ---------------- */

const LS_VOICE = 'espanolia_voice';
const LS_RATE = 'espanolia_rate';

let tts = {
  blocks: [],      // elementos (parágrafos/títulos) na ordem de leitura
  index: 0,
  playing: false,
  voice: null,
  rate: Number(localStorage.getItem(LS_RATE)) || 1
};

function populateVoiceList() {
  const select = document.getElementById('voiceSelect');
  const voices = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('es'));
  if (!voices.length) return; // vozes ainda não carregaram, tenta de novo depois

  const savedName = localStorage.getItem(LS_VOICE);
  select.innerHTML = '';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  const match = voices.find(v => v.name === savedName) || voices.find(v => v.lang === 'es-ES') || voices[0];
  select.value = match.name;
  tts.voice = match;
}

if ('speechSynthesis' in window) {
  populateVoiceList();
  speechSynthesis.onvoiceschanged = populateVoiceList;
}

document.getElementById('voiceSelect').addEventListener('change', (e) => {
  const voices = speechSynthesis.getVoices();
  tts.voice = voices.find(v => v.name === e.target.value) || null;
  localStorage.setItem(LS_VOICE, e.target.value);
});

document.getElementById('rateSelect').addEventListener('change', (e) => {
  tts.rate = Number(e.target.value);
  localStorage.setItem(LS_RATE, String(tts.rate));
});

function resetTTS() {
  speechSynthesis.cancel();
  clearSpeakingHighlight();
  tts.playing = false;
  tts.index = 0;
  document.getElementById('playPauseBtn').textContent = '▶️';
}

function clearSpeakingHighlight() {
  document.querySelectorAll('.word.speaking').forEach(el => el.classList.remove('speaking'));
}

document.getElementById('playPauseBtn').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) {
    alert('Tu navegador no soporta lectura en voz alta.');
    return;
  }
  if (tts.playing) {
    speechSynthesis.pause();
    tts.playing = false;
    document.getElementById('playPauseBtn').textContent = '▶️';
  } else if (speechSynthesis.paused) {
    speechSynthesis.resume();
    tts.playing = true;
    document.getElementById('playPauseBtn').textContent = '⏸️';
  } else {
    tts.blocks = Array.from(document.querySelectorAll('#readerContent .reader-paragraph, #readerContent .reader-heading'));
    tts.index = 0;
    tts.playing = true;
    document.getElementById('playPauseBtn').textContent = '⏸️';
    speakBlock();
  }
});

document.getElementById('stopBtn').addEventListener('click', resetTTS);

function speakBlock() {
  if (tts.index >= tts.blocks.length) { resetTTS(); return; }

  const blockEl = tts.blocks[tts.index];
  const text = blockEl.textContent;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  if (tts.voice) utterance.voice = tts.voice;
  utterance.rate = tts.rate;

  // Destaca a palavra sendo lida em tempo real, quando o navegador suporta
  utterance.onboundary = (ev) => {
    if (ev.name !== 'word' && ev.name !== undefined) { /* alguns navegadores não passam 'name' */ }
    highlightCharIndex(blockEl, ev.charIndex);
  };

  utterance.onend = () => {
    clearSpeakingHighlight();
    if (tts.playing) { tts.index++; speakBlock(); }
  };
  utterance.onerror = () => { resetTTS(); };

  blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  speechSynthesis.speak(utterance);
}

function highlightCharIndex(blockEl, charIndex) {
  clearSpeakingHighlight();
  let acc = 0;
  for (const node of blockEl.childNodes) {
    const len = (node.textContent || '').length;
    if (charIndex >= acc && charIndex < acc + len) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('word')) {
        node.classList.add('speaking');
      }
      break;
    }
    acc += len;
  }
}

/* ---------------- Fuentes (sites de notícias) ---------------- */

const LS_CUSTOM_SOURCES = 'espanolia_custom_sources';

const DEFAULT_SOURCES = [
  { name: 'CNN en Español', emoji: '📡', desc: 'Actualidad y mundo', url: 'https://cnnespanol.cnn.com/' },
  { name: 'BBC Mundo', emoji: '🌍', desc: 'Noticias internacionales', url: 'https://www.bbc.com/mundo' },
  { name: 'El País', emoji: '📰', desc: 'España y Latinoamérica', url: 'https://elpais.com/' },
  { name: 'Marca', emoji: '⚽', desc: 'Deportes', url: 'https://www.marca.com/' },
  { name: 'National Geographic ES', emoji: '🌎', desc: 'Ciencia y naturaleza', url: 'https://www.nationalgeographic.com.es/' },
  { name: 'Xataka', emoji: '💻', desc: 'Tecnología', url: 'https://www.xataka.com/' }
];

function getCustomSources() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_SOURCES) || '[]'); }
  catch (e) { return []; }
}
function saveCustomSources(list) {
  localStorage.setItem(LS_CUSTOM_SOURCES, JSON.stringify(list));
}
function allSources() {
  const custom = getCustomSources().map(s => ({ ...s, emoji: '🔗', desc: 'Añadido por ti', custom: true }));
  return [...DEFAULT_SOURCES, ...custom];
}

function showSourcesHome() {
  document.getElementById('sourcesHome').classList.remove('hidden');
  document.getElementById('addSourceForm').classList.add('hidden');
  document.getElementById('sourcesHeadlines').classList.add('hidden');
  const grid = document.getElementById('sourcesGrid');
  grid.innerHTML = '';

  allSources().forEach(src => {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `
      <span class="source-emoji">${src.emoji}</span>
      <span class="source-name">${escapeHtml(src.name)}</span>
      <span class="source-desc">${escapeHtml(src.desc)}</span>`;
    card.addEventListener('click', () => openSourceHeadlines(src));
    if (src.custom) {
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); removeCustomSource(src); });
      card.title = 'Toca y mantén presionado para eliminar';
      let pressTimer;
      card.addEventListener('touchstart', () => { pressTimer = setTimeout(() => removeCustomSource(src), 700); });
      card.addEventListener('touchend', () => clearTimeout(pressTimer));
    }
    grid.appendChild(card);
  });

  const addCard = document.createElement('div');
  addCard.className = 'source-card add-source';
  addCard.innerHTML = `<span class="source-emoji">➕</span><span class="source-name">Añadir fuente</span>`;
  addCard.addEventListener('click', () => {
    document.getElementById('addSourceForm').classList.remove('hidden');
  });
  grid.appendChild(addCard);
}

function removeCustomSource(src) {
  if (!confirm(`¿Eliminar "${src.name}"?`)) return;
  const list = getCustomSources().filter(s => s.url !== src.url);
  saveCustomSources(list);
  showSourcesHome();
}

document.getElementById('saveSourceBtn').addEventListener('click', () => {
  const name = document.getElementById('newSourceName').value.trim();
  let url = document.getElementById('newSourceUrl').value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const list = getCustomSources();
  list.push({ name, url });
  saveCustomSources(list);

  document.getElementById('newSourceName').value = '';
  document.getElementById('newSourceUrl').value = '';
  document.getElementById('addSourceForm').classList.add('hidden');
  showSourcesHome();
});

document.getElementById('backFromHeadlines').addEventListener('click', showSourcesHome);

function showLoading(text) {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

async function openSourceHeadlines(src) {
  document.getElementById('sourcesHome').classList.add('hidden');
  document.getElementById('addSourceForm').classList.add('hidden');
  document.getElementById('sourcesHeadlines').classList.remove('hidden');
  document.getElementById('sourceSiteTitle').textContent = src.name;
  const list = document.getElementById('headlinesList');
  list.innerHTML = '<p class="headline-loading">Cargando noticias...</p>';

  try {
    const readerUrl = 'https://r.jina.ai/' + src.url;
    const res = await fetch(readerUrl);
    if (!res.ok) throw new Error('Falha ao acessar o site');
    const raw = await res.text();
    const headlines = parseHeadlines(raw, src.url);

    if (!headlines.length) {
      list.innerHTML = '<p class="hint">No se encontraron noticias. Intenta más tarde.</p>';
      return;
    }

    list.innerHTML = '';
    headlines.forEach(h => {
      const item = document.createElement('div');
      item.className = 'headline-item';
      item.innerHTML = h.image
        ? `<img class="headline-thumb" src="${h.image}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'headline-thumb-placeholder',textContent:'📰'}))">`
        : `<div class="headline-thumb-placeholder">📰</div>`;
      const titleSpan = document.createElement('span');
      titleSpan.className = 'headline-title';
      titleSpan.textContent = h.title;
      item.appendChild(titleSpan);
      item.addEventListener('click', () => importAndOpen(h.title, h.url));
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<p class="hint">❌ No se pudo cargar este sitio ahora. Intenta con otro.</p>';
  }
}

// Extrai links de matérias (e a imagem associada, se houver) a partir do
// markdown retornado pelo leitor. Filtra links curtos/menu.
function parseHeadlines(markdown, baseUrl) {
  const domain = new URL(baseUrl).hostname.replace('www.', '');
  // Captura opcionalmente uma imagem logo antes do link do título
  const regex = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)[^\[]{0,200})?\[([^\]]{20,160})\]\((https?:\/\/[^\s)]+)\)/g;
  const seen = new Set();
  const results = [];
  let m;
  while ((m = regex.exec(markdown)) !== null) {
    const image = m[1] || null;
    const title = m[2].trim();
    const url = m[3];
    if (!url.includes(domain)) continue;
    if (seen.has(url)) continue;
    if (/^(inicio|home|menú|menu|contacto|suscr|login|iniciar sesión|síguenos|política de|aviso legal)/i.test(title)) continue;
    seen.add(url);
    results.push({ title, url, image });
    if (results.length >= 25) break;
  }
  return results;
}

async function importAndOpen(title, url) {
  showLoading('Cargando noticia...');
  try {
    const readerUrl = 'https://r.jina.ai/' + url;
    const res = await fetch(readerUrl);
    if (!res.ok) throw new Error('Falha ao acessar a notícia');
    const content = cleanImportedText(await res.text());

    const saveRes = await apiPost('saveLesson', { title, source: url, content });
    if (saveRes.error) throw new Error(saveRes.error);

    await loadLessons();
    const lesson = state.lessons.find(l => l.id === saveRes.id) || { id: saveRes.id, title, content };
    hideLoading();
    openReader(lesson);
  } catch (e) {
    hideLoading();
    alert('❌ No se pudo abrir esta noticia: ' + e.message);
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
      content = cleanImportedText(await res.text());
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
    const res = await apiPost('saveLesson', { title, source, content });
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

// Remove os metadados que o serviço de extração (r.jina.ai) coloca antes
// do conteúdo real ("Title:", "URL Source:", "Published Time:", etc.)
// e também remove linhas soltas de URL que atrapalham a leitura.
function cleanImportedText(raw) {
  let text = raw;

  // O conteúdo de verdade começa depois de "Markdown Content:"
  const marker = 'Markdown Content:';
  const idx = text.indexOf(marker);
  if (idx !== -1) {
    text = text.substring(idx + marker.length);
  }

  // Remove linhas de metadado que sobrarem (Title:, URL Source:, Published Time:)
  text = text
    .split('\n')
    .filter(line => !/^\s*(Title|URL Source|Published Time|Warning|Markdown Content)\s*:/i.test(line))
    .join('\n');

  // Remove imagens markdown: ![alt](url)
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Converte links markdown [texto](url) -> apenas "texto"
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove negrito/itálico (**texto**, __texto__, *texto*, _texto_) mantendo o texto
  text = text.replace(/(\*\*|__)(.+?)\1/g, '$2');
  text = text.replace(/(\*|_)(.+?)\1/g, '$2');

  // Remove asteriscos/underscores/colchetes soltos que sobraram da extração
  text = text.replace(/[*_]{1,3}/g, '');
  text = text.replace(/\[|\]/g, '');

  // Remove URLs soltas (http/https) que aparecem no meio do texto
  text = text.replace(/https?:\/\/\S+/g, '');

  // Remove linhas horizontais markdown (---, ***, ___)
  text = text.replace(/^[\s]*([-*_]){3,}[\s]*$/gm, '');

  // Normaliza espaços dentro de cada linha, mas preserva quebras de parágrafo
  text = text
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n');

  // Remove excesso de linhas em branco (mantém no máximo uma linha vazia = 1 parágrafo)
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

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
  if (typeof resetTTS === 'function') resetTTS();
  state.currentLesson = lesson;
  document.getElementById('readerTitle').textContent = lesson.title;
  const contentEl = document.getElementById('readerContent');
  contentEl.innerHTML = '';

  const blocks = (lesson.content || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  blocks.forEach(block => {
    const headingMatch = block.match(/^(#{1,4})\s+(.*)$/);

    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 1, 4); // # -> h2, ## -> h3...
      const el = document.createElement('h' + level);
      el.className = 'reader-heading';
      appendTokenizedWords(el, headingMatch[2]);
      contentEl.appendChild(el);
    } else {
      const p = document.createElement('p');
      p.className = 'reader-paragraph';
      appendTokenizedWords(p, block);
      contentEl.appendChild(p);
    }
  });

  showView('reader');
}

function appendTokenizedWords(container, text) {
  const tokens = tokenize(text);
  tokens.forEach(tok => {
    if (tok.type === 'word') {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = tok.text;
      span.dataset.word = normalizeWord(tok.text);
      markIfSaved(span);
      span.addEventListener('click', () => openWordPopup(span));
      container.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.className = 'punct';
      span.textContent = tok.text;
      container.appendChild(span);
    }
  });
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

document.getElementById('backFromReader').addEventListener('click', () => { resetTTS(); showView('import'); });

document.getElementById('deleteLessonBtn').addEventListener('click', async () => {
  if (!state.currentLesson) return;
  if (!confirm('Excluir esta lição?')) return;
  resetTTS();
  await api('deleteLesson', { id: state.currentLesson.id });
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
  const wordSpan = state.activeWordEl;

  // Fecha o popup e atualiza a tela na hora (não espera a rede)
  closeWordPopup();

  if (popupContext.existing) {
    // Atualiza localmente
    Object.assign(popupContext.existing, { translation, category });
    markIfSaved(wordSpan);
    api('updateWord', { id: popupContext.existing.id, translation, category })
      .catch(e => console.error('Erro ao atualizar:', e));
  } else {
    // Cria um item temporário local com id provisório até a API responder
    const tempId = 'temp_' + Date.now();
    const newItem = {
      id: tempId, word: popupContext.rawText, translation, category, example,
      box: 1, dateAdded: new Date().toISOString()
    };
    state.vocab.push(newItem);
    markIfSaved(wordSpan);
    try {
      const res = await api('saveWord', { word: popupContext.rawText, translation, category, example });
      if (res.id) newItem.id = res.id; // troca pelo id real da planilha
    } catch (e) {
      console.error('Erro ao salvar:', e);
    }
  }
});

document.getElementById('popupDelete').addEventListener('click', async () => {
  if (!popupContext || !popupContext.existing) return;
  if (!confirm('Remover esta palavra do vocabulário?')) return;
  const wordSpan = state.activeWordEl;
  const id = popupContext.existing.id;

  // Remove localmente e fecha na hora
  state.vocab = state.vocab.filter(v => v.id !== id);
  markIfSaved(wordSpan);
  closeWordPopup();

  api('deleteWord', { id }).catch(e => console.error('Erro ao remover:', e));
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

  // Avança pro próximo card imediatamente — não espera a rede
  fc.index++;
  fc.flipped = false;
  renderFlashcard();

  // Atualiza a caixa localmente (mesma regra do backend) e salva em segundo plano
  const BOX_INTERVALS = [0, 1, 2, 4, 7, 15];
  let box = Number(item.box) || 1;
  box = result === 'correct' ? Math.min(box + 1, BOX_INTERVALS.length - 1) : 1;
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + BOX_INTERVALS[box]);
  item.box = box;
  item.nextReview = nextDate.toISOString();

  api('reviewWord', { id: item.id, result }).catch(e => console.error(e));
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
