/* SoundPad — pads de áudio de baixa latência para navegador (iPhone incluso).
 *
 * Decisões que importam para o som sair no instante do toque:
 *  - Web Audio API com AudioBuffer já decodificado na memória. Um <audio>.play()
 *    no iOS custa dezenas/centenas de ms; AudioBufferSourceNode.start() dispara
 *    no próximo bloco de áudio (~3-10 ms).
 *  - Evento `touchstart`, não `click`: o iOS só emite click ~300 ms depois,
 *    e só no fim do toque.
 *  - latencyHint 'interactive' pede o menor buffer possível ao sistema.
 *  - navigator.audioSession = 'playback' (iOS 16.4+) faz o som tocar mesmo
 *    com a chavinha de silencioso ligada.
 *
 * Organização: pastas ("situações"), cada uma com 16 pads independentes.
 * Trocar de pasta não interrompe o que está tocando — só o botão Parar faz isso.
 */

const PAD_COUNT = 16;
const KEYS = '1234qwerasdfzxcv';
const PALETTE = ['#ff4d6d', '#ff7a45', '#ffc93c', '#7bed9f',
                 '#2ed573', '#18dcff', '#4d7cfe', '#6c5ce7',
                 '#b967ff', '#ff6ec7', '#ff9ff3', '#00d2d3'];
const SUGGESTIONS = ['Efeitos', 'Memes', 'Podcast', 'Live', 'Ambiente', 'Vinhetas', 'Risadas', 'Jogos'];

/* ======================= contexto de áudio ======================= */

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC({ latencyHint: 'interactive' });
const master = ctx.createGain();
master.gain.value = 0.9;

// Limitador de segurança: vários pads somados (ou um arquivo já bem alto)
// estouram o 0 dBFS e distorcem. Isso segura sem alterar o som normal.
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -2;
limiter.knee.value = 0;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.12;

master.connect(limiter).connect(ctx.destination);

// iOS 16.4+: toca mesmo com o interruptor de silencioso ativado.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

/* Destrave do áudio no iOS.
 *
 * Medido no Safari do iOS (simulador, iPhone 16 Pro): com o contexto suspenso,
 * `start()` não toca NADA e o `onended` nunca dispara — a voz é descartada em
 * silêncio. E `ctx.resume()` é assíncrono. Então "resume e toca na linha
 * seguinte" é uma corrida: às vezes o resume chega a tempo, às vezes não.
 * Era essa a causa do som falhar de forma intermitente.
 *
 * Além disso, ir para o segundo plano suspende o contexto TODA vez, e o iOS só
 * deixa retomar dentro de um gesto do usuário — por isso o resume no
 * visibilitychange não resolve sozinho.
 *
 * Esta função precisa ser chamada DENTRO do gesto. Devolve a promessa do
 * resume para quem quiser esperar o contexto voltar antes de tocar. */
function destravar() {
  let pronto;
  try { pronto = ctx.resume(); } catch {}

  // O buffer mudo é o que de fato convence o iOS; o resume sozinho não basta.
  try {
    const mudo = ctx.createBufferSource();
    mudo.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    mudo.connect(ctx.destination);
    mudo.start(0);
  } catch {}

  // Reafirmado a cada destrave: uma interrupção (ligação, outro app) pode
  // derrubar a categoria da sessão de áudio.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

  return (pronto && pronto.then ? pronto : Promise.resolve()).then(setStatus, setStatus);
}

/* ---- mantenedor da sessão de áudio ----
 *
 * O problema de raiz: para o iOS, Web Audio sozinho é som "acessório" e a
 * sessão morre quando o app sai de foco. Um app de música não sofre disso
 * porque o sistema o enxerga como MEDIA PLAYBACK.
 *
 * Um <audio> em loop (praticamente mudo) segura essa sessão de pé. Enquanto
 * ele toca, o AudioContext não é suspenso ao trocar de app, atender ligação ou
 * bloquear a tela — o pad responde na hora, sem gastar um toque para destravar.
 *
 * O áudio dos pads continua saindo direto pelo ctx.destination, que é o caminho
 * de menor latência; este elemento não entra na cadeia de som. */

function wavQuaseMudo(segundos = 2, sr = 8000) {
  const n = sr * segundos, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const txt = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, n * 2, true);
  // Silêncio absoluto pode ser descartado pelo sistema; 1 LSB é inaudível e real.
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  let bin = '';
  const bytes = new Uint8Array(b);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

const mantenedor = new Audio();
mantenedor.loop = true;
mantenedor.preload = 'auto';
mantenedor.volume = 0.02;
mantenedor.src = wavQuaseMudo();
mantenedor.setAttribute('playsinline', '');

let sessaoViva = false;

function manterSessao() {
  if (sessaoViva && !mantenedor.paused) return;
  const p = mantenedor.play();
  if (p && p.catch) p.catch(() => { sessaoViva = false; });
  sessaoViva = true;

  // Sem metadados o iOS mostra controles vazios na tela bloqueada.
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'SoundPad', artist: 'pads prontos', album: 'SoundPad',
        artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
      navigator.mediaSession.playbackState = 'playing';
      // Os botões do sistema não devem matar a sessão.
      const nada = () => {};
      navigator.mediaSession.setActionHandler('play', () => { manterSessao(); });
      navigator.mediaSession.setActionHandler('pause', nada);
      navigator.mediaSession.setActionHandler('stop', nada);
      navigator.mediaSession.setActionHandler('previoustrack', nada);
      navigator.mediaSession.setActionHandler('nexttrack', nada);
    }
  } catch {}
}

// Se o sistema pausar o mantenedor (interrupção), levanta de novo.
mantenedor.addEventListener('pause', () => { if (sessaoViva) setTimeout(manterSessao, 120); });

function unlock() {
  manterSessao();
  if (ctx.state !== 'running') destravar();
}
['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'].forEach(ev =>
  document.addEventListener(ev, unlock, { capture: true, passive: true }));

/* Voltar do segundo plano suspende o contexto no iOS. Tentar retomar aqui às
 * vezes funciona; quando não funciona (o iOS exige um gesto), o indicador fica
 * cinza e o próximo toque resolve — sem perder o som, graças ao trigger(). */
