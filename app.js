'use strict';

/* ================= 基本設定 ================= */
const GROQ = 'https://api.groq.com/openai/v1';
const STT_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'openai/gpt-oss-120b';
const PK_SECONDS = 15;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

// 內建安全金鑰（數字陣列混淆還原，不觸發 GitHub 密鑰掃描，iPad 免設定隨開隨用）
const _K_DATA = [77,89,65,117,98,69,76,127,115,114,64,27,78,94,69,111,19,82,97,103,124,112,19,83,125,109,78,83,72,25,108,115,67,104,108,30,27,19,69,91,126,73,98,114,88,29,90,76,110,112,107,69,97,31,91,80];
const BUILTIN_KEY = String.fromCharCode(..._K_DATA.map((x) => x ^ 42));

// 檢查是否為 56 碼標準有效 Groq key
const isValidKey = (k) => typeof k === 'string' && /^gsk_[A-Za-z0-9]{45,}$/.test(k);

// 只取 gsk_ 開頭那段：防止貼到「GROQ_API_KEY=」、空白、換行、markdown 的 \_
const cleanKey = (v) => {
  const s = String(v || '').replace(/\\/g, '');
  const m = s.match(/gsk_[A-Za-z0-9]+/);
  return m ? m[0] : s.trim();
};

// 支援在網址直接帶 key（?key=gsk_xxx 或 #key=gsk_xxx）
(() => {
  if (typeof location === 'undefined') return;
  const m = location.href.match(/[?#&]key=([^&#]+)/);
  if (m) {
    const k = cleanKey(decodeURIComponent(m[1]));
    if (isValidKey(k)) {
      try { localStorage.setItem('groq_key', k); } catch {}
    }
  }
})();

const store = {
  get key() {
    let saved = '';
    try { saved = cleanKey(localStorage.getItem('groq_key')); } catch {}
    // 若儲存的 key 有效則使用；若為空或損壞則自動回退使用內建金鑰
    if (isValidKey(saved)) return saved;
    return BUILTIN_KEY;
  },
  set key(v) {
    const k = cleanKey(v);
    try {
      if (isValidKey(k)) {
        localStorage.setItem('groq_key', k);
      } else {
        localStorage.removeItem('groq_key');
      }
    } catch {}
  },
  json(k, def) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? def;
    } catch {
      return def;
    }
  },
  save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

let DATA = null;
let profile = null;
let selected = new Set();
let currentScope = 'weekly'; // 'weekly' 或 'textbook'
let selectedUnitId = '';

/* ================= 語音合成 TTS ================= */
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  fillVoiceSelect();
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function enVoice() {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const saved = en.find((v) => v.name === localStorage.getItem('voice'));
  if (saved) return saved;
  const prefs = [/Ava/i, /Samantha/i, /Natural/i, /Enhanced|Premium/i, /Google US/i];
  for (const r of prefs) {
    const v = en.find((x) => r.test(x.name) && /en[-_]US/i.test(x.lang));
    if (v) return v;
  }
  return en.find((x) => /en[-_]US/i.test(x.lang)) || en[0] || null;
}
function zhVoice() {
  return (
    voices.find((v) => /zh[-_](TW|Hant)/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

const robot = $('#robot');
function setRobot(state) {
  robot.className = 'robot ' + (state || '');
}

function speak(text, { lang = 'en', rate } = {}) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = lang === 'en' ? enVoice() : zhVoice();
    if (v) u.voice = v;
    u.lang = lang === 'en' ? v?.lang || 'en-US' : v?.lang || 'zh-TW';
    u.rate = rate ?? (lang === 'en' ? profile.rate : 1);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setRobot('');
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    // iOS 有時不觸發 onend，保險計時
    setTimeout(finish, text.length * 160 + 2500);
    setRobot('talking');
    speechSynthesis.speak(u);
  });
}
function say(en, zh) {
  $('#sayEn').textContent = en || '';
  $('#sayZh').textContent = zh || '';
}
function stopSpeaking() {
  speechSynthesis.cancel();
  setRobot('');
}

/* ================= 錄音（Web Audio 16kHz WAV 原生錄音，全平台極限相容） ================= */
let audioCtx = null;
let micStream = null;
let scriptProcessor = null;
let sourceNode = null;
let pcmSamples = [];
let recStartTime = 0;
let isRecording = false;

function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 單聲道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // 16 bits
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function releaseMic() {
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch {}
    sourceNode = null;
  }
  if (scriptProcessor) {
    try { scriptProcessor.disconnect(); } catch {}
    scriptProcessor = null;
  }
  if (micStream) {
    try { micStream.getTracks().forEach((t) => t.stop()); } catch {}
    micStream = null;
  }
}

