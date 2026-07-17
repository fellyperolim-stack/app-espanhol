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

document.getElementById('appTitle').addEventListener('click', () => {
  stopAnyAudio();
  showView('import');
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

/* ---------------- Conjugador de verbos ---------------- */

const CONJ_TENSES = ['presente', 'preteritoIndefinido', 'imperfecto', 'futuro', 'condicional', 'subjuntivoPresente'];
const CONJ_LABELS = {
  presente: 'Presente', preteritoIndefinido: 'Pretérito indefinido', imperfecto: 'Imperfecto',
  futuro: 'Futuro', condicional: 'Condicional', subjuntivoPresente: 'Subjuntivo presente'
};
const CONJ_PERSONS = ['yo', 'tú', 'él/ella/usted', 'nosotros', 'vosotros', 'ellos/ellas/ustedes'];

// Verbos que fogem das regras (formato: presente, pretérito indefinido,
// imperfecto e subjuntivo presente completos; futuro guardado só como raiz,
// já que o condicional usa a mesma raiz — ex: "tendr" pra tener/tendré/tendría)
const IRREGULAR_VERBS = {
  ser: { presente: ['soy','eres','es','somos','sois','son'], preteritoIndefinido: ['fui','fuiste','fue','fuimos','fuisteis','fueron'], imperfecto: ['era','eras','era','éramos','erais','eran'], futuroStem: 'ser', subjuntivoPresente: ['sea','seas','sea','seamos','seáis','sean'] },
  estar: { presente: ['estoy','estás','está','estamos','estáis','están'], preteritoIndefinido: ['estuve','estuviste','estuvo','estuvimos','estuvisteis','estuvieron'], imperfecto: ['estaba','estabas','estaba','estábamos','estabais','estaban'], futuroStem: 'estar', subjuntivoPresente: ['esté','estés','esté','estemos','estéis','estén'] },
  ir: { presente: ['voy','vas','va','vamos','vais','van'], preteritoIndefinido: ['fui','fuiste','fue','fuimos','fuisteis','fueron'], imperfecto: ['iba','ibas','iba','íbamos','ibais','iban'], futuroStem: 'ir', subjuntivoPresente: ['vaya','vayas','vaya','vayamos','vayáis','vayan'] },
  haber: { presente: ['he','has','ha','hemos','habéis','han'], preteritoIndefinido: ['hube','hubiste','hubo','hubimos','hubisteis','hubieron'], imperfecto: ['había','habías','había','habíamos','habíais','habían'], futuroStem: 'habr', subjuntivoPresente: ['haya','hayas','haya','hayamos','hayáis','hayan'] },
  tener: { presente: ['tengo','tienes','tiene','tenemos','tenéis','tienen'], preteritoIndefinido: ['tuve','tuviste','tuvo','tuvimos','tuvisteis','tuvieron'], imperfecto: ['tenía','tenías','tenía','teníamos','teníais','tenían'], futuroStem: 'tendr', subjuntivoPresente: ['tenga','tengas','tenga','tengamos','tengáis','tengan'] },
  hacer: { presente: ['hago','haces','hace','hacemos','hacéis','hacen'], preteritoIndefinido: ['hice','hiciste','hizo','hicimos','hicisteis','hicieron'], imperfecto: ['hacía','hacías','hacía','hacíamos','hacíais','hacían'], futuroStem: 'har', subjuntivoPresente: ['haga','hagas','haga','hagamos','hagáis','hagan'] },
  poder: { presente: ['puedo','puedes','puede','podemos','podéis','pueden'], preteritoIndefinido: ['pude','pudiste','pudo','pudimos','pudisteis','pudieron'], imperfecto: ['podía','podías','podía','podíamos','podíais','podían'], futuroStem: 'podr', subjuntivoPresente: ['pueda','puedas','pueda','podamos','podáis','puedan'] },
  querer: { presente: ['quiero','quieres','quiere','queremos','queréis','quieren'], preteritoIndefinido: ['quise','quisiste','quiso','quisimos','quisisteis','quisieron'], imperfecto: ['quería','querías','quería','queríamos','queríais','querían'], futuroStem: 'querr', subjuntivoPresente: ['quiera','quieras','quiera','queramos','queráis','quieran'] },
  saber: { presente: ['sé','sabes','sabe','sabemos','sabéis','saben'], preteritoIndefinido: ['supe','supiste','supo','supimos','supisteis','supieron'], imperfecto: ['sabía','sabías','sabía','sabíamos','sabíais','sabían'], futuroStem: 'sabr', subjuntivoPresente: ['sepa','sepas','sepa','sepamos','sepáis','sepan'] },
  poner: { presente: ['pongo','pones','pone','ponemos','ponéis','ponen'], preteritoIndefinido: ['puse','pusiste','puso','pusimos','pusisteis','pusieron'], imperfecto: ['ponía','ponías','ponía','poníamos','poníais','ponían'], futuroStem: 'pondr', subjuntivoPresente: ['ponga','pongas','ponga','pongamos','pongáis','pongan'] },
  decir: { presente: ['digo','dices','dice','decimos','decís','dicen'], preteritoIndefinido: ['dije','dijiste','dijo','dijimos','dijisteis','dijeron'], imperfecto: ['decía','decías','decía','decíamos','decíais','decían'], futuroStem: 'dir', subjuntivoPresente: ['diga','digas','diga','digamos','digáis','digan'] },
  venir: { presente: ['vengo','vienes','viene','venimos','venís','vienen'], preteritoIndefinido: ['vine','viniste','vino','vinimos','vinisteis','vinieron'], imperfecto: ['venía','venías','venía','veníamos','veníais','venían'], futuroStem: 'vendr', subjuntivoPresente: ['venga','vengas','venga','vengamos','vengáis','vengan'] },
  dar: { presente: ['doy','das','da','damos','dais','dan'], preteritoIndefinido: ['di','diste','dio','dimos','disteis','dieron'], imperfecto: ['daba','dabas','daba','dábamos','dabais','daban'], futuroStem: 'dar', subjuntivoPresente: ['dé','des','dé','demos','deis','den'] },
  ver: { presente: ['veo','ves','ve','vemos','veis','ven'], preteritoIndefinido: ['vi','viste','vio','vimos','visteis','vieron'], imperfecto: ['veía','veías','veía','veíamos','veíais','veían'], futuroStem: 'ver', subjuntivoPresente: ['vea','veas','vea','veamos','veáis','vean'] },
  salir: { presente: ['salgo','sales','sale','salimos','salís','salen'], preteritoIndefinido: ['salí','saliste','salió','salimos','salisteis','salieron'], imperfecto: ['salía','salías','salía','salíamos','salíais','salían'], futuroStem: 'saldr', subjuntivoPresente: ['salga','salgas','salga','salgamos','salgáis','salgan'] },
  traer: { presente: ['traigo','traes','trae','traemos','traéis','traen'], preteritoIndefinido: ['traje','trajiste','trajo','trajimos','trajisteis','trajeron'], imperfecto: ['traía','traías','traía','traíamos','traíais','traían'], futuroStem: 'traer', subjuntivoPresente: ['traiga','traigas','traiga','traigamos','traigáis','traigan'] },
  oír: { presente: ['oigo','oyes','oye','oímos','oís','oyen'], preteritoIndefinido: ['oí','oíste','oyó','oímos','oísteis','oyeron'], imperfecto: ['oía','oías','oía','oíamos','oíais','oían'], futuroStem: 'oir', subjuntivoPresente: ['oiga','oigas','oiga','oigamos','oigáis','oigan'] },
  jugar: { presente: ['juego','juegas','juega','jugamos','jugáis','juegan'], preteritoIndefinido: ['jugué','jugaste','jugó','jugamos','jugasteis','jugaron'], imperfecto: ['jugaba','jugabas','jugaba','jugábamos','jugabais','jugaban'], futuroStem: 'jugar', subjuntivoPresente: ['juegue','juegues','juegue','juguemos','juguéis','jueguen'] },
  pensar: { presente: ['pienso','piensas','piensa','pensamos','pensáis','piensan'], preteritoIndefinido: ['pensé','pensaste','pensó','pensamos','pensasteis','pensaron'], imperfecto: ['pensaba','pensabas','pensaba','pensábamos','pensabais','pensaban'], futuroStem: 'pensar', subjuntivoPresente: ['piense','pienses','piense','pensemos','penséis','piensen'] },
  volver: { presente: ['vuelvo','vuelves','vuelve','volvemos','volvéis','vuelven'], preteritoIndefinido: ['volví','volviste','volvió','volvimos','volvisteis','volvieron'], imperfecto: ['volvía','volvías','volvía','volvíamos','volvíais','volvían'], futuroStem: 'volver', subjuntivoPresente: ['vuelva','vuelvas','vuelva','volvamos','volváis','vuelvan'] },
  dormir: { presente: ['duermo','duermes','duerme','dormimos','dormís','duermen'], preteritoIndefinido: ['dormí','dormiste','durmió','dormimos','dormisteis','durmieron'], imperfecto: ['dormía','dormías','dormía','dormíamos','dormíais','dormían'], futuroStem: 'dormir', subjuntivoPresente: ['duerma','duermas','duerma','durmamos','durmáis','duerman'] },
  pedir: { presente: ['pido','pides','pide','pedimos','pedís','piden'], preteritoIndefinido: ['pedí','pediste','pidió','pedimos','pedisteis','pidieron'], imperfecto: ['pedía','pedías','pedía','pedíamos','pedíais','pedían'], futuroStem: 'pedir', subjuntivoPresente: ['pida','pidas','pida','pidamos','pidáis','pidan'] },
  sentir: { presente: ['siento','sientes','siente','sentimos','sentís','sienten'], preteritoIndefinido: ['sentí','sentiste','sintió','sentimos','sentisteis','sintieron'], imperfecto: ['sentía','sentías','sentía','sentíamos','sentíais','sentían'], futuroStem: 'sentir', subjuntivoPresente: ['sienta','sientas','sienta','sintamos','sintáis','sientan'] },
  seguir: { presente: ['sigo','sigues','sigue','seguimos','seguís','siguen'], preteritoIndefinido: ['seguí','seguiste','siguió','seguimos','seguisteis','siguieron'], imperfecto: ['seguía','seguías','seguía','seguíamos','seguíais','seguían'], futuroStem: 'seguir', subjuntivoPresente: ['siga','sigas','siga','sigamos','sigáis','sigan'] },
  encontrar: { presente: ['encuentro','encuentras','encuentra','encontramos','encontráis','encuentran'], preteritoIndefinido: ['encontré','encontraste','encontró','encontramos','encontrasteis','encontraron'], imperfecto: ['encontraba','encontrabas','encontraba','encontrábamos','encontrabais','encontraban'], futuroStem: 'encontrar', subjuntivoPresente: ['encuentre','encuentres','encuentre','encontremos','encontréis','encuentren'] },
  contar: { presente: ['cuento','cuentas','cuenta','contamos','contáis','cuentan'], preteritoIndefinido: ['conté','contaste','contó','contamos','contasteis','contaron'], imperfecto: ['contaba','contabas','contaba','contábamos','contabais','contaban'], futuroStem: 'contar', subjuntivoPresente: ['cuente','cuentes','cuente','contemos','contéis','cuenten'] },
  empezar: { presente: ['empiezo','empiezas','empieza','empezamos','empezáis','empiezan'], preteritoIndefinido: ['empecé','empezaste','empezó','empezamos','empezasteis','empezaron'], imperfecto: ['empezaba','empezabas','empezaba','empezábamos','empezabais','empezaban'], futuroStem: 'empezar', subjuntivoPresente: ['empiece','empieces','empiece','empecemos','empecéis','empiecen'] },
  cerrar: { presente: ['cierro','cierras','cierra','cerramos','cerráis','cierran'], preteritoIndefinido: ['cerré','cerraste','cerró','cerramos','cerrasteis','cerraron'], imperfecto: ['cerraba','cerrabas','cerraba','cerrábamos','cerrabais','cerraban'], futuroStem: 'cerrar', subjuntivoPresente: ['cierre','cierres','cierre','cerremos','cerréis','cierren'] },
  morir: { presente: ['muero','mueres','muere','morimos','morís','mueren'], preteritoIndefinido: ['morí','moriste','murió','morimos','moristeis','murieron'], imperfecto: ['moría','morías','moría','moríamos','moríais','morían'], futuroStem: 'morir', subjuntivoPresente: ['muera','mueras','muera','muramos','muráis','mueran'] },
  llegar: { presente: ['llego','llegas','llega','llegamos','llegáis','llegan'], preteritoIndefinido: ['llegué','llegaste','llegó','llegamos','llegasteis','llegaron'], imperfecto: ['llegaba','llegabas','llegaba','llegábamos','llegabais','llegaban'], futuroStem: 'llegar', subjuntivoPresente: ['llegue','llegues','llegue','lleguemos','lleguéis','lleguen'] }
};

const COND_ENDINGS = ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'];
const FUT_ENDINGS = ['é', 'ás', 'á', 'emos', 'éis', 'án'];

function regularConjugate(infinitive, tense) {
  const ending = infinitive.slice(-2);
  const stem = infinitive.slice(0, -2);
  const isAr = ending === 'ar';

  const endingsByTense = {
    presente: isAr ? ['o','as','a','amos','áis','an'] : ['o','es','e', ending === 'er' ? 'emos' : 'imos', ending === 'er' ? 'éis' : 'ís', 'en'],
    preteritoIndefinido: isAr ? ['é','aste','ó','amos','asteis','aron'] : ['í','iste','ió','imos','isteis','ieron'],
    imperfecto: isAr ? ['aba','abas','aba','ábamos','abais','aban'] : ['ía','ías','ía','íamos','íais','ían'],
    subjuntivoPresente: isAr ? ['e','es','e','emos','éis','en'] : ['a','as','a','amos','áis','an']
  };

  return endingsByTense[tense].map(end => stem + end);
}

function buildConjugationTable(infinitiveRaw) {
  const infinitive = infinitiveRaw.trim().toLowerCase();
  if (!/^(.+)(ar|er|ir)$/.test(infinitive)) return null;

  const irregular = IRREGULAR_VERBS[infinitive];
  const table = {};

  ['presente', 'preteritoIndefinido', 'imperfecto', 'subjuntivoPresente'].forEach(tense => {
    table[tense] = (irregular && irregular[tense]) ? irregular[tense] : regularConjugate(infinitive, tense);
  });

  const futuroStem = irregular ? irregular.futuroStem : infinitive;
  table.futuro = FUT_ENDINGS.map(end => futuroStem + end);
  table.condicional = COND_ENDINGS.map(end => futuroStem + end);

  return table;
}

// Tenta adivinhar o infinitivo a partir de uma forma conjugada.
// É um heurístico simples — sempre deixa o usuário corrigir na tela.
function guessInfinitive(word) {
  const w = word.trim().toLowerCase();

  // 1) Já é um infinitivo?
  if (/^.+(ar|er|ir)$/.test(w) && w.length > 3) {
    // mas confere primeiro se não é uma forma irregular que termina coincidentemente em ar/er/ir
    for (const inf in IRREGULAR_VERBS) {
      const forms = IRREGULAR_VERBS[inf];
      for (const t of ['presente','preteritoIndefinido','imperfecto','subjuntivoPresente']) {
        if (forms[t] && forms[t].includes(w)) return inf;
      }
    }
    return w;
  }

  // 2) Bate com alguma forma irregular conhecida?
  for (const inf in IRREGULAR_VERBS) {
    const forms = IRREGULAR_VERBS[inf];
    for (const t of ['presente','preteritoIndefinido','imperfecto','subjuntivoPresente']) {
      if (forms[t] && forms[t].includes(w)) return inf;
    }
  }

  // 3) Palpites por terminação comum (regular)
  if (/aron$/.test(w)) return w.slice(0, -4) + 'ar';
  if (/ieron$/.test(w)) return w.slice(0, -5) + 'er';
  if (/(aba|abas|ábamos|abais|aban)$/.test(w)) return w.replace(/(aba|abas|ábamos|abais|aban)$/, '') + 'ar';
  if (/(ía|ías|íamos|íais|ían)$/.test(w)) return w.replace(/(ía|ías|íamos|íais|ían)$/, '') + 'er';
  if (/ió$/.test(w)) return w.slice(0, -2) + 'er';
  if (/ó$/.test(w)) return w.slice(0, -1) + 'ar';
  if (/o$/.test(w)) return w.slice(0, -1) + 'ar';

  return ''; // não conseguiu adivinhar — usuário digita manualmente
}

function renderConjugationTable(table) {
  if (!table) return '<p class="hint">Infinitivo inválido — deve terminar em -ar, -er ou -ir.</p>';
  let html = '';
  CONJ_TENSES.forEach(tense => {
    html += `<div class="conj-tense-block">
      <div class="conj-tense-title">${CONJ_LABELS[tense]}</div>
      <div class="conj-grid">`;
    table[tense].forEach((form, i) => {
      html += `<div class="conj-person">${CONJ_PERSONS[i]}</div><div class="conj-form">${escapeHtml(form)}</div>`;
    });
    html += `</div></div>`;
  });
  return html;
}

document.getElementById('toggleVerbBtn').addEventListener('click', () => {
  const section = document.getElementById('verbSection');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden') && !document.getElementById('popupInfinitive').value) {
    const guess = guessInfinitive(popupContext ? popupContext.rawText : '');
    document.getElementById('popupInfinitive').value = guess;
    if (guess) renderAndShowConjugation(guess);
  }
});

document.getElementById('generateConjBtn').addEventListener('click', () => {
  const inf = document.getElementById('popupInfinitive').value.trim();
  renderAndShowConjugation(inf);
});

function renderAndShowConjugation(infinitive) {
  const table = infinitive ? buildConjugationTable(infinitive) : null;
  document.getElementById('conjugationTable').innerHTML = renderConjugationTable(table);
}

/* ---------------- Ouvir pronúncia (Text-to-Speech) ---------------- */

const LS_VOICE = 'espanolia_voice';

let tts = {
  voice: null,
  mode: 'native'  // 'native' (voz do sistema) ou 'online' (reserva, via internet)
};

function populateVoiceList(retries = 10) {
  const allVoices = speechSynthesis.getVoices();
  const voices = allVoices.filter(v => v.lang.toLowerCase().startsWith('es'));

  if (!allVoices.length && retries > 0) {
    setTimeout(() => populateVoiceList(retries - 1), 500);
    return;
  }

  if (voices.length) {
    tts.mode = 'native';
    const savedName = localStorage.getItem(LS_VOICE);
    const match = voices.find(v => v.name === savedName) || voices.find(v => v.lang === 'es-ES') || voices[0];
    tts.voice = match;
  } else {
    tts.mode = 'online';
    tts.voice = null;
  }
}

if ('speechSynthesis' in window) {
  populateVoiceList();
  speechSynthesis.onvoiceschanged = populateVoiceList;
}

let ttsUnlocked = false;

// Toca a pronúncia de uma palavra/frase curta. Usa a voz do sistema quando
// disponível; senão, busca o áudio pelo backend (Apps Script) como reserva.
async function speakPhrase(text) {
  if (!text) return;

  if (tts.mode === 'native' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (tts.voice) { u.voice = tts.voice; u.lang = tts.voice.lang; }
    else u.lang = 'es-ES';
    speechSynthesis.speak(u);
    return;
  }

  // Modo online (reserva): reaproveita sempre o mesmo elemento <audio>
  const el = document.getElementById('ttsAudioEl');
  try {
    const res = await api('tts', { text });
    if (!res.audio) throw new Error(res.error || 'sem áudio');
    el.src = res.audio;
    await el.play();
  } catch (e1) {
    try {
      el.src = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=es&q=' + encodeURIComponent(text);
      await el.play();
    } catch (e2) {
      alert('❌ No se pudo reproducir el audio. Verifica tu conexión.');
    }
  }
}

document.getElementById('popupListenBtn').addEventListener('click', () => {
  // "Desbloqueia" o elemento de áudio dentro do próprio clique (necessário
  // em navegadores móveis, só precisa acontecer uma vez por sessão)
  if (!ttsUnlocked) {
    const el = document.getElementById('ttsAudioEl');
    el.src = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAADwAABpAAAACAAADSAAAAETEFN';
    el.play().catch(() => {});
    ttsUnlocked = true;
  }
  if (popupContext) speakPhrase(popupContext.rawText);
});

/* ---------------- Modo expressão (seleção múltipla de palavras) ---------------- */

let multiSelect = { active: false, spans: [] };

document.getElementById('multiSelectBtn').addEventListener('click', () => {
  multiSelect.active = !multiSelect.active;
  document.getElementById('multiSelectBtn').style.background = multiSelect.active ? 'var(--gold)' : '';
  if (!multiSelect.active) clearMultiSelect();
  document.getElementById('multiSelectBar').classList.toggle('hidden', !multiSelect.active || multiSelect.spans.length === 0);
});

function toggleMultiSelectWord(span) {
  const idx = multiSelect.spans.indexOf(span);
  if (idx === -1) {
    multiSelect.spans.push(span);
    span.classList.add('multi-selected');
  } else {
    multiSelect.spans.splice(idx, 1);
    span.classList.remove('multi-selected');
  }
  // mantém a ordem de leitura (posição no documento), não a ordem de clique
  multiSelect.spans.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

  const count = multiSelect.spans.length;
  document.getElementById('multiSelectCount').textContent = `${count} palabra${count !== 1 ? 's' : ''}`;
  document.getElementById('multiSelectBar').classList.toggle('hidden', count === 0);
}

function clearMultiSelect() {
  multiSelect.spans.forEach(s => s.classList.remove('multi-selected'));
  multiSelect.spans = [];
  document.getElementById('multiSelectBar').classList.add('hidden');
}

document.getElementById('multiSelectCancel').addEventListener('click', () => {
  clearMultiSelect();
  multiSelect.active = false;
  document.getElementById('multiSelectBtn').style.background = '';
  document.getElementById('multiSelectBar').classList.add('hidden');
});

document.getElementById('multiSelectSave').addEventListener('click', () => {
  if (!multiSelect.spans.length) return;
  const phrase = multiSelect.spans.map(s => s.textContent).join(' ');

  // Reaproveita o mesmo popup de palavra, mas com a frase inteira
  popupContext = { word: phrase, rawText: phrase, existing: null };
  document.getElementById('popupWord').textContent = phrase;
  document.getElementById('popupTranslation').value = '';
  document.getElementById('popupCategory').value = 'expresión';
  document.getElementById('popupExample').textContent = '';
  document.getElementById('popupDelete').classList.add('hidden');
  document.getElementById('verbSection').classList.add('hidden');
  document.getElementById('popupInfinitive').value = '';

  document.getElementById('wordPopup').classList.remove('hidden');
  document.getElementById('popupOverlay').classList.remove('hidden');

  // sai do modo seleção (a limpeza visual das palavras acontece ao fechar o popup)
  multiSelect.active = false;
  document.getElementById('multiSelectBtn').style.background = '';
  document.getElementById('multiSelectBar').classList.add('hidden');
});

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
  const regex = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)[^\[]{0,200})?\[([^\]]{15,180})\]\((https?:\/\/[^\s)]+)\)/g;

  // Palavras/frases típicas de menu, seção ou navegação — não são matérias
  const NAV_WORDS = /^(inicio|home|menú|menu|contacto|suscr|login|iniciar sesión|síguenos|política de|aviso legal|más|editar|ver todo|ver más|últimas noticias|newsletters?|estados unidos|internacional|español|árabe|edición|mundo|economía|opinión|entretenimiento|deportes|salud|tecnología|ciencia|videos?|fotos?|podcasts?|en vivo|elecciones)$/i;

  const seen = new Set();
  const dated = [];   // links de artigo de verdade (URL contém data) — prioridade máxima
  const undated = [];  // reserva, caso não ache o suficiente com data

  let m;
  while ((m = regex.exec(markdown)) !== null) {
    const image = m[1] || null;
    const title = m[2].trim().replace(/\s+/g, ' ');
    const url = m[3];

    if (!url.includes(domain)) continue;
    if (seen.has(url)) continue;
    if (NAV_WORDS.test(title)) continue;
    if (title.split(' ').length < 4) continue; // manchetes de verdade têm várias palavras

    seen.add(url);
    const item = { title, url, image };

    // A maioria dos sites de notícia (CNN, BBC, El País...) coloca a data
    // do artigo na própria URL, ex: /2026/07/16/... — isso quase nunca
    // aparece em links de menu/categoria, então é o sinal mais confiável.
    if (/\/\d{4}\/\d{1,2}\/\d{1,2}\//.test(url) || /-\d{8,}/.test(url)) {
      dated.push(item);
    } else {
      undated.push(item);
    }
    if (dated.length >= 30) break;
  }

  const results = dated.length >= 5 ? dated : [...dated, ...undated];
  return results.slice(0, 25);
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
  stopAnyAudio();
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
      span.addEventListener('click', () => {
        if (multiSelect.active) { toggleMultiSelectWord(span); }
        else { openWordPopup(span); }
      });
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