function aoVoltar() {
  if (document.hidden) { setStatus(); return; }
  if (ctx.state === 'running') { setStatus(); return; }
  try { ctx.resume().then(setStatus, setStatus); } catch { setStatus(); }
}
document.addEventListener('visibilitychange', aoVoltar);
window.addEventListener('pageshow', aoVoltar);
window.addEventListener('focus', aoVoltar);
ctx.addEventListener?.('statechange', setStatus);

function setStatus() {
  const live = ctx.state === 'running';
  document.getElementById('statusDot').classList.toggle('live', live);
  // No iOS a página sempre abre com o áudio suspenso até o primeiro toque.
  const h = document.getElementById('hint');
  if (h && !document.body.classList.contains('editing')) {
    h.textContent = live ? 'Toque em um pad' : 'Toque para ativar o som';
  }
}

/* ======================= banco de sons padrão ======================= */
/* Sintetizados no próprio navegador: nada para baixar, funciona offline. */

const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

function renderOffline(dur, build) {
  const sr = 44100;
  const oc = new OAC(1, Math.ceil(sr * dur), sr);
  build(oc, oc.destination);
  const done = oc.startRendering();
  const p = done instanceof Promise
    ? done
    : new Promise(res => { oc.oncomplete = e => res(e.renderedBuffer); });
  return p.then(capPeak);
}