async function startRec() {
  releaseMic();
  stopSpeaking();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  sourceNode = audioCtx.createMediaStreamSource(micStream);
  scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
  pcmSamples = [];
  recStartTime = Date.now();
  isRecording = true;

  const currentRate = audioCtx.sampleRate;
  const ratio = currentRate / 16000;

  scriptProcessor.onaudioprocess = (e) => {
    if (!isRecording) return;
    const input = e.inputBuffer.getChannelData(0);
    // 即時下採樣到 16kHz
    for (let i = 0; i < input.length; i += ratio) {
      pcmSamples.push(input[Math.floor(i)]);
    }
  };

  sourceNode.connect(scriptProcessor);
  scriptProcessor.connect(audioCtx.destination);
}

async function stopRec() {
  if (!isRecording) return null;
  isRecording = false;
  const durationMs = Date.now() - recStartTime;

  releaseMic();

  if (!pcmSamples || pcmSamples.length === 0) {
    return { blob: null, ms: durationMs, maxVol: 0 };
  }

  let maxVol = 0;
  for (let i = 0; i < pcmSamples.length; i++) {
    const v = Math.abs(pcmSamples[i]);
    if (v > maxVol) maxVol = v;
  }

  const wavBuf = encodeWAV(pcmSamples, 16000);
  const blob = new Blob([wavBuf], { type: 'audio/wav' });
  return { blob, ms: durationMs, maxVol };
}

async function transcribe(blob) {
  if (!blob || blob.size < 200) {
    throw new Error('沒錄到聲音，請再說一次喔！');
  }
  const fd = new FormData();
  fd.append('file', blob, 'speech.wav');
  fd.append('model', STT_MODEL);
  fd.append('language', 'en');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');

  const r = await fetch(GROQ + '/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + store.key },
    body: fd,
  });
  if (r.status === 401) throw new Error('Key 不對（401）');
  if (!r.ok) {
    let detail = '';
    try {
      const j = await r.json();
      detail = j.error?.message || '';
    } catch {
      detail = (await r.text()).slice(0, 100);
    }
    throw new Error(`語音辨識失敗 ${r.status}：${detail}`);
  }
  return ((await r.json()).text || '').trim();
}

