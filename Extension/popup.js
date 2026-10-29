// Everything happens while this popup is open: it injects content.js into the
// current tab on demand (activeTab), so nothing runs on pages in the background.
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const buttons = ['prev', 'next', 'save', 'copy'].map($);

let tabId = null;
let token = null; // identifies the frame that owns the video
let noteTimer = 0;

function note(text, sticky = false) {
  const el = $('note');
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noteTimer);
  if (text && !sticky) noteTimer = setTimeout(() => (el.hidden = true), 3500);
}

function setEnabled(on) {
  for (const b of buttons) b.disabled = !on;
}

// Broadcasts to every frame of the tab; only the frame with a video replies.
// Resolves null when nobody answers (some browsers reject, others never settle).
async function broadcast(msg, timeoutMs = 1500) {
  const timeout = new Promise((r) => setTimeout(() => r(null), timeoutMs));
  const reply = Promise.resolve(api.tabs.sendMessage(tabId, msg)).catch(() => null);
  return (await Promise.race([reply, timeout])) ?? null;
}

async function locate() {
  const info = await broadcast({ type: 'ytshot-info' });
  token = info?.token ?? null;
  setEnabled(!!token);
  return !!token;
}

// Sends to the video's frame. If that frame is gone (navigation, new player),
// finds the video again and retries once.
async function send(msg, timeoutMs) {
  let res = token ? await broadcast({ ...msg, token }, timeoutMs) : null;
  if (res == null && (await locate())) res = await broadcast({ ...msg, token }, timeoutMs);
  return res;
}

async function step(dir) {
  // The first step on a clip may briefly play it to measure the frame rate.
  const res = await send({ type: 'ytshot-step', dir }, 5000);
  if (!res) note('Видео не найдено');
  else if (!res.fps) note('Частоту кадров узнать не удалось, шаг 1/30 с');
}

async function save() {
  const res = await send({ type: 'ytshot-save' }, 20000);
  note(res ? res.text : 'Видео не найдено');
}

// Must start synchronously inside the click handler: the clipboard needs the
// user's gesture, so the PNG goes in as a promise.
function copy() {
  let size = '';
  const png = send({ type: 'ytshot-png' }, 20000).then(async (res) => {
    if (!res) throw new Error('Видео не найдено');
    if (res.error) throw new Error(res.error);
    size = `${res.width}×${res.height}`;
    return (await fetch(res.dataUrl)).blob();
  });
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': png })])
    .then(() => note(`Кадр ${size} скопирован`))
    .catch(async (e) => {
      // Prefer the page's own explanation (no video, DRM) over the generic clipboard error.
      const reason = await png.then(() => null, (err) => err.message);
      note(reason || 'Не удалось скопировать: ' + (e?.message || e));
    });
}

$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('save').addEventListener('click', save);
$('copy').addEventListener('click', copy);

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  if (tabId == null) return note('Нет активной вкладки', true);

  try {
    // Safe to repeat: content.js ignores a second injection.
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    return note('Нет доступа к этой странице', true);
  }
  if (!(await locate())) note('На странице нет видео', true);
}

init();