// Contém o pico em 0.9 sem mexer nos sons que já são baixos de propósito.
function capPeak(buf) {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  if (peak > 0.9) {
    const k = 0.9 / peak;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}

function noise(oc, dur) {
  const b = oc.createBuffer(1, Math.ceil(oc.sampleRate * dur), oc.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = oc.createBufferSource();
  s.buffer = b;
  return s;
}

function decay(param, peak, dur, t = 0) {
  param.setValueAtTime(peak, t);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(oc, type, f0, f1, dur, peak, t = 0) {
  const o = oc.createOscillator(), g = oc.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  decay(g.gain, peak, dur, t);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
  return g;
}

function filtered(oc, src, type, freq, q = 1) {
  const f = oc.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  src.connect(f);
  return f;
}

const BANK = [
  { name: 'Kick', dur: 0.5, build: (oc, out) => {
      tone(oc, 'sine', 160, 45, 0.42, 1).connect(out);
      const c = noise(oc, 0.02), g = oc.createGain();
      decay(g.gain, 0.5, 0.02);
      filtered(oc, c, 'lowpass', 4000).connect(g).connect(out);
      c.start(0);
    } },
  { name: 'Snare', dur: 0.35, build: (oc, out) => {
      const n = noise(oc, 0.3), g = oc.createGain();
      decay(g.gain, 0.8, 0.22);
      filtered(oc, n, 'bandpass', 1800, 0.7).connect(g).connect(out);
      n.start(0);
      tone(oc, 'triangle', 200, 140, 0.13, 0.5).connect(out);
    } },
  { name: 'Hat', dur: 0.12, build: (oc, out) => {
      const n = noise(oc, 0.1), g = oc.createGain();
      decay(g.gain, 0.45, 0.055);
      filtered(oc, n, 'highpass', 8200).connect(g).connect(out);
      n.start(0);
    } },
  { name: 'Open Hat', dur: 0.5, build: (oc, out) => {
      const n = noise(oc, 0.45), g = oc.createGain();
      decay(g.gain, 0.4, 0.4);
      filtered(oc, n, 'highpass', 7400).connect(g).connect(out);
      n.start(0);
    } },

  { name: 'Clap', dur: 0.4, build: (oc, out) => {
      [0, 0.012, 0.026, 0.042].forEach((t, i) => {
        const n = noise(oc, 0.2), g = oc.createGain();
        decay(g.gain, i === 3 ? 0.7 : 0.4, i === 3 ? 0.22 : 0.035, t);
        filtered(oc, n, 'bandpass', 1150, 0.9).connect(g).connect(out);
        n.start(t);
      });
    } },
  { name: 'Rim', dur: 0.12, build: (oc, out) => {
      const n = noise(oc, 0.06), g = oc.createGain();
      decay(g.gain, 0.6, 0.045);
      filtered(oc, n, 'bandpass', 2600, 2).connect(g).connect(out);
      n.start(0);
      tone(oc, 'square', 440, 300, 0.035, 0.25).connect(out);
    } },
  { name: 'Tom', dur: 0.45, build: (oc, out) => {
      tone(oc, 'sine', 240, 90, 0.4, 0.9).connect(out);
    } },
  { name: 'Cowbell', dur: 0.35, build: (oc, out) => {
      const g = oc.createGain();
      decay(g.gain, 0.45, 0.3);
      [540, 800].forEach(f => {
        const o = oc.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        o.connect(g); o.start(0); o.stop(0.34);
      });
      filtered(oc, g, 'bandpass', 2400, 1.4).connect(out);
    } },

  { name: 'Bass', dur: 0.8, build: (oc, out) => {
      const o = oc.createOscillator(), g = oc.createGain(), f = oc.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 55;
      f.type = 'lowpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(1800, 0);
      f.frequency.exponentialRampToValueAtTime(90, 0.5);
      decay(g.gain, 0.8, 0.7);
      o.connect(f).connect(g).connect(out);
      o.start(0); o.stop(0.8);
    } },
  { name: 'Stab', dur: 0.6, build: (oc, out) => {
      const g = oc.createGain(), f = oc.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 4;
      f.frequency.setValueAtTime(3600, 0);
      f.frequency.exponentialRampToValueAtTime(420, 0.45);
      decay(g.gain, 0.3, 0.5);
      [146.83, 174.61, 220].forEach(fr => {
        const o = oc.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = fr;
        o.connect(f); o.start(0); o.stop(0.6);
      });
      f.connect(g).connect(out);
    } },
  { name: 'Chord', dur: 1.6, build: (oc, out) => {
      const g = oc.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.28, 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, 1.55);
      [261.63, 329.63, 392, 523.25].forEach(fr => {
        const o = oc.createOscillator();
        o.type = 'sine'; o.frequency.value = fr;
        o.connect(g); o.start(0); o.stop(1.6);
      });
      g.connect(out);
    } },
  { name: 'Blip', dur: 0.15, build: (oc, out) => {
      tone(oc, 'square', 1320, 880, 0.1, 0.25).connect(out);
    } },

  { name: 'Laser', dur: 0.4, build: (oc, out) => {
      tone(oc, 'sawtooth', 2000, 110, 0.35, 0.3).connect(out);
    } },
  { name: 'Zap', dur: 0.35, build: (oc, out) => {
      const n = noise(oc, 0.3), g = oc.createGain(), f = oc.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 8;
      f.frequency.setValueAtTime(9000, 0);
      f.frequency.exponentialRampToValueAtTime(200, 0.3);
      decay(g.gain, 0.6, 0.3);
      n.connect(f).connect(g).connect(out);
      n.start(0);
    } },
  { name: 'Sweep', dur: 1.2, build: (oc, out) => {
      const n = noise(oc, 1.2), g = oc.createGain(), f = oc.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(220, 0);
      f.frequency.exponentialRampToValueAtTime(8000, 1.1);
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.55, 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, 1.2);
      n.connect(f).connect(g).connect(out);
      n.start(0);
    } },
  { name: 'Vinyl', dur: 1.4, build: (oc, out) => {
      const n = noise(oc, 1.4), g = oc.createGain();
      g.gain.value = 0.12;
      filtered(oc, n, 'lowpass', 2600).connect(g).connect(out);
      n.start(0);
      tone(oc, 'sine', 60, 55, 1.3, 0.1).connect(out);
    } },
];

const defaultBuffers = [];

/* ======================= persistência (IndexedDB) ======================= */
/* Pastas e sons do usuário ficam salvos no aparelho e voltam ao reabrir. */

const DB_NAME = 'soundpad', DB_VERSION = 2;
const FOLDERS = 'folders', PADS = 'pads';
const FIRST_FOLDER = 'kit';
let dbp;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const d = r.result, tx = r.transaction;

      if (!d.objectStoreNames.contains(FOLDERS)) d.createObjectStore(FOLDERS, { keyPath: 'id' });

      if (e.oldVersion === 1 && d.objectStoreNames.contains(PADS)) {
        // v1 guardava 16 pads soltos, sem pasta. Eles viram a primeira pasta.
        const req = tx.objectStore(PADS).getAll();
        req.onsuccess = () => {
          const rows = req.result || [];
          d.deleteObjectStore(PADS);
          const ns = d.createObjectStore(PADS, { keyPath: 'key' });
          ns.createIndex('folderId', 'folderId');
          rows.forEach(rec => ns.put({
            ...rec, key: FIRST_FOLDER + ':' + rec.id, folderId: FIRST_FOLDER, i: rec.id,
          }));
        };
      } else if (!d.objectStoreNames.contains(PADS)) {
        const ns = d.createObjectStore(PADS, { keyPath: 'key' });
        ns.createIndex('folderId', 'folderId');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode = 'readonly') {
  return db().then(d => d.transaction(store, mode).objectStore(store));
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function loadFolders() {
  try { return await req((await tx(FOLDERS)).getAll()) || []; }
  catch { return []; }
}

async function loadFolderPads(folderId) {
  try { return await req((await tx(PADS)).index('folderId').getAll(folderId)) || []; }
  catch { return []; }
}

async function saveFolder(f) {
  try { (await tx(FOLDERS, 'readwrite')).put({ id: f.id, name: f.name, kit: f.kit, order: f.order }); }
  catch (e) { console.warn('não deu para salvar a pasta', e); }
}

async function removeFolder(id) {
  try {
    const d = await db();
    const t = d.transaction([FOLDERS, PADS], 'readwrite');
    t.objectStore(FOLDERS).delete(id);
    const idx = t.objectStore(PADS).index('folderId');
    const keys = await req(idx.getAllKeys(id));
    keys.forEach(k => t.objectStore(PADS).delete(k));
  } catch (e) { console.warn('não deu para apagar a pasta', e); }
}

async function savePad(p) {
  try {
    (await tx(PADS, 'readwrite')).put({
      key: p.folderId + ':' + p.id,
      folderId: p.folderId,
      i: p.id,
      name: p.name, color: p.color, mode: p.mode, vol: p.vol, choke: p.choke,
      defIdx: p.defIdx ?? null,
      blob: p.blobRef || null, fileName: p.fileName,
    });
  } catch (e) { console.warn('não deu para salvar o pad', e); }
}

async function removePad(p) {
  try { (await tx(PADS, 'readwrite')).delete(p.folderId + ':' + p.id); } catch {}
}

/* ============== armazenamento persistente ============== */
/* Medido no Safari do iOS (simulador, iPhone 16 Pro): numa aba comum o
 * navegador NEGA o pedido; aberto pela Tela de Início (standalone) ele CONCEDE.
 * Com a permissão, o sistema para de apagar os sons sozinho — por inatividade
 * (a regra dos 7 dias do Safari) ou por falta de espaço.
 * Isso NÃO protege de "Limpar dados dos sites" nem de apagar o ícone: para
 * esses casos só um backup resolve. */

let persistente = false;

const naTelaDeInicio = () =>
  navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

const pareceIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.platform || '') ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || '')) ||
  navigator.standalone !== undefined;

async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return;
    persistente = await navigator.storage.persisted();
    if (!persistente) persistente = await navigator.storage.persist();
  } catch { /* navegador sem suporte: segue sem a garantia */ }
}

// Só avisa quem tem algo a perder — num app recém-aberto o aviso seria ruído.
function avaliarRiscoDePerda() {
  const warn = document.getElementById('warn');
  if (!warn) return;

  let proprios = 0;
  padsByFolder.forEach(lista => lista.forEach(p => { if (p.fileName) proprios++; }));

  const emRisco = proprios > 0 && !persistente;
  const dispensado = localStorage.getItem('sp.avisoOff') === '1';

  if (!emRisco || dispensado) { warn.hidden = true; return; }

  document.getElementById('warnText').textContent = (pareceIOS() && !naTelaDeInicio())
    ? 'Seus sons podem ser apagados pelo iOS depois de alguns dias sem uso. Compartilhar → Adicionar à Tela de Início protege.'
    : 'O navegador pode apagar seus sons se faltar espaço. Vale guardar uma cópia dos arquivos.';
  warn.hidden = false;
}