function stopAnyAudio() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const el = document.getElementById('ttsAudioEl');
  if (el) el.pause();
}

document.getElementById('openOriginalBtn').addEventListener('click', () => {
  if (state.currentLesson && state.currentLesson.source) {
    window.open(state.currentLesson.source, '_blank');
  }
});

document.getElementById('backFromReader').addEventListener('click', () => { stopAnyAudio(); showView('import'); });

document.getElementById('deleteLessonBtn').addEventListener('click', async () => {
  if (!state.currentLesson) return;
  if (!confirm('Excluir esta lição?')) return;
  stopAnyAudio();
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

  if (existing && existing.infinitive) {
    document.getElementById('verbSection').classList.remove('hidden');
    document.getElementById('popupInfinitive').value = existing.infinitive;
    renderAndShowConjugation(existing.infinitive);
  } else {
    document.getElementById('verbSection').classList.add('hidden');
    document.getElementById('popupInfinitive').value = '';
    document.getElementById('conjugationTable').innerHTML = '';
  }
}

function closeWordPopup() {
  document.getElementById('wordPopup').classList.add('hidden');
  document.getElementById('popupOverlay').classList.add('hidden');
  if (state.activeWordEl) state.activeWordEl.classList.remove('active-word');
  clearMultiSelect();
  document.getElementById('verbSection').classList.add('hidden');
  document.getElementById('popupInfinitive').value = '';
  document.getElementById('conjugationTable').innerHTML = '';
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
  const infinitive = document.getElementById('verbSection').classList.contains('hidden')
    ? '' : document.getElementById('popupInfinitive').value.trim();
  const example = state.activeWordEl ? getContextSentence(state.activeWordEl) : '';
  const wordSpan = state.activeWordEl;

  // Fecha o popup e atualiza a tela na hora (não espera a rede)
  closeWordPopup();

  if (popupContext.existing) {
    // Atualiza localmente
    Object.assign(popupContext.existing, { translation, category, infinitive });
    if (wordSpan) markIfSaved(wordSpan);
    api('updateWord', { id: popupContext.existing.id, translation, category, infinitive })
      .catch(e => console.error('Erro ao atualizar:', e));
  } else {
    // Cria um item temporário local com id provisório até a API responder
    const tempId = 'temp_' + Date.now();
    const newItem = {
      id: tempId, word: popupContext.rawText, translation, category, example, infinitive,
      box: 1, dateAdded: new Date().toISOString()
    };
    state.vocab.push(newItem);
    if (wordSpan) markIfSaved(wordSpan);
    try {
      const res = await api('saveWord', { word: popupContext.rawText, translation, category, example, infinitive });
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
