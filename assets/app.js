'use strict';
/* ==========================================================
   紫藤巷 · 绝望主妇台词本 — 听力练习版
   ========================================================== */
(function () {
  const META = window.DH_META || { episodes: [], stats: {} };

  /* meta.js 万一没加载成功（CDN 抖动），用已加载的剧集数据兜底重建目录 */
  function ensureMeta() {
    if (META.episodes && META.episodes.length) return;
    const DH = window.DH || {};
    const ids = ['e01', 'e02', 'e03', 'e04', 'e05'].filter(id => DH[id]);
    META.episodes = ids.map(id => ({
      id, title: DH[id].title,
      parts: DH[id].parts.map(p => ({ id: p.id, title: p.title, n: p.lines.length }))
    }));
    META.stats = {
      episodes: ids.length,
      parts: META.episodes.reduce((a, e) => a + e.parts.length, 0),
      lines: META.episodes.reduce((a, e) => a + e.parts.reduce((x, p) => x + p.n, 0), 0),
      speakers: []
    };
  }
  const SEARCH = window.DH_SEARCH || [];
  const $ = (s, r = document) => r.querySelector(s);

  const view = $('#view');
  const player = $('#player');
  const pbar = $('#pbar'), pfill = $('#pfill'), pknob = $('#pknob');
  const pTitle = $('#pTitle'), pTime = $('#pTime');
  const icoPlay = $('#icoPlay'), icoPause = $('#icoPause');
  const modal = $('#modal'), searchInput = $('#searchInput'), searchResults = $('#searchResults');

  /* ---------------- 存储 ---------------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('dh.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('dh.' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ---------------- 状态 ---------------- */
  const S = {
    epId: null, partId: null, part: null, lines: [], queue: [],
    idx: 0,
    mode: LS.get('mode', 'part') === 'sent' ? 'sent' : 'part',   // part = 整段, sent = 逐句
    rate: LS.get('rate', 1),          // 全局默认倍速
    lineRate: {},                     // 每句单独的倍速
    lineLoop: new Set(),              // 循环播放的句子
    autoNext: LS.get('autoNext', false),  // 连播（默认关）
    loop: LS.get('loop', false),      // 整段循环
    textShown: false, revealed: new Set(), marksOpen: new Set(),
    checked: LS.get('checked', {}), done: LS.get('done', {}),
    playing: false, pendingReveal: null
  };
  const RATES = [0.5, 0.8, 1, 1.25];

  /* ---------------- 工具 ---------------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = t => {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ':' + String(sec).padStart(2, '0');
  };
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

  const ICON_PLAY = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const ICON_PAUSE = '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.2"/></svg>';
  const ICON_LOOP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
  const ICON_CHECK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  const SP_COLOR = {
    Alice: '#a97d3f', Susan: '#705196', Bree: '#4f7a5c', Lynette: '#3f6b8a',
    Gabrielle: '#b8615a', Mike: '#7a5b47', Carlos: '#8a6a3f', Rex: '#5a7080',
    Tom: '#4a6f6a', John: '#8a5f7a', Julie: '#7a6a9a', Eddie: '#8a6f5a', Huber: '#8f7f52'
  };

  const epData = id => (window.DH || {})[id];
  const srcOf = (epId, name) => 'audios/' + epId + '/' + name + '.mp3';
  const partKey = () => S.epId + '/' + S.partId;
  const epTitle = id => { const e = META.episodes.find(x => x.id === id); return e ? e.title : id; };

  /* ---------------- 音频 ---------------- */
  const au = document.createElement('audio');
  au.id = 'au';
  au.preload = 'metadata';
  au.style.display = 'none';
  player.appendChild(au);
  if ('preservesPitch' in au) au.preservesPitch = true;
  if ('mozPreservesPitch' in au) au.mozPreservesPitch = true;

  const rateOf = id => (S.lineRate[id] != null ? S.lineRate[id] : S.rate);

  function applyRate() {
    const id = S.mode === 'sent' && S.lines[S.idx] ? S.lines[S.idx].id : null;
    const r = id ? rateOf(id) : S.rate;
    try { au.playbackRate = r; } catch (e) { }
  }

  au.addEventListener('loadedmetadata', () => { applyRate(); tick(); });
  au.addEventListener('timeupdate', tick);
  au.addEventListener('play', () => setPlaying(true));
  au.addEventListener('pause', () => { setPlaying(false); savePos(); });
  au.addEventListener('ended', onEnded);
  au.addEventListener('error', () => {
    if (!au.getAttribute('src')) return;
    setPlaying(false);
    if (S.mode === 'sent') toast('该句暂无音频');
    else toast('音频加载失败，请检查文件是否完整');
  });

  function setPlaying(p) {
    S.playing = p;
    icoPlay.style.display = p ? 'none' : '';
    icoPause.style.display = p ? '' : 'none';
    syncAllCtl();
  }

  function stopAudio() {
    try { au.pause(); } catch (e) { }
    au.removeAttribute('src');
    au.load();
    setPlaying(false);
    setBar(0);
  }

  function firstPlayable() { return S.queue.length ? S.queue[0] : 0; }
  function nextPlayable(i) { const k = S.queue.indexOf(i); return k >= 0 && k + 1 < S.queue.length ? S.queue[k + 1] : null; }
  function prevPlayable(i) { const k = S.queue.indexOf(i); return k > 0 ? S.queue[k - 1] : null; }

  /* ---------------- 播放控制 ---------------- */
  function play() {
    if (!S.part) return;
    if (!au.getAttribute('src')) loadCurrent(false);
    const p = au.play();
    if (p && p.catch) p.catch(() => setPlaying(false));
  }
  function toggle() { if (S.playing) au.pause(); else play(); }

  function loadPartAudio(pos) {
    au.src = srcOf(S.epId, S.epId + S.partId + 's');
    applyRate();
    if (pos) { try { au.currentTime = pos; } catch (e) { } }
    updateTitle();
  }

  /* 标题：文本隐藏时不泄露台词 */
  function updateTitle() {
    if (!S.part) return;
    if (S.mode === 'part') {
      pTitle.textContent = epTitle(S.epId) + ' · 第 ' + S.partId.slice(-2) + ' 段 · 整段音频';
      return;
    }
    const l = S.lines[S.idx] || {};
    const k = Math.max(0, S.queue.indexOf(S.idx)) + 1;
    const reveal = S.textShown || (l.id && S.revealed.has(l.id));
    let t = (l.s || '旁白') + ' · 第 ' + k + '/' + S.queue.length + ' 句';
    if (reveal && l.t) t += ' · ' + l.t.slice(0, 26) + (l.t.length > 26 ? '…' : '');
    pTitle.textContent = t;
  }

  function loadCurrent(pos) {
    if (S.mode === 'part') loadPartAudio(pos);
    else loadLine(S.idx, pos);
  }

  function loadLine(i, pos) {
    const l = S.lines[i];
    if (!l || !l.r) return false;
    au.src = srcOf(S.epId, l.id);
    applyRate();
    if (pos) { try { au.currentTime = pos; } catch (e) { } }
    updateTitle();
    return true;
  }

  /* 播放某一句：只播这一句，绝不自动跳到下一句（除非显式开启连播） */
  function playLine(i, opts) {
    const l = S.lines[i];
    if (!l) return;
    if (!l.r) { toast('这一句是旁白，没有单独音频'); return; }
    if (S.mode !== 'sent') { S.mode = 'sent'; LS.set('mode', 'sent'); syncMode(); }
    S.idx = i;
    loadLine(i);
    applyRate();
    highlight(false);
    play();
    syncAllCtl(); syncSpeeds();
    if (opts && opts.scroll === false) return;
  }

  function playPart(from) {
    if (S.mode !== 'part') { S.mode = 'part'; LS.set('mode', 'part'); syncMode(); }
    loadPartAudio(from || 0);
    highlight(false);
    play();
    syncAllCtl();
  }

  function onEnded() {
    const cur = S.lines[S.idx];

    if (S.mode === 'part') {
      markDone();
      if (S.loop) { try { au.currentTime = 0; } catch (e) { } play(); return; }
      setPlaying(false);
      toast('本段听完 ✓ 可以揭开文本核对了');
      return;
    }

    // 逐句：这一句开了循环 → 原地重播
    if (cur && S.lineLoop.has(cur.id)) {
      try { au.currentTime = 0; } catch (e) { }
      play();
      return;
    }
    // 显式开启连播才往下走
    if (S.autoNext) {
      const n = nextPlayable(S.idx);
      if (n != null) { playLine(n); return; }
      markDone();
    }
    setPlaying(false);
  }

  function step(dir) {
    if (S.mode !== 'sent') {
      playLine(dir > 0 ? firstPlayable() : (S.queue[S.queue.length - 1] ?? 0));
      return;
    }
    const t = dir > 0 ? nextPlayable(S.idx) : prevPlayable(S.idx);
    if (t == null) { toast(dir > 0 ? '已是最后一句' : '已是第一句'); return; }
    playLine(t);
  }

  /* 全局倍速（播放条上的按钮）：作用于整段音频，或当前这一句 */
  function setRate(r) {
    S.rate = r; LS.set('rate', r);
    const id = S.mode === 'sent' && S.lines[S.idx] ? S.lines[S.idx].id : null;
    if (id) delete S.lineRate[id];   // 显式改全局时，覆盖掉当前这一句的单独设置
    applyRate(); syncSpeeds(); syncAllCtl();
    toast('倍速 ' + r + '×');
  }

  /* 某一句单独设倍速，并立即用这个速度播放这一句 */
  function setLineRate(i, r) {
    const l = S.lines[i];
    if (!l) return;
    S.lineRate[l.id] = r;
    if (S.mode === 'sent' && S.idx === i) { applyRate(); }
    syncAllCtl(); syncSpeeds();
    playLine(i);
    toast('这一句 ' + r + '×');
  }

  function toggleLineLoop(i) {
    const l = S.lines[i];
    if (!l) return;
    const on = !S.lineLoop.has(l.id);
    if (on) S.lineLoop.add(l.id); else S.lineLoop.delete(l.id);
    syncAllCtl();
    if (on) {
      if (!(S.mode === 'sent' && S.idx === i && S.playing)) playLine(i);
      toast('这一句循环播放，再点一次取消');
    } else {
      toast('已取消循环');
    }
  }

  /* ---------------- 进度条 ---------------- */
  let barP = 0;
  function setBar(p) {
    barP = Math.max(0, Math.min(1, p || 0));
    pfill.style.width = (barP * 100) + '%';
    pknob.style.left = (barP * 100) + '%';
  }
  function tick() {
    if (!S.part) return;
    const d = au.duration || 0, c = au.currentTime || 0;
    if (S.mode === 'part') {
      if (d) setBar(c / d);
      pTime.textContent = fmt(c) + ' / ' + fmt(d);
    } else {
      const total = S.queue.length || 1;
      const k = Math.max(0, S.queue.indexOf(S.idx));
      setBar(d ? c / d : 0);
      pTime.textContent = fmt(c) + ' / ' + fmt(d) + '　第 ' + (k + 1) + '/' + total + ' 句';
      if (S.playing) savePos();
    }
  }
  pbar.addEventListener('click', e => {
    const r = pbar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (S.mode === 'part') {
      if (au.duration) { try { au.currentTime = p * au.duration; } catch (err) { } tick(); }
    } else if (au.duration) {
      try { au.currentTime = p * au.duration; } catch (err) { }
      tick();
    }
  });

  /* ---------------- 进度记录 ---------------- */
  function markDone() {
    S.done[partKey()] = 1; LS.set('done', S.done);
    const c = document.querySelector('.part-card[data-key="' + partKey() + '"]');
    if (c) c.classList.add('is-done');
  }
  function savePos() {
    if (!S.part || S.mode !== 'part') return;
    const pos = au.currentTime || 0;
    if (pos < 1) return;
    const all = LS.get('pos', {});
    all[partKey()] = Math.round(pos);
    LS.set('pos', all);
    LS.set('last', { epId: S.epId, partId: S.partId, ts: Date.now() });
  }

  /* ---------------- 行内控件同步 ---------------- */
  function syncAllCtl() {
    const nodes = document.querySelectorAll('.line');
    for (let n = 0; n < nodes.length; n++) {
      const el = nodes[n];
      const i = +el.dataset.i;
      const l = S.lines[i];
      if (!l) continue;
      const cur = S.mode === 'sent' && S.idx === i;
      const playing = cur && S.playing;
      el.classList.toggle('active', cur);
      el.classList.toggle('tuned', (S.lineRate[l.id] != null) || S.lineLoop.has(l.id) || !!S.checked[l.id]);
      const rate = rateOf(l.id);
      const rs = el.querySelectorAll('.lc-rate');
      for (let r = 0; r < rs.length; r++) {
        rs[r].classList.toggle('on', parseFloat(rs[r].dataset.rate) === rate);
      }
      const lb = el.querySelector('.lc-loop');
      if (lb) lb.classList.toggle('on', S.lineLoop.has(l.id));
      const pb = el.querySelector('.lc-play');
      if (pb) {
        pb.classList.toggle('on', playing);
        pb.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
        pb.title = playing ? '暂停' : '只播这一句';
      }
      const cb = el.querySelector('.lc-check');
      if (cb) cb.classList.toggle('on', !!S.checked[l.id]);
    }
  }

  function highlight(scroll) {
    if (S.mode !== 'sent' || scroll === false) return;
    const el = document.querySelector('.line[data-i="' + S.idx + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 120) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---------------- 渲染：首页 ---------------- */
  function renderHome() {
    stopAudio(); player.classList.add('hidden');
    if (!META.episodes.length) {
      view.innerHTML = '<div class="wrap"><div class="empty">台本数据加载失败，请刷新页面重试。</div></div>';
      return;
    }
    S.epId = S.partId = null; S.part = null;

    const st = META.stats || {};
    const last = LS.get('last', null);
    let resume = '';
    if (last && epData(last.epId)) {
      const ep = epData(last.epId);
      const p = ep.parts.find(x => x.id === last.partId);
      if (p) {
        resume = '<a class="resume-card" href="#/' + last.epId + '/' + p.id + '">' +
          '<span class="resume-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>' +
          '<span class="resume-meta"><small>继续收听</small><strong>' + epTitle(last.epId) + ' · ' + esc(p.title) + '</strong></span>' +
          '<span class="tagchip">第 ' + p.id.slice(-2) + ' 段</span></a>';
      }
    }

    let blocks = '';
    META.episodes.forEach(ep => {
      const parts = ep.parts.map(p => {
        const done = S.done[ep.id + '/' + p.id];
        return '<a class="part-card' + (done ? ' is-done' : '') + '" data-key="' + ep.id + '/' + p.id + '" href="#/' + ep.id + '/' + p.id + '">' +
          '<span class="part-idx">' + p.id.slice(-2) + '</span>' +
          '<span class="part-card-body"><span class="part-title">' + esc(p.title) + '</span>' +
          '<span class="part-n">' + p.n + ' 句</span></span>' +
          (done ? '<span class="part-done">✓</span>' : '') +
          '</a>';
      }).join('');
      blocks += '<section class="ep-block" id="' + ep.id + '">' +
        '<div class="ep-head"><h2>' + ep.title + '</h2>' +
        '<span class="ep-sub">' + ep.parts.length + ' 段 · ' + ep.parts.reduce((a, b) => a + b.n, 0) + ' 句</span></div>' +
        '<div class="part-grid">' + parts + '</div></section>';
    });

    view.innerHTML =
      '<section class="hero wrap">' +
        '<div class="eyebrow">Season One · Script + Audio</div>' +
        '<h1>绝望主妇 · <em>第一季</em> 台词本</h1>' +
        '<p class="lede">先盲听，再对文本。台本默认隐藏，每句都可单独调 0.5× / 0.8× 倍速、单独循环；听得差不多了，再一句句揭开核对。</p>' +
        '<div class="stats">' +
          '<div class="stat"><b>' + (st.episodes || 5) + '</b><span>集 Episode</span></div>' +
          '<div class="stat"><b>' + (st.parts || 131) + '</b><span>段 Scene</span></div>' +
          '<div class="stat"><b>' + (st.lines || 1777) + '</b><span>句 Line</span></div>' +
          '<div class="stat"><b>' + ((st.speakers || []).length || 60) + '</b><span>角色 Role</span></div>' +
        '</div>' +
      '</section>' +
      '<div class="wrap">' + resume +
        '<div class="guide">' +
          '<div class="guide-step"><b>01</b><span>点开任意一段，<em>只听音频</em>，文本默认遮蔽</span></div>' +
          '<div class="guide-step"><b>02</b><span>每句右侧有 <em>0.5 / 0.8 / 1</em>、<em>循环</em>、<em>播放</em> 三个控件，可单句反复磨</span></div>' +
          '<div class="guide-step"><b>03</b><span>听完再点句子<em>揭开文本</em>，逐句核对、看备注</span></div>' +
        '</div>' +
        blocks +
        '<footer class="foot"><strong>Wisteria Lane · 听力练习版</strong><br>内容整理自《绝望主妇》第一季第 1–5 集台本与配套音频，仅用于个人语言学习。<br>快捷键：空格 播放 / 暂停 · ← → 上一句 / 下一句 · T 显示或隐藏文本 · 1 2 3 4 切换 0.5× · 0.8× · 1× · 1.25×</footer>' +
      '</div>';
    window.scrollTo(0, 0);
  }

  /* ---------------- 渲染：分集页 ---------------- */
  function renderEpisode(epId) {
    const ep = epData(epId);
    if (!ep) return renderHome();
    stopAudio(); player.classList.add('hidden');
    S.epId = S.partId = null; S.part = null;

    const parts = ep.parts.map(p => {
      const done = S.done[epId + '/' + p.id];
      return '<a class="part-card' + (done ? ' is-done' : '') + '" data-key="' + epId + '/' + p.id + '" href="#/' + epId + '/' + p.id + '">' +
        '<span class="part-idx">' + p.id.slice(-2) + '</span>' +
        '<span class="part-card-body"><span class="part-title">' + esc(p.title) + '</span>' +
        '<span class="part-n">' + p.lines.length + ' 句</span></span>' +
        (done ? '<span class="part-done">✓</span>' : '') + '</a>';
    }).join('');

    view.innerHTML = '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">首页</a><span class="sep">/</span><span>' + ep.title + '</span></div>' +
      '<div class="part-head"><h1>' + ep.title + '</h1>' +
      '<div class="part-meta-row"><span class="tagchip">' + ep.parts.length + ' 段</span>' +
      '<span class="tagchip plain">' + ep.parts.reduce((a, b) => a + b.lines.length, 0) + ' 句</span></div></div>' +
      '<div class="part-grid" style="padding-bottom:60px">' + parts + '</div></div>';
    window.scrollTo(0, 0);
  }

  /* ---------------- 渲染：台本页 ---------------- */
  function veilHtml(text) {
    const w = Math.max(2, Math.min(9, Math.round(text.trim().split(/\s+/).length / 2.4)));
    let bars = '';
    for (let i = 0; i < w; i++) bars += '<i style="width:' + (16 + (hash(text + i) % 24)) + 'px"></i>';
    return '<div class="veil" data-act="reveal" title="点击显示这一句"><span class="veil-lines">' + bars +
      '</span><span class="veil-hint">点击显示</span></div>';
  }

  function ctlHtml(l, i) {
    if (!l.r) return '<div class="lc lc-none">旁白无音频</div>';
    const rate = rateOf(l.id);
    const rbtn = r => '<button class="lc-btn lc-rate' + (rate === r ? ' on' : '') + '" data-act="lrate" data-rate="' + r + '" title="用 ' + r + '× 播放这一句">' + r + '</button>';
    return '<div class="lc">' +
      rbtn(0.5) + rbtn(0.8) + rbtn(1) +
      '<button class="lc-btn lc-loop' + (S.lineLoop.has(l.id) ? ' on' : '') + '" data-act="lloop" title="这一句循环播放">' + ICON_LOOP + '</button>' +
      '<button class="lc-btn lc-check' + (S.checked[l.id] ? ' on' : '') + '" data-act="check" title="标记已核对">' + ICON_CHECK + '</button>' +
      '<button class="lc-btn lc-play" data-act="lplay" title="只播这一句">' + ICON_PLAY + '</button>' +
      '</div>';
  }

  function lineHtml(l, i) {
    const revealed = S.textShown || S.revealed.has(l.id);
    const color = SP_COLOR[l.s] || '#564c63';
    const body = revealed
      ? '<p class="en-line" data-act="play">' + esc(l.t) + '</p>' +
        (l.m && l.m.length
          ? '<div class="mark-row"><button class="mark-btn" data-act="mark">备注 · ' + l.m.length + '</button>' +
            '<div class="mark-panel" ' + (S.marksOpen.has(l.id) ? '' : 'hidden') + '>' + l.m.map(x => '<p>' + esc(x) + '</p>').join('') + '</div></div>'
          : '')
      : veilHtml(l.t);
    const tuned = S.lineRate[l.id] != null || S.lineLoop.has(l.id) || !!S.checked[l.id];
    return '<div class="line' + (l.r ? '' : ' narr') + (tuned ? ' tuned' : '') + (S.mode === 'sent' && S.idx === i ? ' active' : '') + '" data-id="' + l.id + '" data-i="' + i + '">' +
      '<div class="sp"><span class="sp-name" style="color:' + color + '">' + esc(l.s || '旁白') + '</span></div>' +
      '<div class="line-body">' + body + '</div>' +
      ctlHtml(l, i) +
      '</div>';
  }

  function renderLines() {
    const box = $('#lines');
    if (!box) return;
    box.innerHTML = S.lines.map((l, i) => lineHtml(l, i)).join('');
    updateToolbar();
    syncAllCtl();
  }

  function updateToolbar() {
    const n = S.lines.filter(l => S.checked[l.id]).length;
    const cnt = $('#lineCount');
    if (cnt) {
      cnt.textContent = n
        ? n + ' / ' + S.lines.length + ' 句已核对'
        : S.lines.length + ' 句 · ' + (S.textShown ? '文本已展开' : '文本已隐藏');
    }
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
    const tg = $('#tgText');
    if (tg) {
      tg.classList.toggle('on', S.textShown);
      tg.innerHTML = S.textShown ? '<span class="ico">◉</span>隐藏文本' : '<span class="ico">◎</span>显示文本';
    }
    const bm = $('#tgMarks');
    if (bm) bm.classList.toggle('on', S.marksOpen.size > 0);
  }

  function renderPart(epId, partId) {
    const ep = epData(epId);
    if (!ep) return renderHome();
    const part = ep.parts.find(p => p.id === partId) || ep.parts[0];
    stopAudio();
    S.epId = epId; S.partId = part.id; S.part = part;
    S.lines = part.lines;
    S.idx = 0;
    S.revealed.clear(); S.textShown = false; S.marksOpen.clear();
    S.lineRate = {}; S.lineLoop = new Set();
    S.queue = S.lines.map((l, i) => i).filter(i => S.lines[i].r);
    S.idx = S.queue.length ? S.queue[0] : 0;

    const pIdx = ep.parts.findIndex(p => p.id === part.id);
    const prev = ep.parts[pIdx - 1], next = ep.parts[pIdx + 1];

    view.innerHTML = '<div class="wrap narrow">' +
      '<div class="crumbs"><a href="#/">首页</a><span class="sep">/</span><a href="#/' + epId + '">' + ep.title + '</a>' +
      '<span class="sep">/</span><span>' + part.id.slice(-2) + '</span></div>' +
      '<div class="part-head"><h1>' + esc(part.title) + '</h1>' +
      '<div class="part-meta-row"><span class="tagchip">' + ep.title + ' · 第 ' + part.id.slice(-2) + ' 段</span>' +
      '<span class="tagchip plain">' + part.lines.length + ' 句</span>' +
      '<span class="tagchip plain" id="lineCount">' + part.lines.length + ' 句 · 文本已隐藏</span></div></div>' +
      '<div class="toolbar">' +
        '<div class="tool-group"><button class="tool-btn" data-mode="part">整段听</button><button class="tool-btn" data-mode="sent">单句精听</button></div>' +
        '<div class="tool-group"><button class="tool-btn" id="tgText"></button></div>' +
        '<div class="tool-group"><button class="tool-btn" id="tgMarks">备注</button></div>' +
        '<span class="tool-spacer"></span>' +
        '<span class="tool-hint">每句右侧：0.5 / 0.8 / 1 倍速 · 循环 · 播放</span>' +
      '</div>' +
      '<div class="lines" id="lines"></div>' +
      '<div class="part-nav">' +
        (prev ? '<a href="#/' + epId + '/' + prev.id + '"><small>上一段</small>' + esc(prev.title) + '</a>' : '<span></span>') +
        (next ? '<a class="next" href="#/' + epId + '/' + next.id + '"><small>下一段</small>' + esc(next.title) + '</a>' : '<span></span>') +
      '</div>' +
      '</div>';

    renderLines();
    syncMode(); syncSpeeds();
    player.classList.remove('hidden');
    bindPart();
    const saved = (LS.get('pos', {})[partKey()] || 0);
    loadCurrent(S.mode === 'part' ? saved : 0);
    window.scrollTo(0, 0);
    LS.set('last', { epId: epId, partId: part.id, ts: Date.now() });

    if (S.pendingReveal) {
      const id = S.pendingReveal; S.pendingReveal = null;
      S.revealed.add(id);
      renderLines();
      const el = document.querySelector('.line[data-id="' + id + '"]');
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
    }
  }

  function bindPart() {
    const linesEl = $('#lines');
    linesEl.addEventListener('click', e => {
      const lineEl = e.target.closest('.line');
      if (!lineEl) return;
      const id = lineEl.dataset.id, i = +lineEl.dataset.i;
      const actEl = e.target.closest('[data-act]');
      const act = actEl ? actEl.dataset.act : null;
      const l = S.lines[i];

      if (act === 'reveal') { S.revealed.add(id); replaceLine(i); return; }

      if (act === 'lrate') {
        setLineRate(i, parseFloat(actEl.dataset.rate));
        return;
      }
      if (act === 'lloop') { toggleLineLoop(i); return; }
      if (act === 'lplay') {
        const cur = S.mode === 'sent' && S.idx === i;
        if (cur && S.playing) au.pause();
        else if (cur) play();
        else playLine(i);
        return;
      }
      if (act === 'check') {
        if (S.checked[id]) delete S.checked[id]; else S.checked[id] = 1;
        LS.set('checked', S.checked);
        syncAllCtl(); updateToolbar();
        return;
      }
      if (act === 'mark') {
        const panel = lineEl.querySelector('.mark-panel');
        if (!panel) return;
        const open = panel.hasAttribute('hidden');
        if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        if (open) S.marksOpen.add(id); else S.marksOpen.delete(id);
        return;
      }
      // 点到句子本身：隐藏 → 揭开；已显示 → 只播这一句
      if (!(S.textShown || S.revealed.has(id))) { S.revealed.add(id); replaceLine(i); }
      else if (l.r) playLine(i);
    });

    document.querySelectorAll('[data-mode]').forEach(b => {
      b.addEventListener('click', () => {
        const m = b.dataset.mode;
        if (m === S.mode) return;
        S.mode = m; LS.set('mode', m); syncMode(); syncAllCtl();
        if (m === 'part') { loadPartAudio(0); }
        else { S.idx = firstPlayable(); loadLine(S.idx); }
      });
    });
    $('#tgText').addEventListener('click', () => setText(!S.textShown));
    $('#tgMarks').addEventListener('click', () => {
      const open = S.marksOpen.size === 0;
      S.marksOpen.clear();
      if (open) S.lines.forEach(l => { if (l.m && l.m.length) S.marksOpen.add(l.id); });
      if (!S.textShown) S.textShown = true;
      renderLines();
    });
  }

  function replaceLine(i) {
    const el = document.querySelector('.line[data-i="' + i + '"]');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = lineHtml(S.lines[i], i);
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    syncAllCtl();
    updateTitle();
  }

  function setText(show) {
    S.textShown = show;
    if (!show) S.revealed.clear();
    renderLines();
    updateTitle();
  }

  function syncMode() {
    const bm = $('#btnMode');
    if (bm) bm.textContent = S.mode === 'part' ? '单句' : '整段';
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
    const bt = $('#btnText');
    if (bt) {
      bt.textContent = S.textShown ? '隐藏文本' : '显示文本';
      bt.classList.toggle('on', S.textShown);
    }
    const pt = $('#player');
    if (pt) pt.classList.toggle('mode-sent', S.mode === 'sent');
  }

  function syncSpeeds() {
    document.querySelectorAll('.speed-btn').forEach(b => {
      const r = parseFloat(b.dataset.rate);
      const cur = S.mode === 'sent' && S.lines[S.idx] ? rateOf(S.lines[S.idx].id) : S.rate;
      b.classList.toggle('on', r === cur);
    });
  }

  /* ---------------- 播放器按钮 ---------------- */
  $('#btnPlay').addEventListener('click', toggle);
  $('#btnPrev').addEventListener('click', () => step(-1));
  $('#btnNext').addEventListener('click', () => step(1));
  $('#btnAuto').addEventListener('click', () => {
    S.autoNext = !S.autoNext; LS.set('autoNext', S.autoNext);
    $('#btnAuto').classList.toggle('on', S.autoNext);
    toast(S.autoNext ? '已开启连播：一句播完自动下一句' : '已关闭连播：每句播完即停');
  });
  $('#btnLoop').addEventListener('click', () => {
    S.loop = !S.loop; LS.set('loop', S.loop);
    $('#btnLoop').classList.toggle('on', S.loop);
    toast(S.loop ? '整段循环已开启' : '整段循环已关闭');
  });
  $('#btnMode').addEventListener('click', () => {
    S.mode = S.mode === 'part' ? 'sent' : 'part';
    LS.set('mode', S.mode); syncMode(); syncAllCtl();
    if (S.mode === 'part') loadPartAudio(0);
    else { S.idx = firstPlayable(); loadLine(S.idx); highlight(); }
  });
  $('#btnText').addEventListener('click', () => setText(!S.textShown));
  document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', () => setRate(parseFloat(b.dataset.rate))));

  /* ---------------- 搜索 ---------------- */
  let sel = 0, results = [];
  function openSearch() {
    modal.classList.add('open');
    searchInput.value = '';
    renderResults('');
    setTimeout(() => searchInput.focus(), 60);
  }
  function closeSearch() { modal.classList.remove('open'); }
  function renderResults(q) {
    const query = q.trim().toLowerCase();
    results = !query ? SEARCH.slice(0, 18)
      : SEARCH.filter(x => x.t.toLowerCase().includes(query) || x.s.toLowerCase().includes(query)).slice(0, 60);
    sel = 0;
    if (!results.length) {
      searchResults.innerHTML = '<div class="search-empty">没有找到「' + esc(q) + '」</div>';
      return;
    }
    searchResults.innerHTML = results.map((r, i) => {
      let t = esc(r.t);
      if (query) {
        const idx = r.t.toLowerCase().indexOf(query);
        if (idx >= 0) {
          t = esc(r.t.slice(0, idx)) + '<mark>' + esc(r.t.slice(idx, idx + query.length)) + '</mark>' + esc(r.t.slice(idx + query.length));
        }
      }
      return '<button class="sr-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="sr-meta"><span class="sp-name" style="color:' + (SP_COLOR[r.s] || '#564c63') + '">' + esc(r.s || '旁白') + '</span>' +
        '<span>' + epTitle(r.e) + ' · 第 ' + r.p.slice(-2) + ' 段</span></span>' +
        '<span class="sr-text">' + t + '</span></button>';
    }).join('');
  }
  function choose(i) {
    const r = results[i];
    if (!r) return;
    closeSearch();
    S.pendingReveal = r.i;
    const target = '#/' + r.e + '/' + r.p;
    if (location.hash === target) renderPart(r.e, r.p); else location.hash = target;
  }
  $('#openSearch').addEventListener('click', openSearch);
  $('#closeSearch').addEventListener('click', closeSearch);
  modal.addEventListener('click', e => { if (e.target === modal) closeSearch(); });
  searchInput.addEventListener('input', e => renderResults(e.target.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  searchResults.addEventListener('click', e => {
    const b = e.target.closest('.sr-item');
    if (b) choose(+b.dataset.i);
  });
  function moveSel(d) {
    const items = searchResults.querySelectorAll('.sr-item');
    if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === sel));
    items[sel].scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- 键盘 ---------------- */
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape') { closeSearch(); return; }
    if (typing) return;
    if (!S.part) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key.toLowerCase() === 't') { e.preventDefault(); setText(!S.textShown); }
    else if (e.key.toLowerCase() === 'l') { e.preventDefault(); if (S.mode === 'sent') toggleLineLoop(S.idx); }
    else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); setRate(RATES[+e.key - 1]); }
  });

  /* ---------------- toast ---------------- */
  let toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1700);
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const seg = h.split('/').filter(Boolean);
    if (!seg.length) return renderHome();
    if (seg.length === 1) return renderEpisode(seg[0]);
    return renderPart(seg[0], seg[1]);
  }
  window.addEventListener('hashchange', route);

  /* ---------------- 初始化 ---------------- */
  function init() {
    ensureMeta();
    syncSpeeds();
    $('#btnAuto').classList.toggle('on', S.autoNext);
    $('#btnLoop').classList.toggle('on', S.loop);
    route();
  }
  init();

  window.addEventListener('beforeunload', savePos);
})();