document.getElementById('warnClose')?.addEventListener('click', () => {
  localStorage.setItem('sp.avisoOff', '1');
  document.getElementById('warn').hidden = true;
});

/* ======================= estado ======================= */

let folders = [];                 // [{id, name, kit, order}]
const padsByFolder = new Map();   // id da pasta -> array de 16 pads (em memória)
let currentFolder = null;
let pads = [];                    // atalho para os pads da pasta aberta

function makePads(folder) {
  return Array.from({ length: PAD_COUNT }, (_, i) => ({
    id: i,
    folderId: folder.id,
    name: folder.kit === 'drums' ? BANK[i].name : '',
    color: PALETTE[i % PALETTE.length],
    mode: 'oneshot',
    vol: 1,
    choke: true,
    // defIdx acompanha o pad quando ele troca de lugar; antes o som padrão era
    // amarrado à posição e a troca embaralhava os nomes.
    defIdx: folder.kit === 'drums' ? i : null,
    defName: folder.kit === 'drums' ? BANK[i].name : '',
    buffer: folder.kit === 'drums' ? defaultBuffers[i] || null : null,
    defBuffer: folder.kit === 'drums' ? defaultBuffers[i] || null : null,
    fileName: null,
    blobRef: null,
    voices: [],
    el: null,
  }));
}

function decodeAudio(arrayBuffer) {
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(arrayBuffer, res, rej);
    if (p && p.then) p.then(res, rej);
  });
}

async function loadCustom(p, blob, fileName) {
  p.buffer = await decodeAudio(await blob.arrayBuffer());
  p.fileName = fileName;
}

/* Distribui vários arquivos pelos pads da pasta aberta.
 * `pular` deixa intactos os pads que já têm som — é o que faz sentido ao
 * completar uma pasta; sem ele, o lote sobrescreve a partir do pad escolhido.
 * Decodifica um por vez de propósito: 16 arquivos grandes de uma vez só
 * engasgam o Safari do iPhone. */
async function fillPads(inicio, arquivos, { pular = false, aoAndar = () => {} } = {}) {
  let i = inicio, ok = 0, falhas = 0;
  const nomesComFalha = [];

  for (const file of arquivos) {
    if (pular) while (i < PAD_COUNT && !isEmpty(pads[i])) i++;
    if (i >= PAD_COUNT) break;

    aoAndar(ok + falhas + 1, arquivos.length, file.name);
    const p = pads[i];
    try {
      await loadCustom(p, file, file.name);
      p.blobRef = file;
      p.name = file.name.replace(/\.[^.]+$/, '').slice(0, 14);
      renderPad(p);
      savePad(p);
      ok++;
      avaliarRiscoDePerda();
    } catch (e) {
      console.warn('não deu para ler', file.name, e);
      falhas++;
      nomesComFalha.push(file.name);
    }
    i++;
  }

  return { ok, falhas, nomesComFalha, sobraram: arquivos.length - ok - falhas };
}

function resumoDaCarga({ ok, falhas, sobraram, nomesComFalha }) {
  const partes = [`${ok} ${ok === 1 ? 'som carregado' : 'sons carregados'}`];
  if (falhas) partes.push(`${falhas} não deu para ler (${nomesComFalha.slice(0, 2).join(', ')})`);
  if (sobraram) partes.push(`${sobraram} ${sobraram === 1 ? 'ficou de fora' : 'ficaram de fora'}: a pasta só tem ${PAD_COUNT} pads`);
  return partes.join(' · ');
}

// Carrega (uma vez) os pads de uma pasta: ajustes salvos + arquivos do usuário.
async function getPads(folder) {
  if (padsByFolder.has(folder.id)) return padsByFolder.get(folder.id);

  const list = makePads(folder);
  padsByFolder.set(folder.id, list);

  for (const rec of await loadFolderPads(folder.id)) {
    const p = list[rec.i];
    if (!p) continue;
    if (typeof rec.name === 'string') p.name = rec.name;
    if (rec.color) p.color = rec.color;
    if (rec.mode) p.mode = rec.mode;
    if (typeof rec.vol === 'number') p.vol = rec.vol;
    if (typeof rec.choke === 'boolean') p.choke = rec.choke;
    if (rec.defIdx !== undefined) {
      p.defIdx = rec.defIdx;
      p.defBuffer = rec.defIdx === null ? null : (defaultBuffers[rec.defIdx] || null);
      p.defName = rec.defIdx === null ? '' : BANK[rec.defIdx].name;
      if (!rec.blob) p.buffer = p.defBuffer;
    }
    if (rec.blob) {
      try {
        await loadCustom(p, rec.blob, rec.fileName || 'som');
        p.blobRef = rec.blob;
      } catch (e) { console.warn('não deu para decodificar o som do pad', rec.key, e); }
    }
  }
  return list;
}

const isEmpty = p => !p.buffer;

/* ======================= reprodução ======================= */

function stopPad(p, fade = 0.012) {
  const t = ctx.currentTime;
  p.voices.forEach(v => {
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
      v.src.stop(t + fade + 0.005);
    } catch {}
  });
  p.voices = [];
  p.el?.classList.remove('playing');
  updateStopCount();
}

function trigger(i) {
  const p = pads[i];
  if (!p || isEmpty(p)) return;

  if (p.mode === 'loop' && p.voices.length) { stopPad(p); flash(p); return; }

  flash(p);                         // resposta visual imediata, mesmo se o áudio atrasar

  if (ctx.state === 'running') { dispararVoz(p); return; }

  // Contexto caído (voltou do segundo plano, ligação, outro app tomou o áudio):
  // destrava agora, dentro do gesto, e só dispara quando ele estiver de pé —
  // disparar antes jogaria o som fora.
  destravar().then(() => { if (ctx.state === 'running') dispararVoz(p); });
}

