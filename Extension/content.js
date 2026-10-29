// Injected by the popup only when it opens (no content_scripts in the manifest).
// Registers nothing but a message listener: no key handlers, no media events,
// no per-frame callbacks left running, so an idle page costs nothing.
(() => {
  if (window.__ytshotLoaded) return;
  window.__ytshotLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;

  // ---------- video lookup ----------

  function allVideos() {
    const videos = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'VIDEO') videos.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return videos;
  }

  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }

  // The largest visible video with known dimensions; playing ones win ties.
  // readyState 1 still counts: mid-seek (frame stepping) a video drops to HAVE_METADATA.
  function pickVideo() {
    let best = null;
    let bestScore = -1;
    for (const v of allVideos()) {
      if (v.readyState < 1 || !v.videoWidth || !v.videoHeight) continue;
      const score = visibleArea(v) * 2 + (v.paused ? 0 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  function seeked(video) {
    if (!video.seeking) return Promise.resolve();
    return new Promise((r) => {
      video.addEventListener('seeked', r, { once: true });
      setTimeout(r, 1500);
    });
  }

  // ---------- frame grabbing ----------

  // Draws the frame currently shown by the decoder at the stream's native size
  // (videoWidth x videoHeight), not the size of the element on the page.
  function grabFrame(video) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(video, 0, 0, w, h);
    // Throws SecurityError right away if the frame is cross-origin / protected.
    ctx.getImageData(0, 0, 1, 1);
    return canvas;
  }

  // PNG is lossless, so the pixels are exactly what the decoder produced.
  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('empty blob'))), 'image/png');
      } catch (e) {
        reject(e);
      }
    });
  }

  function formatTime(t) {
    if (!isFinite(t)) t = 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return `${h ? h + '-' : ''}${pad(m)}-${pad(s)}.${pad(ms, 3)}`;
  }

  function pageTitle() {
    let title = (document.title || location.hostname)
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*-\s*YouTube$/, '');
    return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
  }

  function fileName(video) {
    return `${pageTitle()} [${formatTime(frameStart(video))}] ${video.videoWidth}x${video.videoHeight}.png`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function describeError(e) {
    if (e && e.name === 'SecurityError') {
      return 'Сайт запрещает читать кадры этого видео (защита DRM или чужой домен).';
    }
    return 'Не удалось получить кадр: ' + (e?.message || e);
  }

  async function save(video) {
    try {
      await seeked(video);
      const canvas = grabFrame(video);
      download(await canvasToPng(canvas), fileName(video));
      return { ok: true, text: `Кадр ${canvas.width}×${canvas.height} сохранён` };
    } catch (e) {
      return { ok: false, text: describeError(e) };
    }
  }

  // For "copy": the popup owns the click, so it writes the clipboard itself
  // and only needs the encoded frame from the page.
  async function frameAsPng(video) {
    try {
      await seeked(video);
      const canvas = grabFrame(video);
      return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    } catch (e) {
      return { error: describeError(e) };
    }
  }

  // ---------- frame stepping ----------

  // Per video: frame duration, where the frame grid starts, last step target.
  const timing = new WeakMap();

  function timingFor(video) {
    let t = timing.get(video);
    // Players like YouTube reuse one <video> for the next clip (new blob URL).
    if (!t || t.src !== video.currentSrc) {
      t = { src: video.currentSrc, dur: 0, offset: 0, ready: null, stepBase: null, stepTime: null };
      timing.set(video, t);
    }
    return t;
  }

  // Dropped frames only make gaps longer, so a low percentile of the gaps
  // is the real frame duration even when playback stutters.
  function lowPercentile(values) {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.25)];
  }

  // Measures the frame rate once per clip, only when the user steps: lets a
  // paused video run muted for ~10 frames, reads exact frame timestamps from
  // requestVideoFrameCallback, then puts it back where it was.
  async function measure(video) {
    if (!video.requestVideoFrameCallback) return null;
    const startTime = video.currentTime;
    const wasPaused = video.paused;
    const wasMuted = video.muted;

    const stamps = [];
    let stop = false;
    const collected = new Promise((resolve) => {
      const onFrame = (_now, meta) => {
        if (stop) return;
        stamps.push(meta.mediaTime);
        if (stamps.length >= 10) resolve();
        else video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      setTimeout(resolve, 800);
    });

    if (wasPaused) {
      video.muted = true;
      try {
        await video.play();
      } catch {
        stop = true;
        video.muted = wasMuted;
        return null;
      }
    }
    await collected;
    stop = true;
    if (wasPaused) {
      video.pause();
      video.muted = wasMuted;
      video.currentTime = startTime;
      await seeked(video);
    }

    const gaps = [];
    for (let i = 1; i < stamps.length; i++) {
      const d = stamps[i] - stamps[i - 1];
      if (d > 0.002 && d < 0.2) gaps.push(d);
    }
    if (gaps.length < 3) return null;
    const dur = lowPercentile(gaps);
    const last = stamps[stamps.length - 1];
    return { dur, offset: last - Math.floor(last / dur) * dur };
  }

  // Start time of the frame on screen.
  function frameStart(video) {
    const t = timing.get(video);
    if (t && t.stepTime != null && Math.abs(video.currentTime - t.stepTime) < 1e-3) return t.stepBase;
    if (t && t.dur) return t.offset + Math.floor((video.currentTime - t.offset) / t.dur + 1e-3) * t.dur;
    return video.currentTime;
  }

  async function stepFrame(video, dir) {
    const t = timingFor(video);
    t.ready ??= measure(video).then((m) => m && Object.assign(t, m));
    await t.ready;
    if (!video.paused) video.pause();

    const dur = t.dur || 1 / 30;
    const base = frameStart(video);
    const end = isFinite(video.duration) ? video.duration : Infinity;
    const target = Math.min(Math.max(base + dir * dur, 0), Math.max(end - dur, 0));
    // Seek into the middle of the target frame so the decoder can't land on a neighbour.
    video.currentTime = target + dur / 2;
    t.stepBase = target;
    t.stepTime = video.currentTime;
    return { fps: t.dur ? Math.round(100 / t.dur) / 100 : null };
  }

  // ---------- messages from the popup ----------

  // The popup broadcasts to every frame of the tab (Safari's per-frame targeting
  // is unreliable). Only a frame with a video answers; returning undefined
  // leaves the reply to another frame. `token` pins follow-up commands to the
  // frame that answered ytshot-info.
  const token = Math.random().toString(36).slice(2);

  api.runtime.onMessage.addListener((msg) => {
    if (typeof msg?.type !== 'string' || !msg.type.startsWith('ytshot-')) return;
    if (msg.token && msg.token !== token) return;
    const video = pickVideo();
    if (!video) return;

    switch (msg.type) {
      case 'ytshot-info':
        return Promise.resolve({ token });
      case 'ytshot-step':
        return stepFrame(video, msg.dir);
      case 'ytshot-save':
        return save(video);
      case 'ytshot-png':
        return frameAsPng(video);
    }
  });
})();