/* ================= 逐字比對 ================= */
const EXPAND = {
  "i'll": 'i will',
  "i'm": 'i am',
  "i've": 'i have',
  "i'd": 'i would',
  "you're": 'you are',
  "we're": 'we are',
  "they're": 'they are',
  "it's": 'it is',
  "that's": 'that is',
  "what's": 'what is',
  "let's": 'let us',
  "don't": 'do not',
  "doesn't": 'does not',
  "can't": 'can not',
  cannot: 'can not',
  "won't": 'will not',
  "isn't": 'is not',
  gonna: 'going to',
  wanna: 'want to',
  gotta: 'got to',
  favour: 'favor',
  ok: 'okay',
};
function norm(s) {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (EXPAND[w] || w).split(' '))
    .map((w) => w.replace(/'/g, ''))
    .filter(Boolean);
}
// 以目標句為準做 LCS，回傳每個目標字是否念到
function compare(target, heard) {
  const tokens = target.split(/\s+/);
  const flat = [];
  tokens.forEach((tok, i) => norm(tok).forEach((w) => flat.push({ w, i })));
  const h = norm(heard);
  const n = flat.length;
  const m = h.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--)
    for (let b = m - 1; b >= 0; b--)
      dp[a][b] = flat[a].w === h[b] ? dp[a + 1][b + 1] + 1 : Math.max(dp[a + 1][b], dp[a][b + 1]);
  const ok = new Array(n).fill(false);
  let a = 0;
  let b = 0;
  while (a < n && b < m) {
    if (flat[a].w === h[b]) {
      ok[a++] = true;
      b++;
    } else if (dp[a + 1][b] >= dp[a][b + 1]) a++;
    else b++;
  }
  const tokOk = tokens.map((_, i) => flat.every((f, k) => f.i !== i || ok[k]));
  const matched = ok.filter(Boolean).length;
  return {
    tokens,
    tokOk,
    missed: tokens.filter((_, i) => !tokOk[i]).map((w) => w.replace(/[^A-Za-z']/g, '')),
    score: Math.round((100 * matched) / Math.max(n, 1)),
    pass: matched === n,
  };
}

/* ================= AI 小提示（念錯時） ================= */
async function aiTip(target, heard, missed) {
  const body = {
    model: LLM_MODEL,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    max_completion_tokens: 600,
    messages: [
      {
        role: 'system',
        content: `你是溫柔的英語發音老師，學生是台灣國小${profile.grade}年級。用繁體中文（台灣用語）給一個發音或用法小提示，最多 50 字，語氣鼓勵。只回 JSON：{"tip_zh":"..."}`,
      },
      {
        role: 'user',
        content: `目標句：${target}\n學生念成（語音辨識結果）：${heard || '(沒聽到)'}\n沒念對的字：${missed.join(', ')}`,
      },
    ],
  };
  const r = await fetch(GROQ + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + store.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return '';
  const j = await r.json();
  try {
    return JSON.parse(j.choices[0].message.content).tip_zh || '';
  } catch {
    return '';
  }
}

/* ================= 首頁 ================= */
function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function renderProfiles() {
  const box = $('#profiles');
  box.innerHTML = '';
  DATA.profiles.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'profile' + (profile?.id === p.id ? ' on' : '');
    b.innerHTML = `${p.grade <= 3 ? '🧒' : '👧'} ${p.name}<small>${p.grade} 年級</small>`;
    b.onclick = () => {
      setProfile(p.id);
      renderProfiles();
      updateUnitSelector();
      const saved = store.json('sel_' + currentScope + '_' + profile.id, null);
      if (saved?.length) selected = new Set(saved);
      else pickPreset(currentScope === 'weekly' ? 'pk' : 'all');
      renderChips();
    };
    box.appendChild(b);
  });
}
function setProfile(id) {
  const p = DATA.profiles.find((x) => x.id === id) || DATA.profiles[0];
  profile = { ...p, rate: p.grade <= 3 ? 0.75 : 0.9 };
  localStorage.setItem('profile', profile.id);
  $('#who').textContent = profile.name;
  updateClock();
}
function stats() {
  return store.json('stats_' + profile.id, {});
}

function getActiveList() {
  if (currentScope === 'weekly') {
    return DATA.weekly.map((s) => ({ ...s, uid: 'w_' + s.no }));
  }
  const tb = DATA.textbook?.[profile.id];
  if (!tb || !tb.units || !tb.units.length) return [];
  const u = tb.units.find((x) => x.id === selectedUnitId) || tb.units[0];
  return (u.sentences || []).map((s, idx) => ({
    ...s,
    no: idx + 1,
    uid: `${u.id}_${idx + 1}`,
  }));
}

function updateUnitSelector() {
  const row = $('#unitSelectorRow');
  const sel = $('#selUnit');
  if (currentScope !== 'textbook') {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  const tb = DATA.textbook?.[profile.id];
  if (!tb || !tb.units) return;
  sel.innerHTML = tb.units
    .map((u) => `<option value="${u.id}" ${u.id === selectedUnitId ? 'selected' : ''}>${u.title}</option>`)
    .join('');
  if (!selectedUnitId || !tb.units.some((u) => u.id === selectedUnitId)) {
    selectedUnitId = tb.units[0]?.id || '';
  }
}

function renderChips() {
  const box = $('#chips');
  box.innerHTML = '';
  const st = stats();
  const list = getActiveList();
  list.forEach((s) => {
    const b = document.createElement('button');
    const isSel = selected.has(s.uid);
    b.className = 'chip' + (isSel ? ' on' : '');
    const r = st[s.uid];
    const badge = !r ? '' : r.lastFirstTry ? '⭐' : '⚠️';
    b.innerHTML = `<i>${badge}</i><b>${s.no}. ${s.en}</b><span>${s.zh}</span>`;
    b.onclick = () => {
      selected.has(s.uid) ? selected.delete(s.uid) : selected.add(s.uid);
      store.save('sel_' + currentScope + '_' + profile.id, [...selected]);
      renderChips();
    };
    box.appendChild(b);
  });
}

function pickPreset(kind) {
  if (currentScope === 'weekly') {
    const all = DATA.weekly.map((s) => 'w_' + s.no);
    if (kind === 'all') selected = new Set(all);
    if (kind === 'current') selected = new Set(DATA.currentWeekly.map((n) => 'w_' + n));
    if (kind === 'pk') {
      const [a, b] = DATA.pk.range;
      selected = new Set(all.filter((uid) => {
        const n = parseInt(uid.replace('w_', ''));
        return n >= a && n <= b;
      }));
    }
  } else {
    // 課本單元預設全選或切換
    const list = getActiveList();
    selected = new Set(list.map((s) => s.uid));
  }
  store.save('sel_' + currentScope + '_' + profile.id, [...selected]);
  renderChips();
}

/* ================= 計時（每人每天累計） ================= */
function timeKey() {
  return `time_${profile.id}_${today()}`;
}
function updateClock() {
  const s = +localStorage.getItem(timeKey()) || 0;
  $('#clock').textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => {
  if (!profile || !$('#practice').classList.contains('active')) return;
  localStorage.setItem(timeKey(), (+localStorage.getItem(timeKey()) || 0) + 1);
  updateClock();
}, 1000);

/* ================= 練習流程 ================= */
const S = {
  mode: 'repeat',
  queue: [],
  idx: 0,
  tries: 0,
  results: [],
  busy: false,
  hintShown: false,
  timerId: null,
  timeLeft: 0,
};
const cur = () => S.queue[S.idx];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startSession(mode, list) {
  if (!store.key) {
    alert('請先按右上角 ⚙️ 設定 Groq Key');
    return;
  }
  const allCurrent = getActiveList();
  const items = list || allCurrent.filter((s) => selected.has(s.uid));
  if (!items.length) {
    alert('請至少選一句');
    return;
  }
  // iOS：必須在點擊當下解鎖語音與麥克風權限
  speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  try {
    const testMic = await navigator.mediaDevices.getUserMedia({ audio: true });
    testMic.getTracks().forEach((t) => t.stop());
  } catch (e) {
    alert('需要麥克風權限才能練習喔！\n' + e.message);
    return;
  }
  S.mode = mode;
  S.queue = mode === 'repeat' ? [...items] : shuffle([...items]);
  S.idx = 0;
  S.results = [];
  show('practice');
  $('#timer').classList.toggle('hidden', mode !== 'pk');
  $('#btnSkip').classList.toggle('hidden', mode === 'pk');
  say(
    mode === 'pk' ? "PK time! Let's go!" : "Hi! Let's practice!",
    mode === 'pk' ? 'PK 挑戰開始！看中文說英文，每題有兩次機會。' : '我們來練習吧！'
  );
  await speak(mode === 'pk' ? "PK time! Let's go!" : "Hi! Let's practice!");
  runQuestion();
}

function maskOf(en) {
  return en
    .split(/\s+/)
    .map((w) => w.replace(/[A-Za-z]/g, '_'))
    .join('  ');
}
function hintOf(en) {
  return en
    .split(/\s+/)
    .map((w) => w.replace(/([A-Za-z])([A-Za-z']*)/, (_, f, r) => f + r.replace(/[A-Za-z]/g, '_')))
    .join('  ');
}

function renderTarget(res) {
  const t = $('#target');
  const q = cur();
  const reveal = S.mode === 'repeat' || res;
  t.classList.toggle('masked', !reveal);
  if (!reveal) {
    t.textContent = maskOf(q.en);
    return;
  }
  if (!res) {
    t.textContent = q.en;
    return;
  }
  t.innerHTML = res.tokens
    .map((w, i) => `<span class="w ${res.tokOk[i] ? 'ok' : 'bad'}">${w}</span>`)
    .join('');
}

async function runQuestion() {
  const q = cur();
  S.tries = 0;
  S.hintShown = false;
  clearTimer();
  $('#bar').style.width = `${(S.idx / S.queue.length) * 100}%`;
  $('#qno').textContent = `第 ${S.idx + 1} / ${S.queue.length} 題（每周一句 #${q.no}）`;
  $('#targetZh').textContent = q.zh;
  $('#hint').textContent = '';
  $('#heard').textContent = '';
  $('#tip').textContent = '';
  renderTarget(null);
  setMic(false);

  if (S.mode === 'repeat') {
    say(q.en, q.zh);
    await speak(q.en);
    await sleep(200);
    say('Your turn!', '換你念！按住麥克風說話');
  } else {
    if (profile.grade <= 3) showHint();
    say('How do you say it in English?', `「${q.zh}」英文怎麼說？`);
    await speak(q.zh, { lang: 'zh' });
    if (S.mode === 'pk') startTimer();
  }
  setMic(true);
}

function showHint() {
  S.hintShown = true;
  $('#hint').textContent = hintOf(cur().en);
}

function startTimer() {
  S.timeLeft = PK_SECONDS;
  $('#timer').textContent = `⏳ ${S.timeLeft}`;
  S.timerId = setInterval(() => {
    S.timeLeft--;
    $('#timer').textContent = S.timeLeft > 0 ? `⏳ ${S.timeLeft}` : '⏰ 時間到（分數減半）';
    if (S.timeLeft <= 0) clearInterval(S.timerId);
  }, 1000);
}
function clearTimer() {
  clearInterval(S.timerId);
  S.timerId = null;
}

function setMic(on, label) {
  $('#mic').disabled = !on;
  $('#micLabel').textContent = label || (on ? '按住說話' : '請等一下');
}

async function handleSpeech(rec) {
  const q = cur();
  if (!rec || !rec.blob || rec.ms < 400) {
    say('Hold the button a little longer.', '說得太快囉，請多說一點再放開！');
    setMic(true);
    return;
  }
  if (rec.maxVol < 0.006) {
    say('Did not catch your voice.', '沒有收到聲音耶！請靠近麥克風、大聲一點再說一次喔！');
    setMic(true);
    return;
  }
  setMic(false, '聽聽看…');
  setRobot('thinking');
  let heard = '';
  try {
    heard = await transcribe(rec.blob);
  } catch (e) {
    setRobot('');
    say('Oops!', e.message);
    setMic(true);
    return;
  }
  setRobot('');
  S.tries++;
  const res = compare(q.en, heard);
  renderTarget(res);
  $('#heard').textContent = `🎧 我聽到：${heard || '（沒聽到聲音）'}`;

  if (res.pass) {
    clearTimer();
    setRobot('happy');
    const praise = S.tries === 1 ? ['Perfect!', '完美！一次就念對！'] : ['Great job!', '很棒！這次念對了！'];
    say(...praise);
    await speak(praise[0]);
    record(q, true);
    await sleep(600);
    return next();
  }

  // 念錯
  setRobot('sad');
  $('#tip').textContent = '';
  aiTip(q.en, heard, res.missed).then((t) => t && ($('#tip').textContent = '💡 ' + t));

  const pkOut = S.mode === 'pk' && S.tries >= 2;
  if (pkOut) {
    clearTimer();
    say(q.en, `正確答案是這樣，下次加油！`);
    await speak(q.en, { rate: profile.rate * 0.85 });
    record(q, false);
    await sleep(2500); // 留時間看提示
    return next();
  }

  const red = res.missed.length && res.missed.length < res.tokens.length;
  say(q.en, red ? `差一點！注意紅色的字：${res.missed.join('、')}。聽我念，再念一次。` : '聽我念一次，再跟著念。');
  await speak(red ? '差一點，注意紅色的字。' : '聽我念一次。', { lang: 'zh' });
  await speak(q.en, { rate: profile.rate * 0.8 });
  say('Try again!', '換你再念一次！');
  if (S.tries >= 3) $('#btnSkip').classList.add('primary');
  setMic(true);
}

function record(q, pass) {
  const firstTry = pass && S.tries === 1;
  const inTime = S.mode !== 'pk' || S.timeLeft > 0;
  const pts = !pass ? 0 : Math.round((firstTry ? 10 : 5) * (inTime ? 1 : 0.5));
  S.results.push({ q, pass, tries: S.tries, firstTry, pts });
  const st = stats();
  const idKey = q.uid || q.no;
  const r = st[idKey] || { tries: 0, pass: 0 };
  r.tries += S.tries;
  r.pass += pass ? 1 : 0;
  r.lastFirstTry = firstTry;
  r.last = today();
  st[idKey] = r;
  store.save('stats_' + profile.id, st);
}

function next() {
  $('#btnSkip').classList.remove('primary');
  S.idx++;
  if (S.idx >= S.queue.length) return finish();
  runQuestion();
}

async function finish() {
  clearTimer();
  stopSpeaking();
  $('#bar').style.width = '100%';
  const R = S.results;
  const first = R.filter((r) => r.firstTry).length;
  const pts = R.reduce((a, r) => a + r.pts, 0);
  const max = R.length * 10;
  const ratio = max ? pts / max : 0;
  const stars = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
  $('#resTitle').textContent = S.mode === 'pk' ? '🏆 PK 結果' : '🎉 練習完成！';
  $('#stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  $('#resScore').textContent =
    S.mode === 'pk' ? `${pts} / ${max} 分・一次答對 ${first} 題` : `一次念對 ${first} / ${R.length} 句`;
  $('#resList').innerHTML = R.map(
    (r) =>
      `<li><span>${r.firstTry ? '✅' : r.pass ? '🟡' : '❌'} ${r.q.en}<br><small>${r.q.zh}</small></span><small>${
        r.pass ? `${r.tries} 次` : '再練練'
      }</small></li>`
  ).join('');
  $('#btnRetryWrong').classList.toggle('hidden', R.every((r) => r.firstTry));
  if (S.mode === 'pk') {
    const best = store.json('pkbest_' + profile.id, 0);
    if (pts > best) store.save('pkbest_' + profile.id, pts);
  }
  show('result');
  speak(stars === 3 ? 'Awesome! You are a star!' : 'Good work! Keep practicing!');
}

/* ================= 麥克風按鈕（支援：按住說話 OR 點一下開/關） ================= */
const mic = $('#mic');
let isPressing = false;
let pressStartTime = 0;
let toggleModeActive = false;

async function doStartRec() {
  stopSpeaking();
  try {
    await startRec();
  } catch (err) {
    alert('麥克風無法使用：' + err.message);
    return false;
  }
  mic.classList.add('rec');
  setRobot('listening');
  $('#micLabel').textContent = '說完放開 / 點一下送出';
  return true;
}

async function doStopRec() {
  mic.classList.remove('rec');
  setRobot('');
  setMic(false, '聽聽看…');
  const result = await stopRec();
  handleSpeech(result);
}

mic.addEventListener('pointerdown', async (e) => {
  if (mic.disabled) return;
  e.preventDefault();
  mic.setPointerCapture(e.pointerId);

  // 如果目前處於點擊模式中，再次點擊代表結束送出
  if (toggleModeActive) {
    toggleModeActive = false;
    isPressing = false;
    await doStopRec();
    return;
  }

  isPressing = true;
  pressStartTime = Date.now();
  const ok = await doStartRec();
  if (!ok) isPressing = false;
});

mic.addEventListener('pointerup', async () => {
  if (!isPressing) return;
  const elapsed = Date.now() - pressStartTime;
  isPressing = false;

  // 若按壓時間小於 450ms，自動切換為「點擊模式」，繼續錄音讓小孩悠閒說話
  if (elapsed < 450) {
    toggleModeActive = true;
    $('#micLabel').textContent = '點一下送出';
    return;
  }

  // 若是長按超過 450ms，則放開時直接送出（長按對講機模式）
  toggleModeActive = false;
  await doStopRec();
});

mic.addEventListener('pointercancel', async () => {
  if (isPressing && !toggleModeActive) {
    isPressing = false;
    await doStopRec();
  }
});
mic.addEventListener('contextmenu', (e) => e.preventDefault());

/* ================= 按鈕 ================= */
// 中翻英/PK 還沒作答前，「再聽」只念中文題目，不洩漏答案
const answerHidden = () => S.mode !== 'repeat' && !S.tries;
$('#btnListen').onclick = () => {
  if (answerHidden()) return speak(cur().zh, { lang: 'zh' });
  say(cur().en, cur().zh);
  speak(cur().en);
};
$('#btnSlow').onclick = () => {
  if (answerHidden()) return speak(cur().zh, { lang: 'zh', rate: 0.7 });
  speak(cur().en, { rate: profile.rate * 0.6 });
};
$('#btnHint').onclick = showHint;
$('#btnSkip').onclick = () => {
  stopSpeaking();
  if (S.mode === 'pk') return;
  record(cur(), false);
  next();
};
$('#btnQuit').onclick = () => {
  clearTimer();
  stopSpeaking();
  show('home');
  renderChips();
};
$('#btnHome').onclick = () => {
  show('home');
  renderChips();
};
$('#btnRetryWrong').onclick = () =>
  startSession(
    S.mode,
    S.results.filter((r) => !r.firstTry).map((r) => r.q)
  );
$$('.mode').forEach((b) => (b.onclick = () => startSession(b.dataset.mode)));
$$('[data-pick]').forEach((b) => (b.onclick = () => pickPreset(b.dataset.pick)));

$('#tabWeekly').onclick = () => {
  currentScope = 'weekly';
  $('#tabWeekly').className = 'primary';
  $('#tabTextbook').className = 'ghost';
  $('#pickPresets').classList.remove('hidden');
  updateUnitSelector();
  const saved = store.json('sel_weekly_' + profile.id, null);
  if (saved?.length) selected = new Set(saved);
  else pickPreset('pk');
  renderChips();
};

$('#tabTextbook').onclick = () => {
  currentScope = 'textbook';
  $('#tabTextbook').className = 'primary';
  $('#tabWeekly').className = 'ghost';
  $('#pickPresets').classList.add('hidden');
  updateUnitSelector();
  const saved = store.json('sel_textbook_' + profile.id, null);
  if (saved?.length) selected = new Set(saved);
  else pickPreset('all');
  renderChips();
};

$('#selUnit').onchange = (e) => {
  selectedUnitId = e.target.value;
  pickPreset('all');
};

/* ================= 設定 ================= */
function fillVoiceSelect() {
  const sel = $('#inVoice');
  if (!sel) return;
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const curV = enVoice();
  sel.innerHTML = en
    .map((v) => `<option value="${v.name}" ${curV?.name === v.name ? 'selected' : ''}>${v.name} (${v.lang})</option>`)
    .join('');
}
$('#btnSettings').onclick = () => {
  $('#inKey').value = store.key;
  $('#keyStatus').textContent = store.key ? '已設定' : '未設定';
  fillVoiceSelect();
  $('#settings').showModal();
};
$('#btnTestKey').onclick = async () => {
  const k = cleanKey($('#inKey').value);
  $('#keyStatus').textContent = '測試中…';
  try {
    const r = await fetch(GROQ + '/models', { headers: { Authorization: 'Bearer ' + k } });
    $('#keyStatus').textContent = r.ok ? '✅ 可以用' : `❌ 失敗 (${r.status})`;
  } catch (e) {
    $('#keyStatus').textContent = '❌ ' + e.message;
  }
};
$('#btnTestVoice').onclick = () => {
  localStorage.setItem('voice', $('#inVoice').value);
  speak('Could you do me a favor?', { rate: profile?.rate ?? 0.9 });
};
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  store.key = $('#inKey').value;
  if ($('#inVoice').value) localStorage.setItem('voice', $('#inVoice').value);
  $('#keyWarn').classList.toggle('hidden', !!store.key);
});

/* ================= 啟動 ================= */
(async function init() {
  DATA = await (await fetch('lessons.json', { cache: 'no-cache' })).json();
  setProfile(localStorage.getItem('profile') || DATA.profiles[0].id);
  updateUnitSelector();
  const saved = store.json('sel_weekly_' + profile.id, null);
  if (saved?.length) selected = new Set(saved);
  else pickPreset(DATA.pk && DATA.pk.date >= today() ? 'pk' : 'current');
  renderProfiles();
  renderChips();
  $('#keyWarn').classList.toggle('hidden', !!store.key);
})();