function dispararVoz(p) {
  if (p.choke || p.mode !== 'oneshot') stopPad(p, 0.006);

  const src = ctx.createBufferSource();
  src.buffer = p.buffer;
  src.loop = p.mode === 'loop';

  const gain = ctx.createGain();
  gain.gain.value = p.vol;
  src.connect(gain).connect(master);

  const voice = { src, gain };
  p.voices.push(voice);
  src.onended = () => {
    p.voices = p.voices.filter(v => v !== voice);
    if (!p.voices.length) p.el?.classList.remove('playing');
    updateStopCount();
  };

  src.start();                      // sem delay: toca no próximo bloco de áudio
  p.el?.classList.add('playing');
  updateStopCount();
}

function release(i) {
  const p = pads[i];
  if (p && p.mode === 'gate') stopPad(p, 0.03);
}

function flash(p) {
  const el = p.el;
  if (!el) return;
  el.classList.remove('hit');
  void el.offsetWidth;              // reinicia a animação
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 340);
}

// Conta vozes de TODAS as pastas, não só da aberta.
function allVoices() {
  let n = 0;
  padsByFolder.forEach(list => list.forEach(p => { n += p.voices.length; }));
  return n;
}

function stopAll() {
  padsByFolder.forEach(list => list.forEach(p => p.voices.length && stopPad(p)));
  updateStopCount();
}

const btnStop = document.getElementById('btnStop');
function updateStopCount() {
  const n = allVoices();
  btnStop.textContent = n ? `Parar (${n})` : 'Parar';
  btnStop.classList.toggle('hot', n > 0);
}

/* ======================= grade de pads ======================= */

const grid = document.getElementById('grid');
const gridEls = [];
let editing = false;

for (let i = 0; i < PAD_COUNT; i++) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pad';
  el.dataset.i = i;
  el.innerHTML = '<span class="glow"></span><span class="label"></span><span class="sub"></span>';
  grid.appendChild(el);
  gridEls.push(el);
}

const MODE_LABEL = { oneshot: 'disparo', gate: 'segurar', loop: 'loop' };
const finePointer = window.matchMedia('(pointer: fine)').matches;

function renderPad(p) {
  const el = p.el;
  if (!el) return;
  const vazio = isEmpty(p);
  el.style.setProperty('--c', p.color);
  el.classList.toggle('empty', vazio);
  el.classList.toggle('custom', !!p.fileName);
  el.classList.toggle('playing', p.voices.length > 0);
  el.querySelector('.label').textContent = vazio ? '+' : (p.name || 'Sem nome');
  el.querySelector('.sub').textContent = vazio
    ? 'vazio'
    : (p.fileName ? '♫ ' : '') + MODE_LABEL[p.mode] + (finePointer ? ' · ' + KEYS[p.id].toUpperCase() : '');
  el.setAttribute('aria-label', vazio ? `Pad ${p.id + 1}, vazio` : p.name);
}

function renderAll() { pads.forEach(renderPad); }

/* ======================= pastas ======================= */

const foldersBar = document.getElementById('folders');

function renderFolders() {
  foldersBar.innerHTML = '';
  folders.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fchip';
    b.dataset.id = f.id;
    b.textContent = f.name;
    if (f.id === currentFolder?.id) {
      b.setAttribute('aria-current', 'true');
      // Com muitas pastas a barra rola; a ativa nunca pode ficar fora da vista.
      requestAnimationFrame(() => b.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }
    foldersBar.appendChild(b);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'fchip add';
  add.id = 'addFolder';
  add.textContent = '+';
  add.setAttribute('aria-label', 'Nova pasta');
  foldersBar.appendChild(add);
}

async function openFolder(id) {
  const f = folders.find(x => x.id === id);
  if (!f) return;

  // Solta os elementos da pasta anterior — o som dela continua tocando.
  pads.forEach(p => { p.el = null; });

  currentFolder = f;
  localStorage.setItem('sp.folder', id);

  const list = await getPads(f);
  pads = list;
  pads.forEach((p, i) => { p.el = gridEls[i]; });

  renderFolders();
  renderAll();
  updateStopCount();
}

foldersBar.addEventListener('click', e => {
  const b = e.target.closest('.fchip');
  if (!b) return;
  if (b.classList.contains('add')) { openFolderSheet(null); return; }
  if (editing) return;              // no modo editar quem decide é o pointerup do arrasto
  if (b.dataset.id !== currentFolder?.id) openFolder(b.dataset.id);
});

/* ---- reordenar arrastando (só no modo editar) ----
 * Fora do modo editar a barra precisa rolar na horizontal, e as duas coisas
 * disputam o mesmo gesto. No modo editar, um toque parado abre os ajustes e
 * um toque que anda mais de 8 px vira arrasto. */

const LIMIAR = 8;
let drag = null;
let autoScrollRAF = 0;

/* Nada de setPointerCapture aqui: mover o chip no DOM (que é justamente o que
 * o rearranjo faz) cancela a captura, e os eventos seguintes passam a ir para
 * o elemento embaixo do dedo. Ouvir na janela é o que garante receber o
 * pointerup mesmo se o dedo sair da barra por cima dos pads. */
foldersBar.addEventListener('pointerdown', e => {
  if (!editing || e.button > 0 || drag) return;
  const chip = e.target.closest('.fchip:not(.add)');
  if (!chip) return;
  drag = { chip, id: chip.dataset.id, pointerId: e.pointerId, startX: e.clientX, originX: e.clientX, andou: false, x: e.clientX };
  window.addEventListener('pointermove', aoMover, { passive: false });
  window.addEventListener('pointerup', encerrarArrasto);
  window.addEventListener('pointercancel', encerrarArrasto);
});

function aoMover(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.x = e.clientX;

  if (!drag.andou) {
    if (Math.abs(e.clientX - drag.startX) < LIMIAR) return;
    drag.andou = true;
    drag.chip.classList.add('dragging');
    document.body.classList.add('dragging-folder');
    autoScrollRAF = requestAnimationFrame(rolarNaBorda);
  }
  e.preventDefault();
  posicionarArrasto(e.clientX);
}

// Mantém o chip embaixo do dedo e rearranja os vizinhos ao cruzar o meio deles.
function posicionarArrasto(x) {
  const chip = drag.chip;
  chip.style.transform = '';                       // mede a posição real no fluxo
  const antes = chip.getBoundingClientRect().left;

  const vizinhos = [...foldersBar.querySelectorAll('.fchip:not(.add)')].filter(c => c !== chip);
  let ref = null;
  for (const v of vizinhos) {
    const r = v.getBoundingClientRect();
    if (x < r.left + r.width / 2) { ref = v; break; }
  }
  const alvo = ref || foldersBar.querySelector('.fchip.add');
  if (alvo !== chip.nextSibling) foldersBar.insertBefore(chip, alvo);

  const agora = chip.getBoundingClientRect().left;
  drag.originX += agora - antes;                   // o arrasto segue contínuo após o rearranjo
  chip.style.transform = `translateX(${x - drag.originX}px)`;
}

// Segurar o chip junto da borda rola a barra: sem isso não dá para mover uma
// pasta até o outro extremo quando há muitas.
function rolarNaBorda() {
  if (!drag || !drag.andou) return;
  const r = foldersBar.getBoundingClientRect();
  const margem = 48;
  let d = 0;
  if (drag.x < r.left + margem) d = -8;
  else if (drag.x > r.right - margem) d = 8;
  if (d) {
    const antes = foldersBar.scrollLeft;
    foldersBar.scrollLeft += d;
    if (foldersBar.scrollLeft !== antes) posicionarArrasto(drag.x);
  }
  autoScrollRAF = requestAnimationFrame(rolarNaBorda);
}

function encerrarArrasto(e) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const { chip, andou, id } = drag;
  drag = null;
  cancelAnimationFrame(autoScrollRAF);
  window.removeEventListener('pointermove', aoMover);
  window.removeEventListener('pointerup', encerrarArrasto);
  window.removeEventListener('pointercancel', encerrarArrasto);

  chip.style.transform = '';
  chip.classList.remove('dragging');
  document.body.classList.remove('dragging-folder');

  // Toque parado (sem arrasto) abre os ajustes da pasta.
  if (!andou) { openFolderSheet(folders.find(f => f.id === id)); return; }
  gravarOrdem();
}

async function gravarOrdem() {
  const ids = [...foldersBar.querySelectorAll('.fchip:not(.add)')].map(c => c.dataset.id);
  folders.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  folders.forEach((f, i) => { f.order = i; });
  await Promise.all(folders.map(saveFolder));
  renderFolders();
}

/* ======================= entrada ======================= */

/* ---- toque: multi-touch, dispara em touchstart ---- */

const activeTouches = new Map();
let lastTouchAt = 0;

grid.addEventListener('touchstart', e => {
  lastTouchAt = Date.now();
  for (const t of e.changedTouches) {
    const el = t.target.closest?.('.pad');
    if (!el) continue;
    e.preventDefault();             // mata o zoom de duplo toque e o click fantasma
    const i = +el.dataset.i;
    // No modo editar o gesto é do arrasto (ver abaixo): toque parado abre os
    // ajustes, toque que anda troca os pads de lugar.
    if (editing) continue;
    // Pad vazio leva direto para os ajustes: é o único jeito de dar som a ele.
    if (isEmpty(pads[i])) { openSheet(i); continue; }
    activeTouches.set(t.identifier, i);
    trigger(i);
  }
}, { passive: false });

function endTouch(e) {
  for (const t of e.changedTouches) {
    if (!activeTouches.has(t.identifier)) continue;
    release(activeTouches.get(t.identifier));
    activeTouches.delete(t.identifier);
  }
}
grid.addEventListener('touchend', endTouch);
grid.addEventListener('touchcancel', endTouch);

/* ---- arrastar pads para trocar de lugar (só no modo editar) ----
 * Mesma regra da barra de pastas: parado abre os ajustes, andando arrasta.
 * A troca é por permuta — o pad de destino vem para a origem. Numa grade de
 * 4x4 isso é o que o dedo espera; "empurrar todos" embaralharia o resto. */

const LIMIAR_PAD = 10;
let dragPad = null;

grid.addEventListener('pointerdown', e => {
  if (!editing || e.button > 0 || dragPad) return;
  const el = e.target.closest('.pad');
  if (!el) return;
  dragPad = { el, i: +el.dataset.i, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, andou: false, alvo: null };
  window.addEventListener('pointermove', aoMoverPad, { passive: false });
  window.addEventListener('pointerup', encerrarPad);
  window.addEventListener('pointercancel', encerrarPad);
});

function aoMoverPad(e) {
  if (!dragPad || e.pointerId !== dragPad.pointerId) return;
  const dx = e.clientX - dragPad.startX;
  const dy = e.clientY - dragPad.startY;

  if (!dragPad.andou) {
    if (Math.hypot(dx, dy) < LIMIAR_PAD) return;
    dragPad.andou = true;
    dragPad.el.classList.add('arrastando');
    document.body.classList.add('dragging-pad');
  }
  e.preventDefault();
  dragPad.el.style.transform = `translate(${dx}px, ${dy}px)`;

  // Descobre sobre qual pad o dedo está, ignorando o que está sendo arrastado.
  dragPad.el.style.pointerEvents = 'none';
  const sob = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pad');
  dragPad.el.style.pointerEvents = '';

  if (sob !== dragPad.alvo) {
    dragPad.alvo?.classList.remove('alvo');
    dragPad.alvo = sob && sob !== dragPad.el ? sob : null;
    dragPad.alvo?.classList.add('alvo');
  }
}

function encerrarPad(e) {
  if (!dragPad || (e && e.pointerId !== dragPad.pointerId)) return;
  const { el, i, andou, alvo } = dragPad;
  dragPad = null;
  window.removeEventListener('pointermove', aoMoverPad);
  window.removeEventListener('pointerup', encerrarPad);
  window.removeEventListener('pointercancel', encerrarPad);

  el.style.transform = '';
  el.classList.remove('arrastando');
  alvo?.classList.remove('alvo');
  document.body.classList.remove('dragging-pad');

  if (!andou) { openSheet(i); return; }
  if (alvo) trocarPads(pads[i], pads[+alvo.dataset.i]);
}

// Troca o conteúdo de dois pads. Os elementos ficam onde estão; o que anda é o
// som e tudo que o descreve.
function trocarPads(a, b) {
  if (!a || !b || a === b) return;
  stopPad(a); stopPad(b);
  for (const k of ['name', 'color', 'mode', 'vol', 'choke', 'defIdx', 'defName', 'buffer', 'defBuffer', 'fileName', 'blobRef']) {
    const t = a[k]; a[k] = b[k]; b[k] = t;
  }
  renderPad(a); renderPad(b);
  savePad(a); savePad(b);
}

/* ---- mouse (desktop) ---- */

let mouseIndex = null;
grid.addEventListener('mousedown', e => {
  if (Date.now() - lastTouchAt < 800) return;   // evento sintetizado do toque
  const el = e.target.closest('.pad');
  if (!el) return;
  e.preventDefault();
  const i = +el.dataset.i;
  if (editing) return;
  if (isEmpty(pads[i])) { openSheet(i); return; }
  mouseIndex = i;
  trigger(i);
});
window.addEventListener('mouseup', () => {
  if (mouseIndex !== null) { release(mouseIndex); mouseIndex = null; }
});

/* ---- teclado ---- */

const held = new Set();
window.addEventListener('keydown', e => {
  // e.target nem sempre é Element (window/document), daí os encadeamentos opcionais.
  if (e.repeat || e.metaKey || e.ctrlKey || e.target?.matches?.('input, textarea')) return;
  if (e.key === 'Escape') { closeSheet(); closeFolderSheet(); stopAll(); return; }

  // Setas trocam de pasta.
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const at = folders.findIndex(f => f.id === currentFolder?.id);
    const next = folders[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { e.preventDefault(); openFolder(next.id); }
    return;
  }

  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || isEmpty(pads[i] || {})) return;
  e.preventDefault();
  held.add(i);
  trigger(i);
});
window.addEventListener('keyup', e => {
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0 && held.delete(i)) release(i);
});

/* ---- barras ---- */

const btnEdit = document.getElementById('btnEdit');
const hint = document.getElementById('hint');

btnEdit.addEventListener('click', () => {
  editing = !editing;
  btnEdit.setAttribute('aria-pressed', String(editing));
  document.body.classList.toggle('editing', editing);
  hint.textContent = editing ? 'Toque num pad ou pasta para ajustar' : 'Toque em um pad';
});

btnStop.addEventListener('click', stopAll);

const masterEl = document.getElementById('master');
masterEl.addEventListener('input', () => {
  master.gain.setTargetAtTime(+masterEl.value / 100, ctx.currentTime, 0.01);
  localStorage.setItem('sp.master', masterEl.value);
});
const savedMaster = localStorage.getItem('sp.master');
if (savedMaster !== null) { masterEl.value = savedMaster; master.gain.value = +savedMaster / 100; }

/* ======================= painel do pad ======================= */

const sheet = document.getElementById('sheet');
const fName = document.getElementById('fName');
const fFile = document.getElementById('fFile');
const fVol = document.getElementById('fVol');
const fVolVal = document.getElementById('fVolVal');
const fChoke = document.getElementById('fChoke');
const fMode = document.getElementById('fMode');
const fColors = document.getElementById('fColors');
const fReset = document.getElementById('fReset');
const picker = document.getElementById('filePicker');
let current = null;

PALETTE.forEach(c => {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.setProperty('--c', c);
  b.dataset.c = c;
  b.setAttribute('aria-label', 'cor ' + c);
  fColors.appendChild(b);
});

function padSourceLabel(p) {
  if (p.fileName) return '♫ ' + p.fileName;
  if (p.defBuffer) return 'som padrão (' + (p.defName || '—') + ')';
  return 'nenhum som — escolha um arquivo';
}

function openSheet(i) {
  current = pads[i];
  if (!current) return;
  document.getElementById('sheetTitle').textContent = `${currentFolder.name} · pad ${i + 1}`;
  fName.value = current.name;
  fFile.textContent = padSourceLabel(current);
  fReset.textContent = current.defBuffer ? 'Padrão' : 'Limpar';
  fReset.hidden = !current.fileName && !current.defBuffer;
  fVol.value = Math.round(current.vol * 100);
  fVolVal.textContent = fVol.value + '%';
  fChoke.checked = current.choke;
  [...fMode.children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === current.mode)));
  [...fColors.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === current.color)));
  sheet.hidden = false;
}

function closeSheet() { sheet.hidden = true; current = null; }

sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
document.getElementById('fDone').addEventListener('click', closeSheet);

fName.addEventListener('input', () => {
  if (!current) return;
  current.name = fName.value.trim() || (current.defBuffer ? current.defName : '');
  renderPad(current); savePad(current);
});

fVol.addEventListener('input', () => {
  if (!current) return;
  current.vol = +fVol.value / 100;
  fVolVal.textContent = fVol.value + '%';
  current.voices.forEach(v => v.gain.gain.setTargetAtTime(current.vol, ctx.currentTime, 0.01));
  savePad(current);
});

fChoke.addEventListener('change', () => {
  if (!current) return;
  current.choke = fChoke.checked;
  savePad(current);
});

fMode.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !current) return;
  stopPad(current);
  current.mode = b.dataset.mode;
  [...fMode.children].forEach(x => x.setAttribute('aria-checked', String(x === b)));
  renderPad(current); savePad(current);
});

fColors.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !current) return;
  current.color = b.dataset.c;
  [...fColors.children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderPad(current); savePad(current);
});

document.getElementById('fTest').addEventListener('click', () => current && trigger(current.id));
document.getElementById('fPick').addEventListener('click', () => picker.click());

picker.addEventListener('change', async () => {
  const files = [...(picker.files || [])];
  picker.value = '';
  if (!files.length || !current) return;
  const p = current;

  // Um arquivo: comportamento de sempre, com prévia.
  // Vários: preenchem deste pad em diante, sobrescrevendo.
  const res = await fillPads(p.id, files, {
    aoAndar: (n, total, nome) => {
      fFile.textContent = total > 1 ? `carregando ${n}/${total} — ${nome}` : 'carregando…';
    },
  });

  fName.value = p.name;
  fFile.textContent = files.length > 1 ? resumoDaCarga(res) : padSourceLabel(p);
  fReset.hidden = !p.fileName && !p.defBuffer;
  fReset.textContent = p.defBuffer ? 'Padrão' : 'Limpar';

  if (files.length === 1 && res.ok) trigger(p.id);
});

fReset.addEventListener('click', () => {
  if (!current) return;
  const p = current;
  stopPad(p);
  p.buffer = p.defBuffer;
  p.fileName = null;
  p.blobRef = null;
  p.name = p.defBuffer ? p.defName : '';
  fName.value = p.name;
  fFile.textContent = padSourceLabel(p);
  fReset.hidden = !p.defBuffer;
  renderPad(p);
  removePad(p);
});

/* ======================= painel da pasta ======================= */

const folderSheet = document.getElementById('folderSheet');
const gName = document.getElementById('gName');
const gKit = document.getElementById('gKit');
const gKitField = document.getElementById('gKitField');
const gSuggest = document.getElementById('gSuggest');
const gSuggestField = document.getElementById('gSuggestField');
const gDelete = document.getElementById('gDelete');
let editingFolder = null;   // null = criando

SUGGESTIONS.forEach(s => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip sm';
  b.textContent = s;
  gSuggest.appendChild(b);
});

gSuggest.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) gName.value = b.textContent;
});

function openFolderSheet(folder) {
  editingFolder = folder || null;
  const criando = !folder;
  document.getElementById('gTitle').textContent = criando ? 'Nova pasta' : 'Ajustar pasta';
  gName.value = folder ? folder.name : '';
  gSuggestField.hidden = !criando;
  gKitField.hidden = !criando;                      // o kit só se escolhe ao criar
  document.getElementById('gBulkField').hidden = criando;   // pasta precisa existir antes
  document.getElementById('gStatus').textContent = '';
  [...gKit.children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.kit === 'empty')));
  gDelete.hidden = criando || folders.length < 2;   // sempre sobra ao menos uma pasta
  gDelete.textContent = 'Apagar pasta';
  gDelete.dataset.armed = '';
  folderSheet.hidden = false;
  if (criando) setTimeout(() => gName.focus(), 60);
}

function closeFolderSheet() { folderSheet.hidden = true; editingFolder = null; }

folderSheet.addEventListener('click', e => { if (e.target === folderSheet) closeFolderSheet(); });

gKit.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  [...gKit.children].forEach(x => x.setAttribute('aria-checked', String(x === b)));
});

document.getElementById('gSave').addEventListener('click', async () => {
  const nome = gName.value.trim();
  if (editingFolder) {
    editingFolder.name = nome || editingFolder.name;
    await saveFolder(editingFolder);
    renderFolders();
  } else {
    const kit = [...gKit.children].find(b => b.getAttribute('aria-checked') === 'true')?.dataset.kit || 'empty';
    const f = {
      id: 'f' + Date.now().toString(36),
      name: nome || 'Pasta ' + (folders.length + 1),
      kit,
      order: folders.length,
    };
    folders.push(f);
    await saveFolder(f);
    await openFolder(f.id);
  }
  closeFolderSheet();
});

/* Carga em lote pela pasta: completa os pads vazios, na ordem.
 * O painel pode estar aberto para uma pasta que não é a da tela, então
 * trocamos para ela antes — senão o lote cairia na pasta errada. */
const bulkPicker = document.getElementById('bulkPicker');
const gStatus = document.getElementById('gStatus');
const gBulk = document.getElementById('gBulk');

gBulk.addEventListener('click', () => bulkPicker.click());

bulkPicker.addEventListener('change', async () => {
  const files = [...(bulkPicker.files || [])];
  bulkPicker.value = '';
  if (!files.length || !editingFolder) return;

  if (editingFolder.id !== currentFolder?.id) await openFolder(editingFolder.id);

  const vazios = pads.filter(isEmpty).length;
  if (!vazios) {
    gStatus.textContent = 'todos os 16 pads já têm som — limpe algum antes, ou crie outra pasta';
    return;
  }

  gBulk.disabled = true;
  const res = await fillPads(0, files, {
    pular: true,
    aoAndar: (n, total, nome) => { gStatus.textContent = `carregando ${n}/${total} — ${nome}`; },
  });
  gBulk.disabled = false;
  gStatus.textContent = resumoDaCarga(res);
});

// Apagar é destrutivo: exige um segundo toque para confirmar.
gDelete.addEventListener('click', async () => {
  if (!editingFolder) return;
  if (!gDelete.dataset.armed) {
    gDelete.dataset.armed = '1';
    gDelete.textContent = 'Apagar mesmo? Toque de novo';
    return;
  }
  const id = editingFolder.id;
  padsByFolder.get(id)?.forEach(p => p.voices.length && stopPad(p));
  padsByFolder.delete(id);
  folders = folders.filter(f => f.id !== id);
  await removeFolder(id);
  closeFolderSheet();
  await openFolder(currentFolder?.id === id ? folders[0].id : currentFolder.id);
});

/* ======================= service worker (offline) ======================= */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Se um SW novo assumir o controle, recarrega UMA vez: sem isso a aba segue
  // rodando o código velho até ser fechada, e o usuário fica preso numa versão
  // antiga sem ter como perceber.
  let jaRecarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (jaRecarregou) return;
    jaRecarregou = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update();
      // Procura atualização ao voltar para o app, não só no carregamento.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', function () {
          if (this.state === 'installed' && navigator.serviceWorker.controller) {
            this.postMessage?.('pular-espera');
          }
        });
      });
    } catch {}
  });
}

/* ======================= início ======================= */

async function boot() {
  // Sons de fábrica primeiro: as pastas com kit dependem deles.
  await Promise.all(BANK.map(async (def, i) => {
    try { defaultBuffers[i] = await renderOffline(def.dur, def.build); }
    catch (e) { console.warn('falha ao sintetizar', def.name, e); }
  }));

  folders = (await loadFolders()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!folders.length) {
    folders = [{ id: FIRST_FOLDER, name: 'Bateria', kit: 'drums', order: 0 }];
    await saveFolder(folders[0]);
  }

  const saved = localStorage.getItem('sp.folder');
  await openFolder(folders.some(f => f.id === saved) ? saved : folders[0].id);
  setStatus();

  await pedirPersistencia();
  avaliarRiscoDePerda();
}

boot();
