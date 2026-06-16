/* 小说闯关 · 作家工坊
 * 多作品 / 关卡流水线 / 编辑器 / 公众号格式导出
 */
(() => {
  'use strict';

  // ===== 关卡定义 =====
  const CHAPTER_WORD_BASE = { warmup: 800, normal: 1500, advance: 2000, hardcore: 3000 };

  function buildLevels() {
    const levels = [];
    levels.push({
      id: 1, type: 'world', name: '第一关 · 世界观',
      sub: '热身 · 至少 200 字',
      goal: '描绘你的故事发生在怎样的世界:时代、地域、规则、氛围。',
      targets: [{ label: '字数门槛', value: 200, test: t => t.length >= 200 }],
    });
    levels.push({
      id: 2, type: 'character', name: '第二关 · 主角',
      sub: '引导 · 填写主角档案',
      goal: '用一段话写清主角的姓名、性格、背景、动机。',
      targets: [
        { label: '姓名', test: t => /姓名[:：]\s*\S+/.test(t) },
        { label: '性格', test: t => /性格[:：]\s*\S+/.test(t) },
        { label: '背景', test: t => /背景[:：]\s*\S+/.test(t) },
        { label: '动机', test: t => /动机[:：]\s*\S+/.test(t) },
      ],
    });
    levels.push({
      id: 3, type: 'outline', name: '第三关 · 三幕大纲',
      sub: '轻松 · 每幕至少 300 字',
      goal: '用三个段落分别写出开端 / 发展 / 高潮-结局。',
      targets: [
        { label: '开端', test: t => /开端[:：][\s\S]{30,}/.test(t) },
        { label: '发展', test: t => /发展[:：][\s\S]{30,}/.test(t) },
        { label: '高潮-结局', test: t => /(高潮|结局)[:：][\s\S]{30,}/.test(t) },
      ],
    });
    for (let i = 1; i <= 30; i++) {
      const lvlId = 3 + i;
      const isBoss = i % 10 === 0;
      const threshold = isBoss
        ? CHAPTER_WORD_BASE.hardcore * 2
        : i <= 3 ? CHAPTER_WORD_BASE.warmup
        : i <= 15 ? CHAPTER_WORD_BASE.normal
        : i <= 30 ? CHAPTER_WORD_BASE.advance
        : CHAPTER_WORD_BASE.hardcore;
      levels.push({
        id: lvlId,
        type: isBoss ? 'boss' : 'chapter',
        name: (isBoss ? '🔥 Boss 关' : ('第 ' + i + ' 章')) + ' · 第 ' + lvlId + ' 关',
        sub: (isBoss ? '硬核 · 双倍字数' : '章节创作') + ' · 至少 ' + threshold + ' 字',
        goal: isBoss
          ? '这是第 ' + i + ' 章的 Boss 关:字数要求翻倍,通过后获得稀有成就。'
          : '完成第 ' + i + ' 章正文,目标 ' + threshold + ' 字。',
        targets: [{ label: '字数门槛', value: threshold, test: t => t.length >= threshold }],
        chapterIndex: i,
      });
    }
    return levels;
  }

  const LEVELS = buildLevels();
  const STORAGE_KEY = 'novel-quest.v2';
  const LEGACY_KEY = 'novel-quest.v1';
  const STORAGE_LIMIT = 5 * 1024 * 1024;

  // ===== 状态 =====
  let state = loadState();
  if (!state) state = freshState();

  function uid(prefix) {
    return (prefix || 'w_') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function emptyLevels() {
    const levels = {};
    LEVELS.forEach((lvl, idx) => {
      levels[lvl.id] = { status: idx === 0 ? 'unlocked' : 'locked', content: '', paid: false, price: '', trialChars: 500 };
    });
    return levels;
  }

  function freshState() {
    const id = uid();
    return {
      activeWorkId: id,
      works: {
        [id]: {
          id, name: '我的第一本小说',
          createdAt: new Date().toISOString(),
          currentLevel: 1,
          levels: emptyLevels(),
          todoDone: {},
        },
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.works && parsed.activeWorkId) {
          Object.values(parsed.works).forEach(w => {
            LEVELS.forEach(lvl => {
              if (!w.levels[lvl.id]) w.levels[lvl.id] = { status: 'locked', content: '' };
              if (w.levels[lvl.id].paid === undefined) w.levels[lvl.id].paid = false;
              if (w.levels[lvl.id].price === undefined) w.levels[lvl.id].price = '';
              if (w.levels[lvl.id].trialChars === undefined) w.levels[lvl.id].trialChars = 500;
            });
            if (!w.todoDone) w.todoDone = {};
            if (!w.updatedAt) w.updatedAt = w.createdAt || new Date().toISOString();
          });
          return parsed;
        }
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const old = JSON.parse(legacy);
        const id = uid();
        const levels = emptyLevels();
        if (old.levels) {
          Object.keys(old.levels).forEach(k => { if (levels[k]) levels[k] = old.levels[k]; });
        }
        const migrated = {
          activeWorkId: id,
          works: {
            [id]: {
              id,
              name: (old.novelMeta && old.novelMeta.title) || '我的第一本小说',
              createdAt: (old.novelMeta && old.novelMeta.createdAt) || new Date().toISOString(),
              currentLevel: old.currentLevel || 1,
              levels,
              todoDone: {},
            },
          },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return null;
    } catch (e) { return null; }
  }

  function work() { return state.works[state.activeWorkId]; }
  function currentLevel() { return LEVELS.find(l => l.id === work().currentLevel); }

  // ===== 存档 =====
  let saveTimer = null;
  function scheduleSave() {
    setSaveIndicator('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const w = state.works[state.activeWorkId];
        if (w) w.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSaveIndicator('saved');
        updateStorage();
        updateWritingCalendar();
      } catch (e) { setSaveIndicator('error'); }
    }, 300);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    try {
      const w = state.works[state.activeWorkId];
      if (w) w.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveIndicator('saved');
      updateStorage();
      updateWritingCalendar();
      return true;
    } catch (e) { setSaveIndicator('error'); return false; }
  }

  function setSaveIndicator(kind) {
    const el = document.getElementById('save-indicator');
    const text = document.getElementById('save-text');
    el.classList.remove('saving', 'error');
    if (kind === 'saving') { el.classList.add('saving'); text.textContent = '保存中…'; }
    else if (kind === 'error') { el.classList.add('error'); text.textContent = '保存失败,点击重试'; }
    else { text.textContent = '已保存'; }
  }

  function updateStorage() {
    let used = 0;
    try { used = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size; }
    catch (e) { used = (localStorage.getItem(STORAGE_KEY) || '').length; }
    const pct = Math.min(100, (used / STORAGE_LIMIT) * 100);
    const bar = document.getElementById('storage-bar');
    bar.style.width = pct + '%';
    bar.style.background = pct > 95 ? 'var(--bad)' : pct > 80 ? 'var(--warn)' : 'var(--ok)';
    document.getElementById('storage-text').textContent =
      (used / 1024).toFixed(1) + ' KB / ' + (STORAGE_LIMIT / 1024 / 1024).toFixed(0) + ' MB';
  }

  // ===== 工具 =====
  function totalWordsOf(w) {
    let total = 0;
    LEVELS.forEach(l => { total += (w.levels[l.id] && w.levels[l.id].content || '').length; });
    return total;
  }
  function doneCountOf(w) {
    return LEVELS.filter(l => w.levels[l.id] && w.levels[l.id].status === 'done').length;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===== 写作日历 =====
  const CALENDAR_KEY = 'novel-quest.calendar';
  
  function updateWritingCalendar() {
    const w = work();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    
    // 获取或初始化日历数据
    let calendar = JSON.parse(localStorage.getItem(CALENDAR_KEY) || '{}');
    if (!calendar[w.id]) calendar[w.id] = {};
    
    // 记录今天的字数
    const todayData = calendar[w.id][today] || { words: 0, chapters: 0, todos: 0 };
    const todayWords = w.levels[w.currentLevel].content.length;
    todayData.words += todayWords;
    
    // 检测是否有新章节完成
    const currentLvl = currentLevel();
    const prevLvl = w.levels[currentLvl.id];
    if (prevLvl.status === 'done') {
      const yesterday = new Date(now.setDate(now.getDate() - 1)).toISOString().slice(0, 10);
      if (!calendar[w.id][yesterday]) calendar[w.id][yesterday] = { words: 0, chapters: 0, todos: 0 };
      calendar[w.id][yesterday].chapters += 1;
    }
    
    // 检测是否有新TODO完成
    const prevTodos = Object.keys(w.todoDone || {}).length;
    if (prevTodos > (calendar[w.id][today].todos || 0)) {
      todayData.todos = prevTodos - (calendar[w.id][today].todos || 0);
    }
    
    calendar[w.id][today] = todayData;
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(calendar));
    
    // 通知UI更新
    if (typeof window !== 'undefined' && window.__NQ__) {
      window.__NQ__.calendarUpdated && window.__NQ__.calendarUpdated(calendar, w.id);
    }
  }
  
  function getWritingCalendarData(workId) {
    const calendar = JSON.parse(localStorage.getItem(CALENDAR_KEY) || '{}');
    return calendar[workId] || {};
  }
  
  function getCalendarDays(workId, year, month) {
    const data = getWritingCalendarData(workId);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    
    const days = [];
    // 添加本月之前的空白
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // 添加当月的每一天
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        day: day,
        ...data[dateStr] || { words: 0, chapters: 0, todos: 0 }
      });
    }
    
    return days;
  }
  
  function getCalendarIntensity(words) {
    if (words >= 800) return 4;
    if (words >= 400) return 3;
    if (words >= 200) return 2;
    if (words > 0) return 1;
    return 0;
  }

  // ===== 渲染 =====
  function renderWorkSwitcher() {
    const btn = document.getElementById('work-switcher');
    btn.querySelector('.work-name').textContent = work().name;
    const menu = document.getElementById('work-menu');
    menu.innerHTML = '';
    Object.values(state.works)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach(w => {
        const item = document.createElement('div');
        item.className = 'work-item' + (w.id === state.activeWorkId ? ' active' : '');
        const words = totalWordsOf(w);
        item.innerHTML =
          '<div class="work-item-main">' +
            '<div class="work-item-name">' + escapeHtml(w.name) + '</div>' +
            '<div class="work-item-sub">' + words.toLocaleString() + ' 字 · ' + doneCountOf(w) + '/' + LEVELS.length + ' 关</div>' +
          '</div>' +
          '<div class="work-item-check">' + (w.id === state.activeWorkId ? '✓' : '') + '</div>';
        item.addEventListener('click', () => { switchWork(w.id); closeWorkMenu(); });
        menu.appendChild(item);
      });
  }

  function openWorkMenu() { document.getElementById('work-menu').classList.add('open'); }
  function closeWorkMenu() { document.getElementById('work-menu').classList.remove('open'); }
  function toggleWorkMenu() {
    const m = document.getElementById('work-menu');
    m.classList.contains('open') ? closeWorkMenu() : openWorkMenu();
  }

  function switchWork(id) {
    if (!state.works[id] || id === state.activeWorkId) return;
    state.activeWorkId = id;
    scheduleSave();
    render();
  }

  function createWork(name) {
    const id = uid();
    state.works[id] = {
      id, name: name || '未命名作品',
      createdAt: new Date().toISOString(),
      currentLevel: 1,
      levels: emptyLevels(),
    };
    state.activeWorkId = id;
    scheduleSave();
    render();
  }

  function renameWork(id) {
    const w = state.works[id];
    if (!w) return;
    const next = prompt('重命名作品', w.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    w.name = trimmed;
    scheduleSave();
    render();
  }

  function deleteWork(id) {
    const w = state.works[id];
    if (!w) return;
    if (Object.keys(state.works).length === 1) { alert('至少需要保留一部作品。'); return; }
    if (!confirm('确定删除《' + w.name + '》?此操作不可撤销。')) return;
    delete state.works[id];
    if (state.activeWorkId === id) state.activeWorkId = Object.keys(state.works)[0];
    scheduleSave();
    render();
  }

  // 关卡分组定义
  const LEVEL_GROUPS = [
    { id: 'setup', name: '设定', from: 1, to: 3 },
    { id: 'vol1', name: '第一卷 · 第 1-10 章', from: 4, to: 13 },
    { id: 'vol2', name: '第二卷 · 第 11-20 章', from: 14, to: 23 },
    { id: 'vol3', name: '第三卷 · 第 21-30 章', from: 24, to: 33 },
  ];

  // 获取 / 持久化折叠状态
  const GROUP_STATE_KEY = 'novel-quest.group-state';
  function getGroupState() {
    try { return JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setGroupState(s) {
    try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function isGroupCollapsed(groupId) {
    const s = getGroupState();
    return !!s[groupId];
  }
  function toggleGroup(groupId) {
    const s = getGroupState();
    s[groupId] = !s[groupId];
    setGroupState(s);
    renderSidebar();
  }
  function expandAllGroups() {
    setGroupState({});
    renderSidebar();
  }
  function collapseAllGroups() {
    const s = {};
    LEVEL_GROUPS.forEach(g => { s[g.id] = true; });
    setGroupState(s);
    renderSidebar();
  }

  function isLevelDone(w, lvl) {
    const st = w.levels[lvl.id];
    if (!st) return false;
    return st.status === 'done';
  }

  function renderSidebar() {
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    const w = work();

    // 顶部工具栏:全部展开 / 全部折叠
    const toolbar = document.createElement('div');
    toolbar.className = 'level-list-toolbar';
    toolbar.innerHTML =
      '<button id="btn-expand-all" title="展开所有分组">▾ 全部展开</button>' +
      '<button id="btn-collapse-all" title="折叠所有分组">▸ 全部折叠</button>';
    list.appendChild(toolbar);

    LEVEL_GROUPS.forEach(group => {
      const groupEl = document.createElement('div');
      const collapsed = isGroupCollapsed(group.id);
      groupEl.className = 'level-group' + (collapsed ? ' collapsed' : '');

      // 计算本组统计
      const groupLevels = LEVELS.filter(l => l.id >= group.from && l.id <= group.to);
      const total = groupLevels.length;
      const done = groupLevels.filter(l => isLevelDone(w, l)).length;
      const hasCurrent = groupLevels.some(l => l.id === w.currentLevel);

      // 分组头
      const head = document.createElement('div');
      head.className = 'level-group-head';
      const countClass = done === total ? 'all-done' : (hasCurrent ? 'has-current' : '');
      head.innerHTML =
        '<span class="caret">▾</span>' +
        '<span class="label">' + group.name + '</span>' +
        '<span class="count ' + countClass + '">' + done + '/' + total + '</span>';
      head.addEventListener('click', () => toggleGroup(group.id));
      groupEl.appendChild(head);

      // 分组体
      const body = document.createElement('div');
      body.className = 'level-group-body';
      groupLevels.forEach(lvl => {
        const st = w.levels[lvl.id];
        const item = document.createElement('div');
        item.className = 'level' +
          (lvl.id === w.currentLevel ? ' active' : '') +
          (st.status === 'locked' ? ' locked' : '') +
          (st.status === 'done' ? ' done' : '') +
          (lvl.type === 'boss' ? ' boss' : '') +
          (st.paid ? ' paid' : '');
        const paidBadge = st.paid
          ? '<span class="paid-badge" title="付费章节">💰</span>'
          : '';
        const priceText = (st.paid && st.price) ? ' · ¥' + st.price : '';
        item.innerHTML =
          '<div class="badge">' + (st.status === 'done' ? '✓' : lvl.id) + '</div>' +
          '<div class="meta">' +
            '<div class="name">' + escapeHtml(lvl.name) + paidBadge + '</div>' +
            '<div class="sub">' + escapeHtml(lvl.sub) + priceText + '</div>' +
          '</div>';
        item.addEventListener('click', () => { if (st.status !== 'locked') switchLevel(lvl.id); });
        body.appendChild(item);
      });
      groupEl.appendChild(body);

      list.appendChild(groupEl);
    });

    // 工具栏按钮事件
    document.getElementById('btn-expand-all').addEventListener('click', expandAllGroups);
    document.getElementById('btn-collapse-all').addEventListener('click', collapseAllGroups);

    const footer = document.getElementById('level-footer');
    footer.innerHTML =
      '<button class="side-btn" id="btn-rename-work">✎ 重命名作品</button>' +
      '<button class="side-btn danger" id="btn-delete-work">🗑 删除当前作品</button>';
    document.getElementById('btn-rename-work').addEventListener('click', () => renameWork(state.activeWorkId));
    document.getElementById('btn-delete-work').addEventListener('click', () => deleteWork(state.activeWorkId));

    document.getElementById('level-total').textContent = LEVELS.length;

    // 自动滚动到当前关卡
    requestAnimationFrame(() => {
      const active = list.querySelector('.level.active');
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function renderHeader() {
    const lvl = currentLevel();
    document.getElementById('crumb-name').textContent = lvl.name;
    const w = work();
    const done = doneCountOf(w);
    const pct = Math.round((done / LEVELS.length) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-label').textContent = pct + '%';
    document.querySelector('#work-switcher .work-name').textContent = w.name;
  }


  // ===== TODO 系统 =====
  const TODO_RE = /\[TODO:([^\]]*)\]/g;

  function scanWorkTodos(w) {
    const list = [];
    LEVELS.forEach(lvl => {
      const st = w.levels[lvl.id];
      if (!st || !st.content) return;
      const matches = [...st.content.matchAll(TODO_RE)];
      matches.forEach(m => {
        const offset = m.index;
        const key = lvl.id + ':' + offset;
        list.push({
          key,
          levelId: lvl.id,
          levelName: lvl.name,
          offset,
          text: m[1].trim() || '(未填写)',
          done: !!(w.todoDone && w.todoDone[key]),
        });
      });
    });
    return list;
  }

  function renderTodoPanel() {
    const w = work();
    const list = scanWorkTodos(w);
    const sideCount = document.getElementById('todo-side-count');
    sideCount.textContent = list.filter(t => !t.done).length;
    const ul = document.getElementById('todo-list');
    ul.innerHTML = '';
    if (list.length === 0) {
      ul.innerHTML = '<div class="todo-empty" style="font-size:12px;color:var(--muted);padding:8px 10px;">还没有 TODO。写作时输入 <code>[TODO: 描述]</code> 即可添加。</div>';
    } else {
      list.forEach(t => {
        const div = document.createElement('div');
        div.className = 'todo-item' + (t.done ? ' done' : '');
        div.innerHTML =
          '<div class="todo-check"></div>' +
          '<div class="todo-body">' +
            '<div class="todo-text">' + escapeHtml(t.text) + '</div>' +
            '<div class="todo-meta">第 ' + lvlIdToChapterNum(t.levelId) + ' 章 · 位置 ' + t.offset + '</div>' +
          '</div>';
        div.addEventListener('click', (e) => {
          if (e.target.classList.contains('todo-check')) {
            toggleTodoDone(t.key);
    } else if (mode === 'polish') {
      systemPrompt = '你是一位极其克制的中文编辑。你的工作原则:\n' +
        '1. 能不改就不改,只在万不得已时才动一个字\n' +
        '2. 只改错别字和明显语病\n' +
        '3. 绝对不要改变原文风格、语气、用词习惯\n' +
        '4. 绝对不要加入任何你自己的表达\n' +
        '5. 输出与输入的相似度必须>95%\n' +
        '6. 直接输出润色后的内容';
    } else {
            jumpToTodo(t);
          }
        });
        ul.appendChild(div);
      });
    }
    // 顶部提醒
    const open = list.filter(t => !t.done).length;
    const stat = document.getElementById('todo-stat');
    const cnt = document.getElementById('todo-count');
    cnt.textContent = open;
    stat.classList.toggle('has-todo', open > 0);
  }

  function lvlIdToChapterNum(id) {
    if (id === 1) return '世界观';
    if (id === 2) return '主角';
    if (id === 3) return '大纲';
    const lvl = LEVELS.find(l => l.id === id);
    return lvl && lvl.chapterIndex ? lvl.chapterIndex : '?';
  }

  function toggleTodoDone(key) {
    const w = work();
    if (!w.todoDone) w.todoDone = {};
    if (w.todoDone[key]) delete w.todoDone[key];
    else w.todoDone[key] = true;
    scheduleSave();
    renderTodoPanel();
  }

  function jumpToTodo(t) {
    switchLevel(t.levelId);
    setTimeout(() => {
      const ta = document.getElementById('editor');
      ta.focus();
      const pos = t.offset;
      ta.setSelectionRange(pos, pos + ('[TODO:' + t.text + ']').length);
      ta.scrollTop = ta.scrollHeight * (pos / Math.max(1, ta.value.length));
    }, 100);
  }

  function toggleTodoPanel() {
    document.getElementById('todo-panel').classList.toggle('collapsed');
  }

    function renderGoal() {
    const lvl = currentLevel();
    const w = work();
    document.getElementById('goal-title').textContent = lvl.name;
    document.getElementById('goal-desc').textContent = lvl.goal;
    const targets = lvl.targets.map(t => {
      const ok = t.test(w.levels[lvl.id].content);
      return '<b style="color:' + (ok ? 'var(--ok)' : 'var(--muted)') + '">' + (ok ? '●' : '○') + '</b> ' +
        escapeHtml(t.label) + (t.value ? ' · ' + t.value + ' 字' : '');
    }).join(' &nbsp;·&nbsp; ');
    document.getElementById('goal-targets').innerHTML = targets || '';
  }

  function updateWritingFeedback() {
    const lvl = currentLevel();
    const w = work();
    const currentContent = w.levels[lvl.id].content || '';
    const currentWords = currentContent.length;
    const targetWords = lvl.targets[0]?.value || 200;
    
    // 更新字数进度显示
    document.getElementById('word-progress').textContent = `当前进度: ${currentWords} / ${targetWords}字`;
    
    // 计算进度百分比
    const progressPercent = Math.min(100, Math.round((currentWords / targetWords) * 100));
    document.getElementById('progress-fill').style.width = progressPercent + '%';
    document.getElementById('progress-percent').textContent = progressPercent + '%';
    
    // 根据进度状态设置不同的颜色
    const progressFill = document.getElementById('progress-fill');
    const feedbackText = document.getElementById('inspiration-hint');
    
    if (progressPercent === 0) {
      progressFill.style.background = 'var(--muted)';
      feedbackText.textContent = '💡 点击获取写作灵感';
    } else if (progressPercent < 50) {
      progressFill.style.background = 'linear-gradient(90deg, var(--accent), var(--accent-2))';
      feedbackText.textContent = `💡 还差${targetWords - currentWords}字即可完成`;
    } else if (progressPercent < 100) {
      progressFill.style.background = 'linear-gradient(90deg, var(--warn), var(--accent))';
      feedbackText.textContent = '💡 快要完成了，再努力一下！';
    } else {
      progressFill.style.background = 'linear-gradient(90deg, var(--ok), #10b981)';
      feedbackText.textContent = '💡 已完成当前关卡，点击继续下一关！';
    }
  }

  function renderEditor() {
    const lvl = currentLevel();
    const w = work();
    const ta = document.getElementById('editor');
    if (ta.value !== w.levels[lvl.id].content) ta.value = w.levels[lvl.id].content;
    ta.readOnly = w.levels[lvl.id].status === 'done';
    updateWordCount();
  }

  function updateWordCount() {
    const lvl = currentLevel();
    const w = work();
    const text = w.levels[lvl.id].content || '';
    document.getElementById('word-count').textContent = text.length;
    document.getElementById('total-words').textContent = totalWordsOf(w).toLocaleString();
  }

  function switchLevel(id) { work().currentLevel = id; scheduleSave(); render(); }

  function render() {
    renderWorkSwitcher();
    renderSidebar();
    renderHeader();
    renderGoal();
    renderEditor();
    updatePaidRow();
    renderTodoPanel();
    renderCalendar();
    updateWritingFeedback();
  }

  // ===== 通关 =====
  function tryComplete() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    const results = lvl.targets.map(function(t) {
      return { label: t.label, ok: t.test(st.content), value: t.value };
    });
    const allOk = results.every(function(r) { return r.ok; });
    if (!allOk) {
      var failList = results.filter(function(r) { return !r.ok; });
      var body = '<p style="margin:0 0 6px;color:var(--warn);">以下条件尚未满足：</p>';
      body += '<ul class="nq-target-list">';
      results.forEach(function(r) {
        body += '<li class="' + (r.ok ? 'nq-ok' : 'nq-fail') + '">' +
          '<span class="nq-target-icon">' + (r.ok ? '✅' : '❌') + '</span>' +
          '<span><b>' + r.label + '</b>' + (r.value ? ' · ' + r.value + '字' : '') +
          (r.ok ? ' — 已达成' : ' — 未达成') + '</span></li>';
      });
      body += '</ul>';
      // 对于三幕大纲,给出具体格式提示
      if (lvl.type === 'outline' && lvl.id === 3) {
        body += '<div class="nq-hint">💡 三幕大纲需要按以下格式书写（每段至少30字）：</div>';
        body += '<div class="nq-example">开端：\n这里写故事的开端部分...\n\n发展：\n这里写故事的发展部分...\n\n高潮-结局：\n这里写高潮和结局部分...</div>';
      }
      // 对于世界观/主角关卡
      if (lvl.type === 'worldview' || lvl.type === 'protagonist') {
        body += '<div class="nq-hint">💡 请确保内容达到字数要求，当前：' + (st.content || '').length + ' 字</div>';
      }
      nqDialog({
        title: '通关条件未满足', icon: '📋', size: 'md',
        body: body,
        buttons: [{ text: '知道了', class: 'nq-btn-primary' }]
      });
      return;
    }
    st.status = 'done';
    var next = LEVELS.find(function(l) { return l.id === lvl.id + 1; });
    if (next) {
      work().levels[next.id].status = 'unlocked';
      work().currentLevel = next.id;
    }
    scheduleSave();
    nqAlert('🎉 通关成功！', '恭喜完成「' + lvl.name + '」！' + (next ? '已解锁下一关。' : '全部关卡已完成！'), '🎉');
    render();
  }

  // ===== API Key 管理 =====
  function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  }

  function setApiKey(key) {
    if (key && key.trim()) {
      localStorage.setItem(API_KEY_STORAGE, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  }

  // ===== 自动降AI味设置 =====
  const AUTO_DEDAI_KEY = 'novel-quest.auto-dedai';
  function getAutoDedai() { return localStorage.getItem(AUTO_DEDAI_KEY) === 'true'; }
  function setAutoDedai(v) { localStorage.setItem(AUTO_DEDAI_KEY, v ? 'true' : 'false'); }

  // ===== AI 续写 (DeepSeek API) =====
  async function callAI(prompt, mode) {
    const apiKey = getApiKey();
    if (!apiKey) {
      return '⚠️ 未配置 API Key，请先点击右上角 ⚙️ 设置 DeepSeek API Key。';
    }

    let systemPrompt;
    if (mode === 'rewrite') {
      systemPrompt = '你是一个深夜赶稿到凌晨三点的网文作者。你刚喝完第三罐红牛,状态有点亢奋但思路清晰。你要改写用户给的文字。不要用任何总结/开头/结尾的格式词。\n\n' +
        '改写时要做到——\n' +
        '你不是在"改写",你是在重新讲一遍这个故事,用自己的话。\n\n' +
        '【最重要:你必须像一个真人】\n' +
        '真人写东西的时候:\n' +
        '- 会突然岔开话题说一句不相干的话,然后又绕回来\n' +
        '- 会用错词然后自己纠正:那个什么,就是说\n' +
        '- 会写着写着冒出一句内心吐槽\n' +
        '- 会把一件小事写得很细,重要的事反而一笔带过\n' +
        '- 会自相矛盾:上一句说"我不在乎",下一句又说"说不在意是假的"\n' +
        '- 会重复自己的口头禅,比如老是说"说真的"或者"怎么说呢"\n\n' +
        '【句式——必须极端不均匀】\n' +
        '- 至少3个句子只有一两个字,比如"操。""行。""完了。"\n' +
        '- 至少2个句子超过50字,中间用逗号不断连接,像说话一样不换气\n' +
        '- 连续三句话的长度差必须超过20字\n' +
        '- 偶尔来一个没有标点的流水账:我跟你说这事真的气死我了当时我整个人都傻了站在那里半天没动\n\n' +
        '【词汇——用最土最随便的说法】\n' +
        '- 禁止一切书面语:"然而"换成"可是","因此"换成"所以","尽管"换成"虽说"\n' +
        '- 用网络梗和口头禅:好家伙/真有你的/离谱/麻了/裂开/蚌埠住了/无语/绝绝子\n' +
        '- 加入身体感受:后背发凉/头皮发麻/手心出汗/胃里翻江倒海/嗓子眼发紧\n' +
        '- 加入时间的具体细节:周三下午/凌晨两点半/上周三/去年冬天\n' +
        '- 加入真实的品牌/地名:便利店/地铁站/出租屋/小区门口/公交站牌\n\n' +
        '【结构——故意写得乱】\n' +
        '- 段落之间不需要有逻辑过渡,想跳就跳\n' +
        '- 加入内心OS:写到一半突然来一句"等等,这么说好像也不对"\n' +
        '- 加入对读者的喊话:"你猜怎么着""你别说""我说真的"\n' +
        '- 段落长度极度不均:有的段落就一个字"操",有的段落占半页\n' +
        '- **绝对不要有错别字/乱码**!混乱是有节奏的混乱,不是打字失误的混乱\n' +
        '- **绝对不要用省略号"……"**!改用句号或换行\n\n' +
        '禁止出现:值得注意的是/不得不说/令人惊讶的是/综上所述/在当今社会/众所周知/不仅如此/与此同时/毋庸置疑/仿佛/宛如/犹如/似乎/总的来说/归根结底/由此可见\n\n' +
        '保留原文情节,只改写法。直接输出,不加任何说明。';
    } else if (mode === 'polish') {
      systemPrompt = '你是深夜赶稿的网文作者。用户写了一段初稿,你只做微调。保留95%原文。只改错别字和明显语病。不要加任何AI套话。直接输出。';
    } else {
      systemPrompt = '你是一个深夜赶稿到凌晨三点的网文作者,刚喝完第三罐红牛。续写规则:\n' +
        '1. 你不是在续写,你是在重新讲这个故事\n' +
        '2. 句子长度极端不均:有1-2字的碎片,有50+字的流水句\n' +
        '3. 加入内心吐槽/自相矛盾/突然岔开话题\n' +
        '4. 用最土的说法,网络梗/口头禅/具体品牌地名\n' +
        '5. 段落之间不用逻辑过渡,想跳就跳\n' +
        '6. 禁止:值得注意的是/不得不说/综上所述/仿佛/宛如/犹如\n' +
        '7. 保持原文风格,续写300-500字\n' +
        '8. 直接输出,不加前缀说明';
    }

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: mode === 'rewrite' ? 1.5 : mode === 'polish' ? 0.3 : 1.2,
          top_p: 0.95,
          max_tokens: 2048,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.error?.message || response.statusText;
        return '❌ API 调用失败 (' + response.status + '): ' + msg;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '（AI 未返回内容）';
    } catch (e) {
      return '❌ 网络请求失败: ' + (e.message || e);
    }
  }

  // ===== 9. 除 AI 味 / 降重模块 =====
  // 三层降 AI 味策略:本地后处理(无需 API) + AI 智能改写 + 本地启发式检测
  const AI_TICKS = [
    '值得注意的是', '不得不说', '令人惊讶的是', '令人深思', '让人不禁',
    '总的来说', '综上所述', '在当今社会', '在这个时代', '众所周知',
    '不仅如此', '不仅...而且', '既...又', '与此同时', '然而',
    '不仅...更', '毋庸置疑', '无可否认', '某种意义上', '从某种程度上',
    '不禁让人', '不禁感叹', '不禁想问', '作为一个', '身为一个',
    '归根结底', '一言以蔽之', '由此可见', '这表明', '这也意味着',
    '仿佛', '宛如', '犹如', '似乎', '好似', '俨然',
    '值得一提', '需要指出', '换言之', '不难发现', '显而易见',
    '事实上', '实际上', '从根本上说', '本质上', '从某种角度',
    '毋庸讳言', '不可否认', '不可忽视', '这无疑', '可以说',
    '无疑', '毫无疑问', '不言而喻', '由此可见', '正因如此',
    '正是如此', '由此可见一斑', '由此可见端倪', '从这个意义上',
    '在这个过程中', '在这个意义上', '在这个框架下', '在这个背景下',
    '一定程度上', '从一定程度上来说', '在一定程度上', '某种层面上',
    '值得注意的一点', '让人感到', '令人感到', '让人觉得',
  ];

  const AI_REPLACEMENTS = [
    [/值得注意的是[，,]?/g, ''],
    [/不得不[说说][，,]?/g, ''],
    [/令人惊讶的是[，,]?/g, ''],
    [/令人深思的是[，,]?/g, ''],
    [/让人不禁[^,。]*[，,]/g, ''],
    [/总的来说[，,]?/g, '说到底,'],
    [/综上所述[，,]?/g, ''],
    [/在当今社会[，,]?/g, '如今,'],
    [/众所周知[，,]?/g, ''],
    [/不仅如此[，,]?/g, '还有,'],
    [/与此同时[，,]?/g, '恰在此时,'],
    [/毋庸置疑[，,]?/g, ''],
    [/无可否认[，,]?/g, ''],
    [/某种意义上[，,]?/g, ''],
    [/从某种程度上[来说]?[，,]?/g, ''],
    [/不禁让人[^,。]*[，,]/g, ''],
    [/不禁感叹[^,。]*[，,]/g, ''],
    [/归根结底[，,]?/g, '说穿了,'],
    [/一言以蔽之[，,]?/g, ''],
    [/由此可见[，,]?/g, '看得出,'],
    [/这表明[，,]?/g, '这说明,'],
    [/这也意味着[，,]?/g, '换句话说,'],
    [/仿佛/g, '像是'],
    [/宛如/g, '像'],
    [/犹如/g, '像'],
    [/似乎/g, '好像'],
    [/好似/g, '像'],
    [/值得一提的是[，,]?/g, ''],
    [/需要指出的是[，,]?/g, ''],
    [/换言之[，,]?/g, '说白了,'],
    [/不难发现[，,]?/g, ''],
    [/显而易见[，,]?/g, ''],
    [/事实上[，,]?/g, '其实,'],
    [/实际上[，,]?/g, ''],
    [/本质上[，,]?/g, ''],
    [/毋庸讳言[，,]?/g, ''],
    [/不可否认[，,]?/g, ''],
    [/这无疑[，,]?/g, ''],
    [/毫无疑问[，,]?/g, ''],
    [/不言而喻[，,]?/g, ''],
    [/正因如此[，,]?/g, '所以,'],
    [/正是如此[，,]?/g, ''],
    [/在这个过程中[，,]?/g, ''],
    [/在这个意义上[，,]?/g, ''],
    [/在这个背景下[，,]?/g, ''],
    [/一定程度上[，,]?/g, ''],
    [/从一定程度上来说[，,]?/g, ''],
    [/在一定程度上[，,]?/g, ''],
    [/值得指出的是[，,]?/g, ''],
    [/让人感到[，,]?/g, ''],
    [/令人感到[，,]?/g, ''],
    [/作为一个[，,]?/g, ''],
    [/身为一个[，,]?/g, ''],
    [/不禁让人[^,。]*[，,]/g, ''],
    [/不禁想问[^,。]*[，,]/g, ''],
    [/从某种角度[来说]?[，,]?/g, ''],
    [/不可忽视的是[，,]?/g, ''],
    [/从这个意义上[来说]?[，,]?/g, ''],
  ];

  function postProcessText(text) {
    if (!text) return text;
    let out = text;
    AI_REPLACEMENTS.forEach(([re, rep]) => {
      out = out.replace(re, rep);
    });
    out = out
      .replace(/^[\s,。、]+/gm, '')
      .replace(/[,，]{2,}/g, '，')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/^[,，\s]+/gm, '');
    return out;
  }

  // 长句拆短:超过 60 字的句子,按";"或"、",""等拆成两句
  function splitLongSentences(text) {
    if (!text) return text;
    const sentences = text.split(/([。!?])/);
    const out = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const s = (sentences[i] || '').trim();
      const end = sentences[i + 1] || '';
      if (s.length > 60) {
        const parts = s.split(/([;,，；、])/);
        let buf = '';
        parts.forEach(p => {
          buf += p;
          if (buf.length > 30 && /[,，；;、]/.test(p)) {
            out.push(buf.trim());
            buf = '';
          }
        });
        if (buf.trim()) out.push(buf.trim());
        if (end) out[out.length - 1] += end;
      } else {
        if (s) out.push(s + end);
      }
    }
    return out.join('');
  }

  // 破折号清除:每400字最多1个破折号,过多的替换为句号
  // 破折号是AI最明显的特征,真人很少用
  function removeEmDashes(text) {
    if (!text) return text;
    const maxAllowed = Math.max(1, Math.floor(text.length / 400));
    const matches = text.match(/——/g);
    if (!matches || matches.length <= maxAllowed) return text;
    let count = 0;
    return text.replace(/——/g, function() {
      count++;
      if (count <= maxAllowed) return '——';
      return '。';
    });
  }

  // ===== 深度降重:人味模拟 =====

  // 口语化插入:在适当位置注入口语词/脏话/感叹
  function injectColloquial(text) {
    if (!text) return text;
    const markers = ['卧槽', '我去', '妈的', '操', '真特么', '这特么', '你说气不气人',
      '得了', '算了', '拉倒吧', '可拉倒吧', '行吧', '得嘞', '好家伙',
      '哎', '嗐', '害', '啧', '嗯？', '啊？', '哦', '嘶'];
    const sentences = text.split(/([。!?！？])/);
    let result = [];
    let inserted = 0;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s || /[。!?！？]/.test(s)) { result.push(s); continue; }
      // 每8-12句插入一个口语词,在句首或句尾
      if (inserted < 3 && s.length > 15 && Math.random() < 0.12 && i > 2) {
        const marker = markers[Math.floor(Math.random() * markers.length)];
        if (Math.random() < 0.5) {
          result.push(marker + '，' + s);
        } else {
          result.push(s + '——' + marker);
        }
        inserted++;
      } else {
        result.push(s);
      }
    }
    return result.join('');
  }

  // 句式打散:强制改变连续句子的开头词/长度
  function scrambleSentenceStarts(text) {
    if (!text) return text;
    const starts = ['我', '他', '她', '这', '那', '风', '光', '雨', '声音', '空气',
      '手', '眼', '脚', '天', '地', '墙', '门', '窗', '灯', '影子'];
    const sentences = text.split(/([。!?！？])/);
    let result = [];
    let lastStart = '';
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s || /[。!?！？]/.test(s)) { result.push(s); continue; }
      const trimmed = s.trim();
      if (trimmed.length < 5) { result.push(s); continue; }
      const firstChar = trimmed.charAt(0);
      // 如果连续两句以相同词开头,尝试替换
      if (firstChar === lastStart && Math.random() < 0.6) {
        const alt = starts.filter(x => x !== firstChar);
        const newStart = alt[Math.floor(Math.random() * alt.length)];
        result.push(newStart + trimmed.slice(1));
        lastStart = newStart;
      } else {
        lastStart = firstChar;
        result.push(s);
      }
    }
    return result.join('');
  }

  // 段落长度打散:合并短段或拆分长段
  function scrambleParagraphs(text) {
    if (!text) return text;
    const paras = text.split(/\n\n+/);
    if (paras.length < 3) return text;
    const out = [];
    let i = 0;
    while (i < paras.length) {
      const p = paras[i];
      // 如果连续3段都很短(<30字),合并前两段
      if (i + 2 < paras.length && p.length < 30 && paras[i+1].length < 30 && paras[i+2].length < 30) {
        out.push(p + paras[i+1]);
        i += 2;
      }
      // 如果一段特别长(>200字),尝试在中间断开
      else if (p.length > 200) {
        const mid = Math.floor(p.length / 2);
        const breakPoint = p.indexOf('，', mid);
        if (breakPoint > 0 && breakPoint < p.length - 10) {
          out.push(p.slice(0, breakPoint + 1));
          out.push(p.slice(breakPoint + 1));
        } else {
          out.push(p);
        }
        i++;
      } else {
        out.push(p);
        i++;
      }
    }
    return out.join('\n\n');
  }

  // 插入碎片短句:在长段中随机插入3-8字的极短句
  function injectFragments(text) {
    if (!text) return text;
    const fragments = ['完了。', '好家伙。', '就这？', '懂了。', '得了吧。', '算了。',
      '嗯。', '哦？', '啊这。', '离谱。', '行吧。', '真行。', '绝了。', '麻了。',
      '我去。', '不会吧。', '真的假的。', '不是。', '等等。', '算了算了。'];
    const sentences = text.split(/([。!?！？])/);
    let result = [];
    let count = 0;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s || /[。!?！？]/.test(s)) { result.push(s); continue; }
      result.push(s);
      // 每6-10句后,有概率插入一个碎片
      if (count > 0 && count % (6 + Math.floor(Math.random() * 5)) === 0 && Math.random() < 0.4) {
        const frag = fragments[Math.floor(Math.random() * fragments.length)];
        // 插入在句号后面
        if (result.length > 0 && /[。!?！？]$/.test(result[result.length - 1])) {
          result.push(frag);
        }
      }
      count++;
    }
    return result.join('');
  }

  // 检测 AI 味:返回 0-100 分(越高越像 AI, 0=完全像人写)
  function detectAiFlavor(text) {
    if (!text || text.length < 30) return { score: 0, signals: [] };
    const signals = [];
    let score = 0;

    // 1. AI 套话命中(朱雀重点检测)
    let hitCount = 0;
    AI_TICKS.forEach(t => { if (text.indexOf(t) >= 0) hitCount++; });
    if (hitCount > 0) {
      score += Math.min(45, hitCount * 10);
      signals.push('AI 套话 ×' + hitCount);
    }

    // 2. 句长变异系数(朱雀核心指标-burstiness)
    const sentences = text.split(/[。!?！？]/).filter(s => s.trim().length > 4);
    if (sentences.length >= 5) {
      const lens = sentences.map(s => s.length);
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      const variance = lens.reduce((s, l) => s + Math.pow(l - avg, 2), 0) / lens.length;
      const stddev = Math.sqrt(variance);
      const cv = stddev / avg;
      if (cv < 0.2) { score += 25; signals.push('句长极均匀(cv=' + cv.toFixed(2) + ')'); }
      else if (cv < 0.35) { score += 15; signals.push('句长偏均匀(cv=' + cv.toFixed(2) + ')'); }
      else if (cv >= 0.5) { score -= 5; } // 句长变异大=像人
    }

    // 3. 连续同结尾
    if (sentences.length >= 3) {
      const ends = sentences.slice(0, -1).map(s => {
        const m = s.trim().match(/([^\s,，。;；]+)$/);
        return m ? m[1] : '';
      });
      let sameEnd = 1, maxSame = 1;
      for (let i = 1; i < ends.length; i++) {
        if (ends[i] && ends[i] === ends[i - 1]) { sameEnd++; maxSame = Math.max(maxSame, sameEnd); }
        else sameEnd = 1;
      }
      if (maxSame >= 3) { score += 15; signals.push('连续 ' + maxSame + ' 句同结尾'); }
    }

    // 4. 段首词重复率(朱雀检测)
    const paras = text.split(/\n\n+/).filter(p => p.trim().length > 20);
    if (paras.length >= 3) {
      const firstChars = paras.map(p => p.trim().charAt(0));
      let maxRepeat = 1, curRepeat = 1;
      for (let i = 1; i < firstChars.length; i++) {
        if (firstChars[i] === firstChars[i-1]) { curRepeat++; maxRepeat = Math.max(maxRepeat, curRepeat); }
        else curRepeat = 1;
      }
      if (maxRepeat >= 3) { score += 12; signals.push('段首词重复 ' + maxRepeat + ' 次'); }
    }

    // 5. 感叹号/问号/口语词(AI缺少这些)
    const exclCount = (text.match(/[!！?？]/g) || []).length;
    const oralCount = (text.match(/卧槽|我去|妈的|操|真特么|算了|得了|好家伙|哎|嗐|啧|说真的|怎么说呢|你猜怎么着|你别说/g) || []).length;
    const ratio = text.length / Math.max(1, exclCount + oralCount);
    if (ratio > 150 && text.length > 200) {
      score += 8;
      signals.push('缺口语/感叹');
    }

    // 6. 高频比喻词
    const metaphorCount = (text.match(/仿佛|宛如|犹如|似乎|好似|俨然/g) || []).length;
    if (metaphorCount > 3) {
      score += Math.min(15, metaphorCount * 3);
      signals.push('比喻词 ×' + metaphorCount);
    }

    // 7. 缺对话(网文必有对话)
    const dialogCount = (text.match(/["「『"][^"」』"]{2,}["」』"]/g) || []).length;
    if (dialogCount === 0 && text.length > 500) {
      score += 8;
      signals.push('缺对话');
    }

    // 8. 缺极短句(真人写作有碎片句)
    const shortSentences = sentences.filter(s => s.trim().length <= 8).length;
    if (shortSentences === 0 && sentences.length >= 10) {
      score += 10;
      signals.push('缺碎片短句');
    }

    // 9. 缺思维跳跃/内心OS(真人特征)
    const innerThoughts = (text.match(/等等|不对|算了|怎么说呢|你猜|你说|说真的|突然想到|我跟你说/g) || []).length;
    if (innerThoughts === 0 && text.length > 500) {
      score += 5;
      signals.push('缺内心OS');
    }

    // 10. 缺具体细节(真人会写具体时间/地点/数字)
    const specifics = (text.match(/\d+月|\d+号|\d+点|[便利店|超市|地铁|公交|出租|小区|便利店]/g) || []).length;
    if (specifics === 0 && text.length > 500) {
      score += 5;
      signals.push('缺具体细节');
    }

    // 11. 缺自相矛盾(真人写作特征)
    const contradictions = (text.match(/其实也不|不过话说回来|也不全对|算了当我没说|也不好说|看情况/g) || []).length;
    if (contradictions === 0 && text.length > 500) {
      score += 3;
      signals.push('缺自我纠正');
    }

    return { score: Math.min(100, Math.max(0, score)), signals };
  }

  function maxEndOrVar(n) { return n; }

  // 随机化打散 — 每次运行结果不同,避免固定模式被检测
  function randomScramble(text) {
    if (!text) return text;
    let out = text;
    const sentences = out.split(/([。!?！？])/);
    const result = [];
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s || /[。!?！？]/.test(s)) { result.push(s); continue; }
      let modified = s;
      // 1. 概率化替换:每个词有5%概率被替换为同义低频词
      modified = modified.replace(/[\u4e00-\u9fa5]{2,6}/g, match => {
        if (Math.random() < 0.05) {
          // 用同义但更口语/更罕见的表达
          const swaps = {
            '说道': ['嘟囔','嘀咕','嚷嚷','喊','吼','嘟囔着'][Math.floor(Math.random()*6)],
            '走了': ['溜了','蹿了','挪了','晃悠着走了','颠了'][Math.floor(Math.random()*5)],
            '看着': ['瞅着','瞄着','瞥着','盯着眼'][Math.floor(Math.random()*5)],
            '想了想': ['琢磨了一下','寻思半天','咂摸咂摸味儿','转了转念头'][Math.floor(Math.random()*4)],
            '点了点头': ['嗯了一声','鼻子哼了下','下巴颏动了动'][Math.floor(Math.random()*3)],
            '笑了': ['乐了','噗嗤一下','嘴角咧了咧','憋不住乐了'][Math.floor(Math.random()*5)],
            '转身': ['扭头','掉头','一拧身子','回过身'][Math.floor(Math.random()*4)],
            '站了起来': ['噌地站起来','屁股一抬站起来了','两腿一撑立了起来'][Math.floor(Math.random()*4)],
            '非常': ['贼','巨','特','老','相当'][Math.floor(Math.random()*5)],
            '突然': ['猛地','冷不丁','一下子','冷不防'][Math.floor(Math.random()*4)],
            '很快': ['没一会儿','转眼间','三下五除二','一溜烟'][Math.floor(Math.random()*4)],
            '慢慢': ['一点一点','磨磨蹭蹭地','慢悠悠','不紧不慢地'][Math.floor(Math.random()*4)],
            '终于': ['可算','好歹','好容易','总算'][Math.floor(Math.random()*4)],
            '立刻': ['马上','麻利地','撒腿就','二话不说'][Math.floor(Math.random()*4)],
            '好像': ['八成','估摸着','大概齐','差不离'][Math.floor(Math.random()*4)],
            '但是': ['可','不过','话又说回来','话说回来'][Math.floor(Math.random()*4)],
            '而且': ['还','再说','再加上','顺带一提'][Math.floor(Math.random()*4)],
            '因为': ['原因嘛','说白了是因为','就因为'][Math.floor(Math.random()*3)],
            '所以': ['这就导致','搞得','整得','弄了半天'][Math.floor(Math.random()*4)],
            '尽管': ['虽说','固然','别看','话是这么说'][Math.floor(Math.random()*4)],
            '于是': ['然后就','紧跟着','接下来就','干脆'][Math.floor(Math.random()*4)],
            '不过': ['话是这么说','话又说回来','可话说回来'][Math.floor(Math.random()*3)],
          };
          return swaps[match] || match;
        }
        return match;
      });
      // 2. 概率化加语气词:8%概率在句首/句中加
      if (Math.random() < 0.08 && modified.length > 10) {
        const fillers = ['说真的','你猜怎么着','我跟你说','讲道理','说实话','怎么说呢','哎我说','嘿'];
        const filler = fillers[Math.floor(Math.random() * fillers.length)];
        if (Math.random() < 0.5) {
          modified = filler + '，' + modified;
        } else {
          const pos = Math.floor(modified.length * 0.3 + Math.random() * modified.length * 0.4);
          modified = modified.slice(0, pos) + '——' + filler + '——' + modified.slice(pos);
        }
      }
      result.push(modified);
    }
    // 3. 概率化合并/拆分段落
    let text2 = result.join('');
    const paras = text2.split(/\n\n+/);
    if (paras.length > 3) {
      const out2 = [];
      for (let j = 0; j < paras.length; j++) {
        if (Math.random() < 0.1 && j > 0 && out2.length > 0) {
          out2[out2.length - 1] += paras[j]; // 20%概率合并到上一段
        } else {
          out2.push(paras[j]);
        }
      }
      text2 = out2.join('\n\n');
    }
    return text2;
  }

  // ===== 人味注入引擎:模拟真人写作的"不完美" =====
  // 朱雀检测的核心是困惑度+突发性+语义结构
  // 真人写作的特征:思维跳跃/自相矛盾/口语化/具体细节/碎片句/重复口头禅
  function humanChaos(text) {
    if (!text || text.length < 50) return text;
    let out = text;

    // 1. 插入思维跳跃:在段落间插入不相干的内心OS(降低激进度)
    const jumps = [
      '——等等,这么说好像也不对。', '——算了,接着说。',
      '——怎么说呢,就是那种感觉。', '——你懂的吧?',
      '——操,又跑题了。', '——哎不对,我刚说到哪了?',
      '——突然想到一个事。', '——算了不说了。',
      '——反正就那么回事。', '——你说这叫什么事。',
      '——行吧,继续。', '——啧,怎么说呢。',
    ];
    const paras = out.split(/\n\n+/);
    if (paras.length >= 3 && Math.random() < 0.3) {
      const jumpCount = 1; // 最多插入1个,避免过度
      for (let i = 0; i < jumpCount; i++) {
        const idx = Math.floor(Math.random() * (paras.length - 2)) + 1;
        if (paras[idx].length > 30) {
          const jump = jumps[Math.floor(Math.random() * jumps.length)];
          paras.splice(idx + 1, 0, jump);
        }
      }
      out = paras.join('\n\n');
    }

    // 2. 插入自相矛盾:真人写作经常自我纠正(降低激进度)
    const contradictions = [
      '其实也不全对,我后来想想。', '但话说回来,也不全是这样。',
      '算了,当我没说。', '不对不对,应该是这样。',
      '也不好说。', '看情况吧。',
    ];
    const sentences = out.split(/([。!?！？])/);
    if (sentences.length >= 8 && Math.random() < 0.15) {
      const idx = Math.floor(Math.random() * (sentences.length - 4)) + 2;
      const c = contradictions[Math.floor(Math.random() * contradictions.length)];
      // 在句号后插入矛盾句
      if (idx < sentences.length && /[。!?！？]/.test(sentences[idx])) {
        sentences.splice(idx + 1, 0, c);
      }
      out = sentences.join('');
    }

    // 3. 加入具体时间/地点/数字细节(降低激进度)
    const details = [
      '那天下午', '上周二', '凌晨两点多', '三月份的时候',
      '在便利店门口', '在地铁上', '出租屋里', '小区楼下',
      '花了三十多块', '等了快半小时', '走了大概十分钟',
      '那家店', '公交站牌那儿', '楼梯间',
    ];
    if (Math.random() < 0.15 && out.length > 200) {
      const detail = details[Math.floor(Math.random() * details.length)];
      const pos = Math.floor(Math.random() * out.length * 0.6) + out.length * 0.2;
      // 找到最近的句号插入
      const idx = out.indexOf('。', pos);
      if (idx > 0 && idx < out.length - 5) {
        out = out.slice(0, idx + 1) + detail + out.slice(idx + 1);
      }
    }

    // 4. 加入身体感受/物理细节(降低激进度)
    const sensations = [
      '后背一阵发凉', '手心全是汗', '嗓子干得冒烟',
      '胃里有点不舒服', '眼皮跳了两下', '脖子后面汗毛竖起来了',
      '手指头冰凉', '脚底板生疼', '脑袋嗡嗡的',
    ];
    if (Math.random() < 0.1 && out.length > 300) {
      const s = sensations[Math.floor(Math.random() * sensations.length)];
      const idx = out.indexOf('。', Math.floor(out.length * 0.3));
      if (idx > 0) {
        out = out.slice(0, idx + 1) + s + '。' + out.slice(idx + 1);
      }
    }

    // 5. 插入对读者的喊话/口语互动(降低激进度)
    const directAddress = [
      '你猜怎么着', '你别说', '我说真的', '你想想',
      '这事儿搁谁身上不急', '换你你受得了', '你说是不是',
    ];
    if (Math.random() < 0.1 && out.length > 300) {
      const d = directAddress[Math.floor(Math.random() * directAddress.length)];
      const pos = Math.floor(out.length * 0.5);
      const idx = out.indexOf('，', pos);
      if (idx > 0) {
        out = out.slice(0, idx + 1) + d + '，' + out.slice(idx + 1);
      }
    }

    // 6. 概率化重复一个词(模拟真人口头禅)(降低激进度)
    const tics = ['真的', '说真的', '怎么讲', '反正', '就那种', '说白了', '你知道吗'];
    if (Math.random() < 0.12) {
      const tic = tics[Math.floor(Math.random() * tics.length)];
      // 找到文中已经出现过的tic,再加一次
      if (out.indexOf(tic) >= 0) {
        const lastIdx = out.lastIndexOf('。');
        if (lastIdx > 0) {
          out = out.slice(0, lastIdx + 1) + tic + '，' + out.slice(lastIdx + 1);
        }
      }
    }

    // 7. 打乱段落内标点密度:有的地方不加标点像流水账(降低激进度)
    out = out.replace(/([，,][^，,。！！?？]{15,30})，/g, function(match) {
      if (Math.random() < 0.1) {
        return match.replace(/，/, '');
      }
      return match;
    });

    // 8. 格式规范化:确保符合小说平台格式
    // 合并连续空行
    out = out.replace(/\n{3,}/g, '\n\n');
    // 确保对话单独成段
    out = out.replace(/\n(["「『"].+?["」』"][。！？]?)\n/g, '\n\n$1\n\n');
    // 去除多余空格
    out = out.replace(/[ ]{2,}/g, ' ');

    return out;
  }

  // 一键除 AI 味(纯本地,无需 API) — 多轮深度降重
  function dedaiLocal(text) {
    if (!text) return text;
    let out = text;
    // 第一轮:套话替换+长句拆短
    out = postProcessText(out);
    out = splitLongSentences(out);
    // 第二轮:句式打散+段落重组
    out = scrambleSentenceStarts(out);
    out = scrambleParagraphs(out);
    // 第三轮:注入人味(口语化+碎片句)
    out = injectColloquial(out);
    out = injectFragments(out);
    // 第四轮:随机化打散(每次结果不同)
    out = randomScramble(out);
    // 第五轮:人味注入(思维跳跃+自相矛盾+具体细节)
    out = humanChaos(out);
    // 第六轮:清理格式
    out = out
      .replace(/[,，]{2,}/g, '，')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[\s,。、]+/gm, '')
      .replace(/^[,，\s]+/gm, '');
    return out;
  }

  // 智能改写(调 API) — 使用三轮协议
  async function dedaiAI(text) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }
    return await threeRoundProtocol(text);
  }

  // 翻译链降AI(调 API)
  async function dedaiTranslate(text) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }
    return await translationChain(text);
  }

  // 深度本地降重(无需API,参考 qu-ai-wei 51条规则)
  function dedaiDeepLocal(text) {
    if (!text) return text;
    let out = text;
    out = postProcessText(out);
    out = out.replace(/不由自主地/g, '鬼使神差地')
      .replace(/缓缓地/g, '慢吞吞地')
      .replace(/默默地/g, '闷声')
      .replace(/静静地/g, '一声不吭地')
      .replace(/淡淡地/g, '漫不经心地')
      .replace(/微微/g, '稍稍')
      .replace(/轻轻/g, '随手')
      .replace(/紧紧/g, '死死')
      .replace(/慢慢地/g, '磨磨蹭蹭')
      .replace(/目光/g, '眼珠子')
      .replace(/内心/g, '心里头')
      .replace(/声音/g, '嗓子');
    return out;
  }

  // 终极降重:翻译链 + 三轮协议 + 人味注入的最强组合
  // 先用翻译链破坏token分布,再用三轮协议注入人味
  async function dedaiUltimate(text) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }

    // 第1步:翻译链破坏token分布(中→日→英→中)
    let result = await translationChain(text);
    if (!result || result.startsWith('⚠️') || result.startsWith('❌')) return result;

    // 第2步:三轮协议注入人味
    result = await threeRoundProtocol(result);
    if (!result || result.startsWith('⚠️') || result.startsWith('❌')) return result;

    // 第3步:最终人味注入
    result = humanChaos(result);
    result = deduplicateText(result);
    result = postProcessText(result);
    return result;
  }

  // 去除连续重复的段落/句子
  function deduplicateText(text) {
    if (!text) return text;
    const lines = text.split(/\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { out.push(lines[i]); continue; }
      // 检查是否与前面某行重复(相似度>80%)
      let isDup = false;
      for (let j = Math.max(0, out.length - 5); j < out.length; j++) {
        const prev = out[j].trim();
        if (!prev) continue;
        if (line === prev) { isDup = true; break; }
        // 简单相似度:共同字符比例
        if (line.length > 10 && prev.length > 10) {
          let common = 0;
          for (const ch of line) { if (prev.indexOf(ch) >= 0) common++; }
          if (common / Math.min(line.length, prev.length) > 0.85) { isDup = true; break; }
        }
      }
      if (!isDup) out.push(lines[i]);
    }
    return out.join('\n');
  }

  // ===== 网文排版格式化 =====
  // 根据起点/番茄等平台规范,自动规范化AI生成的文本格式
  function formatNovelText(text) {
    if (!text || text.length < 10) return text;
    let out = text;

    // 1. 标点规范化:半角→全角
    out = out.replace(/,/g, '，');
    out = out.replace(/\./g, '。');
    out = out.replace(/!/g, '！');
    out = out.replace(/\?/g, '？');
    out = out.replace(/;/g, '；');
    out = out.replace(/:/g, '：');
    out = out.replace(/\(/g, '（');
    out = out.replace(/\)/g, '）');

    // 2. 清理多余空行(最多保留一个)
    out = out.replace(/\n{3,}/g, '\n\n');

    // 3. 去除每行首尾多余空格
    out = out.split('\n').map(function(line) { return line.trim(); }).join('\n');

    // 4. 段落格式化:确保一句一段
    // 先按双换行分段
    var paragraphs = out.split(/\n\n+/);
    var formatted = [];
    for (var i = 0; i < paragraphs.length; i++) {
      var para = paragraphs[i].trim();
      if (!para) continue;

      // 检查是否是对话段(以引号开头)
      var isDialogue = /^["「『""〝]/.test(para);

      // 如果段落包含多个句子(以。！？分隔),拆成一句一段
      if (!isDialogue && para.length > 40) {
        var sentences = para.split(/([。！？]+)/);
        var buf = '';
        for (var j = 0; j < sentences.length; j++) {
          var s = sentences[j];
          if (!s) continue;
          // 标点符号连接到前一句
          if (/^[。！？]+$/.test(s)) {
            buf += s;
          } else {
            if (buf) formatted.push(buf);
            buf = s;
          }
        }
        if (buf) formatted.push(buf);
      } else {
        formatted.push(para);
      }
    }

    // 5. 对话格式化:确保对话单独成段,前后有空行
    var final = [];
    for (var k = 0; k < formatted.length; k++) {
      var line = formatted[k];
      var isDlg = /^["「『""〝]/.test(line);
      var prevIsDlg = k > 0 && /^["「『""〝]/.test(formatted[k - 1]);

      // 对话前加空行(如果前一段不是对话)
      if (isDlg && !prevIsDlg && final.length > 0 && final[final.length - 1] !== '') {
        final.push('');
      }
      final.push(line);
      // 对话后加空行(如果下一段不是对话)
      var nextIsDlg = k < formatted.length - 1 && /^["「『""〝]/.test(formatted[k + 1]);
      if (isDlg && !nextIsDlg && k < formatted.length - 1) {
        final.push('');
      }
    }

    // 6. 最终清理:去除开头结尾空行,合并连续空行
    var result = final.join('\n').replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{3,}/g, '\n\n');
    return result;
  }

  // 人工润色模式:用户写初稿,AI只做微调(保持人类统计特征)
  async function polishHuman(text) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }
    const prompt = '请对以下用户手写的文章做极小幅度的润色。要求:\n' +
      '1. 保留原文95%以上的用词和句式不变\n' +
      '2. 只修正明显的错别字和语病\n' +
      '3. 只在个别地方调整一下表达让它更通顺\n' +
      '4. 绝对不要重写段落,不要改变风格\n' +
      '5. 绝对不要加入任何"值得注意的是""总的来说"等AI套话\n' +
      '6. 直接输出润色后的内容,不加说明\n\n' +
      '原文:\n"""\n' + text + '\n"""';
    return await callAI(prompt, 'polish');
  }

  // ===== 翻译链降AI(参考 lynote-ai/humanize-text) =====
  // 核心原理:3跳跨语言翻译彻底破坏token分布,让统计特征完全偏离AI模式
  async function translationChain(text) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }

    // 第1步:中文→日语(注入日语表达习惯和句式结构)
    const p1 = '你是专业翻译。把以下中文翻译成日语,保留原文情感和细节,直接输出日语译文。不要解释:\n\n' + text;
    const r1 = await callAI(p1, 'polish');
    if (!r1 || r1.startsWith('⚠️') || r1.startsWith('❌')) return r1;

    // 第2步:日语→英语(二次跨语言,进一步破坏中文token分布)
    const p2 = 'Translate the following Japanese text into English. Be natural, not literal. Output only the English translation:\n\n' + r1;
    const r2 = await callAI(p2, 'polish');
    if (!r2 || r2.startsWith('⚠️') || r2.startsWith('❌')) return r2;

    // 第3步:英语→中文(第三次翻译回来,表达习惯已被彻底改变)
    const p3 = '你是专业翻译。把以下英文翻译成中文,要求口语化、自然,不要直译。用最日常的说法。直接输出中文译文:\n\n' + r2;
    const r3 = await callAI(p3, 'polish');
    if (!r3 || r3.startsWith('⚠️') || r3.startsWith('❌')) return r3;

    // 第4步:注入人味(因为翻译会丢失口语感)
    const p4 = '你是深夜赶稿的网文作者。改写以下文字,让它读起来像一个人在深夜写给朋友看的:\n' +
      '1. 加入2-3句内心吐槽或自相矛盾\n' +
      '2. 加入1-2个具体细节(时间/地点/品牌)\n' +
      '3. 句子长短极端不均,有碎片短句\n' +
      '4. 用口语和网络梗,不要书面语\n' +
      '5. 禁止:值得注意的是/综上所述/仿佛/宛如/犹如\n' +
      '6. 保留原文情节,直接输出:\n\n' + r3;
    const r4 = await callAI(p4, 'polish');
    if (!r4 || r4.startsWith('⚠️') || r4.startsWith('❌')) return r4;

    // 后处理
    let result = r4;
    result = deduplicateText(result);
    result = postProcessText(result);
    result = splitLongSentences(result);
    result = humanChaos(result);
    return result;
  }

  // 三轮降重协议 — 3轮不同维度改写,彻底破坏token分布
  // 朱雀检测核心:困惑度/突发性/语义结构,需要3个维度分别突破
  // onProgress: 可选回调 function(msg) 用于更新按钮文字
  async function threeRoundProtocol(text, onProgress) {
    if (!text) return text;
    if (!hasApiKey()) {
      showApiSettings();
      return '⚠️ 请先配置 API Key';
    }

    if (onProgress) onProgress('🪄 第1轮/3 困惑度打散…');
    // 第1轮:困惑度打散 — 让每个token的预测概率变高
    const p1 = '你是凌晨三点赶稿的网文作者,状态亢奋但思路清晰。改写以下文字:\n\n' +
      '规则:\n' +
      '1. 高级词→口语词:仿佛→八成是,缓缓→慢吞吞,不禁→没忍住,微微→稍稍,淡淡→漫不经心地\n' +
      '2. 书面句→碎嘴句:把一个长句拆成2-3个短句,中间加"操""完了""不对"等碎片\n' +
      '3. 省略主语:中文母语者写小说经常省略"我""他",直接说动作\n' +
      '4. 加入1-2个具体细节:凌晨两点半/便利店/出租屋/瑞幸咖啡/地铁站\n' +
      '5. 加入1句内心OS:"等等这不对吧""算了接着写""操又跑题了"\n' +
      '6. **段落要自然**:不要每段都一句一行。有些段落2-3句话连着写,有些段落才一句话\n' +
      '7. **绝对不要有错别字/乱码**!混乱是有节奏的混乱,不是打字失误的混乱\n' +
      '8. 禁止:值得注意的是/综上所述/仿佛/宛如/犹如/似乎/缓缓/淡淡/微微/不禁\n' +
      '9. 保留原文情节,直接输出小说正文:\n\n' + text;
    const r1 = await callAI(p1, 'rewrite');
    if (!r1 || r1.startsWith('⚠️') || r1.startsWith('❌')) return r1;

    if (onProgress) onProgress('🪄 第2轮/3 语义结构打乱…');
    // 第2轮:语义结构打乱 — 打破AI的总分总模式
    const p2 = '你是网文作者,正在和编辑吵架后赶稿。改写以下文字:\n\n' +
      '规则:\n' +
      '1. 打乱段落顺序:不要按时间线写,可以先写结果再写原因\n' +
      '2. 打破总分总:开头直接进入场景,不要概述\n' +
      '3. 加入对读者的喊话:"你猜怎么着""你别说""我说真的"\n' +
      '4. 自相矛盾:上一句说"不在乎",下一句说"说不在意是假的"\n' +
      '5. 跑题一句再绕回:岔开说个不相干的,然后"算了接着说"\n' +
      '6. 句长极端波动:有的句子2字,有的60字用逗号连着写\n' +
      '7. 保留原文情节,直接输出小说正文:\n\n' + r1;
    const r2 = await callAI(p2, 'rewrite');
    if (!r2 || r2.startsWith('⚠️') || r2.startsWith('❌')) return r2;

    if (onProgress) onProgress('🪄 第3轮/3 风格注入…');
    // 第3轮:风格注入 — 模拟真人写作的"不完美"
    const p3 = '你是番茄小说排行榜第一的作者。改写以下文字,让它完全不像AI生成的:\n\n' +
      '规则:\n' +
      '1. 加入口头禅重复:老是说"说真的""怎么说呢""你知道吗"\n' +
      '2. 标点不规范:有些地方不用标点直接流水,有些地方用很多感叹号\n' +
      '3. 加入身体感受:后背发凉/头皮发麻/手心出汗/嗓子干得冒烟\n' +
      '4. 有些段落很短(一句话),有些段落很长(三四句话)\n' +
      '5. 加入具体时间:周三下午/上周二/凌晨两点多\n' +
      '6. 禁止AI味词汇:值得一提/不得不说/令人惊讶/综上所述/在当今社会/众所周知\n' +
      '7. 保留原文情节,直接输出小说正文:\n\n' + r2;
    const r3 = await callAI(p3, 'rewrite');
    if (!r3 || r3.startsWith('⚠️') || r3.startsWith('❌')) return r3;

    // 后处理:只做套话替换,不破坏文本
    let result = r3;
    result = deduplicateText(result);
    result = postProcessText(result);
    result = removeEmDashes(result);
    return result;
  }

  // ===== 深度本地降重(参考 qu-ai-wei 51条规则) =====
  // 不需要API,纯本地规则引擎
  function deepLocalDedai(text) {
    if (!text) return text;
    let out = text;

    // 第1轮:AI高频词替换(扩充版)
    const HEAVY_SWAPS = [
      [/[深入]+/g, '扎进去'],
      [/[领域]+/g, '地盘'],
      [/[赋能]+/g, '帮忙'],
      [/[聚焦]+/g, '盯住'],
      [/[打造]+/g, '搞'],
      [/[优化]+/g, '改好'],
      [/[提升]+/g, '拉高'],
      [/[增强]+/g, '加码'],
      [/[完善]+/g, '补全'],
      [/[推动]+/g, '推一把'],
      [/[发展]+/g, '往前走'],
      [/[创新]+/g, '玩新花样'],
      [/[突破]+/g, '打破'],
      [/[引领]+/g, '带路'],
      [/[核心]+/g, '最关键的'],
      [/[关键]+/g, '要命的'],
      [/[重要]+/g, '顶要紧的'],
      [/[基础]+/g, '底子'],
      [/[框架]+/g, '架子'],
      [/[模式]+/g, '套路'],
      [/[体系]+/g, '一整套'],
      [/[构建]+/g, '搭'],
      [/[建立]+/g, '立起来'],
      [/[实现]+/g, '搞成'],
      [/[达到]+/g, '够着'],
      [/[通过]+/g, '靠着'],
      [/[利用]+/g, '用上'],
      [/[依托]+/g, '靠着'],
      [/[基于]+/g, '打底是'],
      [/[有效]+/g, '管用'],
      [/[显著]+/g, '明显'],
      [/[持续]+/g, '一直'],
      [/[进一步]+/g, '再'],
      [/[不断]+/g, '不停地'],
      [/[高度重视]+/g, '特别看重'],
      [/[广泛关注]+/g, '大家都在看'],
      [/[具有重要意义]+/g, '挺重要的'],
      [/[发挥重要作用]+/g, '帮了大忙'],
      [/[产生深远影响]+/g, '影响挺大'],
    ];
    HEAVY_SWAPS.forEach(([re, rep]) => { out = out.replace(re, rep); });

    // 第2轮:句式打散
    out = scrambleSentenceStarts(out);
    out = scrambleParagraphs(out);

    // 第3轮:注入口语化元素
    out = injectColloquial(out);
    out = injectFragments(out);

    // 第4轮:随机化
    out = randomScramble(out);

    // 第5轮:人味注入(思维跳跃+自相矛盾+具体细节)
    out = humanChaos(out);

    // 第6轮:清理
    out = postProcessText(out);
    out = splitLongSentences(out);
    return out;
  }

  // 应用改写到当前关卡
  async function applyDedai(replaceAll) {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    if (!st || !st.content) {
      toastKind('当前章节没有内容', 'warn');
      return;
    }
    const before = detectAiFlavor(st.content);
    const after = await dedaiAI(st.content);
    if (after && !after.startsWith('⚠️') && !after.startsWith('❌')) {
      st.content = after;
      const ta = document.getElementById('editor');
      if (ta) ta.value = after;
      ta.dispatchEvent(new Event('input'));
      const newScore = detectAiFlavor(after);
      toastKind('已改写 · AI 味分: ' + before.score + ' → ' + newScore.score, 'ok');
    } else {
      toastKind(after || '改写失败', 'bad');
    }
  }

  // 显示检测结果
  function showDetectResult() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    if (!st || !st.content) {
      toastKind('当前章节没有内容', 'warn');
      return;
    }
    const r = detectAiFlavor(st.content);
    const level = r.score >= 60 ? '🔴 强 AI 味' : r.score >= 30 ? '🟡 中度 AI 味' : '🟢 较自然';
    const signal = r.signals.length ? '\n\n发现:\n• ' + r.signals.join('\n• ') : '\n\n没有发现明显 AI 味信号';
    alert('📊 AI 味检测\n\n分数: ' + r.score + ' / 100\n' + level + signal);
  }

  // 除 AI 味 弹窗控制
  const dedaiState = {
    mode: 'local',  // local | deep-local | ai | translate | detect
    original: '',
    rewritten: '',
    level: null,
  };

  function showDedai() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    if (!st || !st.content || st.content.trim().length < 10) {
      toastKind('当前章节内容太少(至少 10 字)', 'warn');
      return;
    }
    dedaiState.original = st.content;
    dedaiState.rewritten = '';
    dedaiState.level = lvl.id;
    document.getElementById('dedai-text-before').value = st.content;
    document.getElementById('dedai-text-after').value = '';
    const before = detectAiFlavor(st.content);
    updateDedaiMeter(before.score);
    renderDedaiSignals(before);
    document.getElementById('dedai-compare').style.display = 'grid';
    document.getElementById('dedai-signals').style.display = 'block';
    updateDedaiButtons();
    document.getElementById('dedai-modal-bg').classList.add('open');
  }

  function hideDedai() {
    const modal = document.getElementById('dedai-modal-bg');
    if (modal) modal.classList.remove('open');
  }

  function updateDedaiMeter(score) {
    const fill = document.getElementById('dedai-meter-fill');
    const scoreEl = document.getElementById('dedai-meter-score');
    if (fill) fill.style.width = Math.min(100, score) + '%';
    if (scoreEl) {
      scoreEl.textContent = score;
      scoreEl.style.color = score >= 60 ? 'var(--bad)' : score >= 30 ? 'var(--gold)' : 'var(--ok)';
    }
  }

  function renderDedaiSignals(r) {
    const box = document.getElementById('dedai-signals');
    if (!box) return;
    const level = r.score >= 60 ? '🔴 强 AI 味' : r.score >= 30 ? '🟡 中度 AI 味' : '🟢 较自然';
    let html = '<b>' + level + '</b>';
    if (r.signals.length) {
      html += '<ul>';
      r.signals.forEach(s => { html += '<li>' + escapeHtml(s) + '</li>'; });
      html += '</ul>';
    } else {
      html += '<div style="margin-top:4px;">没有发现明显 AI 味信号</div>';
    }
    box.innerHTML = html;
  }

  function updateDedaiButtons() {
    const isDetect = dedaiState.mode === 'detect';
    const hasResult = !!dedaiState.rewritten;
    const goBtn = document.getElementById('dedai-go');
    const detectBtn = document.getElementById('dedai-detect-btn');
    const applyBtn = document.getElementById('dedai-apply');
    const revertBtn = document.getElementById('dedai-revert');
    const afterTa = document.getElementById('dedai-text-after');
    if (goBtn) goBtn.style.display = isDetect ? 'none' : '';
    if (detectBtn) detectBtn.style.display = isDetect ? '' : 'none';
    if (applyBtn) applyBtn.style.display = hasResult ? '' : 'none';
    if (revertBtn) revertBtn.style.display = hasResult ? '' : 'none';
    if (afterTa) afterTa.readOnly = hasResult;
  }

  function runDedaiDetect() {
    const text = dedaiState.original;
    const r = detectAiFlavor(text);
    updateDedaiMeter(r.score);
    renderDedaiSignals(r);
    document.getElementById('dedai-text-after').value =
      r.signals.length
        ? '检测完成。\n\n发现以下 AI 味信号:\n• ' + r.signals.join('\n• ') +
          '\n\n建议:\n1. 用「⚡ 本地快速清洗」一键替换套话\n2. 用「🧠 AI 智能改写」让 DeepSeek 重新组织'
        : '检测完成。\n\n没有发现明显 AI 味信号 👍';
  }

  async function runDedaiRewrite() {
    const text = dedaiState.original;
    const afterTa = document.getElementById('dedai-text-after');
    const goBtn = document.getElementById('dedai-go');
    if ((dedaiState.mode === 'ai' || dedaiState.mode === 'translate' || dedaiState.mode === 'ultimate') && !hasApiKey()) {
      showApiSettings();
      return;
    }
    if (goBtn) { goBtn.disabled = true; goBtn.textContent = '⏳ 处理中…'; }
    try {
      let result;
      if (dedaiState.mode === 'local') {
        result = dedaiLocal(text);
      } else if (dedaiState.mode === 'deep-local') {
        result = dedaiDeepLocal(text);
      } else if (dedaiState.mode === 'ai') {
        result = await dedaiAI(text);
      } else if (dedaiState.mode === 'translate') {
        result = await dedaiTranslate(text);
      } else if (dedaiState.mode === 'ultimate') {
        result = await dedaiUltimate(text);
      }
      if (!result || result.startsWith('⚠️') || result.startsWith('❌')) {
        toastKind(result || '改写失败', 'bad');
        return;
      }
      dedaiState.rewritten = result;
      afterTa.value = result;
      const after = detectAiFlavor(result);
      const before = detectAiFlavor(text);
      updateDedaiMeter(after.score);
      renderDedaiSignals(after);
      const delta = before.score - after.score;
      if (delta > 0) {
        renderDedaiSignals({ score: after.score, signals: after.signals.concat(['✓ 下降 ' + delta + ' 分']) });
      }
      updateDedaiButtons();
    } finally {
      if (goBtn) { goBtn.disabled = false; goBtn.textContent = '🪄 开始改写'; }
    }
  }

  function applyDedaiResult() {
    if (!dedaiState.rewritten) return;
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    if (st && dedaiState.level === lvl.id) {
      st.content = dedaiState.rewritten;
      const ta = document.getElementById('editor');
      if (ta) {
        ta.value = dedaiState.rewritten;
        ta.dispatchEvent(new Event('input'));
      }
      toastKind('已应用到编辑器', 'ok');
      hideDedai();
    } else {
      toastKind('关卡已切换,请重新改写', 'warn');
    }
  }

  function revertDedaiResult() {
    dedaiState.rewritten = '';
    document.getElementById('dedai-text-after').value = '';
    updateDedaiButtons();
    const r = detectAiFlavor(dedaiState.original);
    updateDedaiMeter(r.score);
    renderDedaiSignals(r);
  }

  function showApiSettings() {
    const modal = document.getElementById('api-settings-modal-bg');
    if (modal) modal.classList.add('open');
    const input = document.getElementById('api-key-input');
    if (input) {
      input.value = getApiKey();
      input.focus();
    }
    const toggle = document.getElementById('auto-dedai-toggle');
    if (toggle) toggle.checked = getAutoDedai();
  }

  function hideApiSettings() {
    const modal = document.getElementById('api-settings-modal-bg');
    if (modal) modal.classList.remove('open');
  }

  function saveApiSettings() {
    const input = document.getElementById('api-key-input');
    if (input) {
      setApiKey(input.value);
      toast(input.value ? '✅ API Key 已保存' : ' API Key 已清除');
    }
    const toggle = document.getElementById('auto-dedai-toggle');
    if (toggle) {
      setAutoDedai(toggle.checked);
      if (toggle.checked) toast('🪄 已开启AI生成后自动降AI味');
    }
    hideApiSettings();
  }

  function hasApiKey() {
    return !!getApiKey();
  }

  function inspireHint() {
    const lvl = currentLevel();
    const tips = {
      world: ['试着回答:这个世界的魔法/科技规则是什么?', '谁掌握权力?谁被压迫?', '这个世界的"日常"是什么样的?'],
      character: ['他/她最想要什么?', '他/她最害怕什么?', '一个能体现性格的小动作或口头禅?'],
      outline: ['开端:谁、想要什么、遇到什么阻碍?', '发展:局势如何升级?盟友/敌人出现?', '高潮-结局:核心冲突如何收束?'],
      chapter: ['本章节的核心冲突是什么?', '角色在章末发生了什么不可逆的变化?', '下一章要回答的悬念?'],
      boss: ['这是 10 章节点:要让多条线索在这里交汇', '考虑在 Boss 关设置一次关键抉择', '回顾前 9 章的伏笔,回收 1-2 个'],
    };
    const arr = tips[lvl.type] || tips.chapter;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ===== 公众号格式转换 =====
  const WX_STYLE_P = 'margin:0 0 14px;line-height:1.85;font-size:16px;color:#333;';
  const WX_STYLE_H1 = 'font-size:1.4em;font-weight:bold;margin:18px 0 10px;color:#222;';
  const WX_STYLE_H2 = 'font-size:1.2em;font-weight:bold;margin:16px 0 8px;color:#222;';
  const WX_STYLE_BQ = 'border-left:3px solid #ccc;padding-left:12px;color:#666;margin:10px 0;';
  const WX_STYLE_B = 'color:#000;font-weight:bold;';
  const WX_STYLE_EM = 'font-style:italic;color:#555;';
  const WX_STYLE_TODO = 'background:#fff3a0;padding:0 4px;border-radius:3px;color:#7a5a00;';
  const WX_GAP = '<p style="margin:0;line-height:1.85;font-size:16px;"><br></p>';

  function wxInline(line) {
    let s = escapeHtml(line);
    s = s.replace(/\[TODO:([^\]]*)\]/g, function (_, t) {
      return '<span style="' + WX_STYLE_TODO + '">[TODO:' + t + ']</span>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, function (_, t) {
      return '<strong style="' + WX_STYLE_B + '">' + t + '</strong>';
    });
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, function (_, p, t) {
      return p + '<em style="' + WX_STYLE_EM + '">' + t + '</em>';
    });
    return s;
  }

  function wxBlock(block) {
    const t = block.trim();
    if (!t) return '';
    if (/^# /.test(t)) {
      return '<p style="' + WX_STYLE_H1 + '">' + wxInline(t.replace(/^# /, '')) + '</p>';
    }
    if (/^## /.test(t)) {
      return '<p style="' + WX_STYLE_H2 + '">' + wxInline(t.replace(/^## /, '')) + '</p>';
    }
    if (/^> /.test(t)) {
      const inner = t.split(/\n/).map(l => l.replace(/^> ?/, '')).join('<br>');
      return '<blockquote style="' + WX_STYLE_BQ + '">' + wxInline(inner) + '</blockquote>';
    }
    return '<p style="' + WX_STYLE_P + '">' + wxInline(t).replace(/\n/g, '<br>') + '</p>';
  }

  function mdToWechatHtml(text) {
    if (!text) return '';
    return text.split(/\n{2,}/).map(wxBlock).filter(Boolean).join(WX_GAP);
  }

  function gatherWorkText() {
    const w = work();
    return gatherWorkTextOf(w);
  }
  function gatherWorkTextOf(w) {
    if (!w) return '';
    const chunks = [];
    LEVELS.forEach(lvl => {
      const st = w.levels[lvl.id];
      if (st && st.content && st.content.trim()) {
        const title = lvl.type === 'chapter' || lvl.type === 'boss'
          ? '# ' + lvl.name
          : lvl.type === 'world' ? '# 世界观'
          : lvl.type === 'character' ? '# 主角'
          : '# 大纲';
        chunks.push(title + '\n\n' + st.content.trim());
      }
    });
    return chunks.join('\n\n---\n\n');
  }

  function gatherCurrentText() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    return st ? st.content : '';
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // ===== Toast =====
  let toastTimer = null;
  function toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function toastKind(msg, kind) {
    const isError = kind === 'bad' || kind === 'warn' || kind === 'error' || kind === true;
    toast(msg, isError);
  }

  // ===== 通用弹窗组件 =====
  // 用法: nqDialog({ title, icon, size, body, buttons, onClose })
  // size: 'sm' | 'md' | 'lg' | 'xl'
  // buttons: [{ text, class, onClick }]
  function nqDialog(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'nq-dialog-overlay';
    const size = opts.size || 'md';
    overlay.innerHTML =
      '<div class="nq-dialog nq-' + size + '">' +
        '<div class="nq-dialog-head">' +
          (opts.icon ? '<span class="nq-icon">' + opts.icon + '</span>' : '') +
          '<h3>' + (opts.title || '提示') + '</h3>' +
          '<button class="nq-close" data-nq-close>&times;</button>' +
        '</div>' +
        '<div class="nq-dialog-body">' + (opts.body || '') + '</div>' +
        '<div class="nq-dialog-foot">' +
          (opts.buttons || []).map(function(b, i) {
            return '<button class="' + (b.class || 'nq-btn-cancel') + '" data-nq-btn="' + i + '">' + b.text + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('open'); });

    function close() {
      overlay.classList.remove('open');
      setTimeout(function() { overlay.remove(); }, 200);
      if (opts.onClose) opts.onClose();
    }
    overlay.querySelector('[data-nq-close]').addEventListener('click', close);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });
    (opts.buttons || []).forEach(function(b, i) {
      var btn = overlay.querySelector('[data-nq-btn="' + i + '"]');
      if (btn && b.onClick) {
        btn.addEventListener('click', function() {
          var result = b.onClick(close);
          if (result !== false) close();
        });
      }
    });
    return { close: close, el: overlay };
  }

  // 便捷方法: nqAlert / nqConfirm / nqPrompt
  function nqAlert(title, msg, icon) {
    nqDialog({
      title: title, icon: icon || '💡', size: 'sm',
      body: '<p>' + msg + '</p>',
      buttons: [{ text: '知道了', class: 'nq-btn-primary' }]
    });
  }
  function nqConfirm(title, msg, icon, onOk) {
    nqDialog({
      title: title, icon: icon || '❓', size: 'sm',
      body: '<p>' + msg + '</p>',
      buttons: [
        { text: '取消', class: 'nq-btn-cancel' },
        { text: '确定', class: 'nq-btn-ok', onClick: function() { if (onOk) onOk(); } }
      ]
    });
  }

  // ===== Preview modal =====
  let modalHtml = '';
  function showPreview(html) {
    modalHtml = html;
    document.getElementById('modal-title').textContent = '公众号格式预览';
    switchTab('rendered');
    document.getElementById('modal-bg').classList.add('open');
  }
  
  // ===== 日历弹窗 =====
  function showCalendarDetail(dateStr, data) {
    const w = work();
    const modalBody = document.getElementById('calendar-detail-content');
    let html = `<div style="padding: 16px;">`;
    html += `<h3 style="margin: 0 0 12px; font-size: 16px; color: var(--text);">${dateStr} 写作详情</h3>`;
    html += `<div style="display: flex; gap: 32px; margin-bottom: 16px;">`;
    html += `<div><div style="font-size: 12px; color: var(--muted);">字数</div><div style="font-size: 20px; font-weight: 600; color: var(--accent);">${data.words || 0}字</div></div>`;
    html += `<div><div style="font-size: 12px; color: var(--muted);">章节</div><div style="font-size: 20px; font-weight: 600; color: var(--ok);">${data.chapters || 0}章</div></div>`;
    html += `<div><div style="font-size: 12px; color: var(--muted);">TODO完成</div><div style="font-size: 20px; font-weight: 600; color: var(--gold);">${data.todos || 0}</div></div>`;
    html += `</div>`;
    
    if (data.words > 0) {
      html += `<div style="margin-top: 16px;">`;
      html += `<div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">字数分布</div>`;
      html += `<div style="height: 20px; background: var(--panel-2); border-radius: 10px; overflow: hidden; display: flex;">`;
      const intensities = [0, 1, 2, 3, 4];
      intensities.forEach((level, index) => {
        const wordsForLevel = level === 0 ? (data.words === 0 ? 1 : 0) : 
                            level === 1 ? Math.min(data.words, 200) - (index > 1 ? 200 : 0) :
                            level === 2 ? Math.min(data.words, 400) - 400 :
                            level === 3 ? Math.min(data.words, 800) - 800 :
                            data.words - 800;
        const width = wordsForLevel > 0 ? Math.max(5, (wordsForLevel / data.words) * 100) : 0;
        const color = level === 0 ? 'var(--muted)' : 
                     level === 1 ? 'var(--accent)' : 
                     level === 2 ? 'var(--warn)' : 
                     level === 3 ? '#10b981' : '#059669';
        html += `<div style="flex: ${width}%; height: 100%; background: ${color}; transition: flex 0.3s;"></div>`;
      });
      html += `</div>`;
      html += `<div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-top: 4px;">`;
      html += `<span>0</span><span>200</span><span>400</span><span>800</span><span>+</span>`;
      html += `</div></div>`;
    }
    
    html += `</div>`;
    modalBody.innerHTML = html;
    document.getElementById('calendar-modal-title').textContent = `${w.name} - ${dateStr}`;
    document.getElementById('calendar-modal-bg').classList.add('open');
  }
  
  function hideCalendarDetail() {
    document.getElementById('calendar-modal-bg').classList.remove('open');
  }
  function hidePreview() { document.getElementById('modal-bg').classList.remove('open'); }
  function switchTab(name) {
    const body = document.getElementById('modal-body');
    document.querySelectorAll('.modal-head .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    if (name === 'rendered') body.innerHTML = '<div class="rendered">' + modalHtml + '</div>';
    else body.innerHTML = '<div class="raw">' + escapeHtml(modalHtml) + '</div>';
  }

  // ===== 12.11 付费章节模块 =====
  function updatePaidRow() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    const statusEl = document.getElementById('paid-status');
    if (!statusEl) return;
    if (st.paid) {
      statusEl.textContent = '💰 付费章节' + (st.price ? ' · ¥' + st.price : '');
      statusEl.className = 'status is-paid';
    } else {
      statusEl.textContent = '免费章节';
      statusEl.className = 'status';
    }
  }

  function showPaidModal() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    document.getElementById('paid-chapter-name').textContent = lvl.name;
    const cb = document.getElementById('paid-checkbox');
    cb.checked = !!st.paid;
    document.getElementById('paid-price-input').value = st.price || '';
    document.getElementById('paid-trial-input').value = st.trialChars || 500;
    updatePaidToggleUI(!!st.paid);
    updatePaidPreview();
    document.getElementById('paid-modal-bg').classList.add('open');
  }

  function hidePaidModal() {
    document.getElementById('paid-modal-bg').classList.remove('open');
  }

  function updatePaidToggleUI(isPaid) {
    const row = document.getElementById('paid-toggle-row');
    if (isPaid) row.classList.add('active'); else row.classList.remove('active');
    const priceRow = document.getElementById('paid-price-row');
    const trialRow = document.getElementById('paid-trial-row');
    priceRow.style.display = isPaid ? 'flex' : 'none';
    trialRow.style.display = isPaid ? 'flex' : 'none';
  }

  function updatePaidPreview() {
    const cb = document.getElementById('paid-checkbox');
    const previewBox = document.getElementById('paid-preview');
    const previewContent = document.getElementById('paid-preview-content');
    if (!cb.checked) {
      previewBox.style.display = 'none';
      return;
    }
    previewBox.style.display = 'block';
    const lvl = currentLevel();
    const price = document.getElementById('paid-price-input').value || '0.99';
    const trial = parseInt(document.getElementById('paid-trial-input').value) || 500;
    const content = (work().levels[lvl.id].content || '').slice(0, trial);
    previewContent.innerHTML = `
      <div style="font-size:13px;line-height:1.8;color:var(--text);padding:10px 0;">${escapeHtml(content)}${content.length > 0 ? '…' : ''}</div>
      <div style="margin:16px 0;padding:16px;background:linear-gradient(135deg,rgba(245,196,81,.1),rgba(245,196,81,.05));border:1px dashed var(--gold);border-radius:8px;text-align:center;">
        <div style="font-size:15px;font-weight:700;color:var(--gold);margin-bottom:6px;">🔒 本章为付费内容</div>
        <div style="font-size:13px;color:var(--muted);">付费解锁完整章节 · ¥${escapeHtml(price)}</div>
      </div>`;
  }

  function savePaidSettings() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    const cb = document.getElementById('paid-checkbox');
    st.paid = cb.checked;
    st.price = cb.checked ? (document.getElementById('paid-price-input').value.trim() || '0.99') : '';
    st.trialChars = parseInt(document.getElementById('paid-trial-input').value) || 500;
    scheduleSave();
    updatePaidRow();
    hidePaidModal();
    renderSidebar();
    toastKind(cb.checked ? '已标记为付费章节' : '已取消付费标记', 'ok');
  }

  function gatherWorkTextOfWithPaid(w) {
    if (!w) return '';
    const chunks = [];
    LEVELS.forEach(lvl => {
      const st = w.levels[lvl.id];
      if (st && st.content && st.content.trim()) {
        const title = lvl.type === 'chapter' || lvl.type === 'boss'
          ? '# ' + lvl.name
          : lvl.type === 'world' ? '# 世界观'
          : lvl.type === 'character' ? '# 主角'
          : '# 大纲';
        chunks.push(title + '\n\n' + st.content.trim());
        if (st.paid) {
          const price = st.price || '0.99';
          const trial = st.trialChars || 500;
          chunks.push('\n\n---\n\n> 🔒 本章为付费内容，付费解锁完整章节 · ¥' + price + '\n\n---\n');
        }
      }
    });
    return chunks.join('\n\n---\n\n');
  }

  // ===== 事件绑定 =====
  function bind() {
    const ta = document.getElementById('editor');
    ta.addEventListener('input', () => {
      const lvl = currentLevel();
      const st = work().levels[lvl.id];
      st.content = ta.value;
      updateWordCount();
      renderGoal();
      scheduleSave();
    });

    document.getElementById('btn-submit').addEventListener('click', tryComplete);

    document.getElementById('btn-ai').addEventListener('click', async () => {
      if (!hasApiKey()) {
        showApiSettings();
        return;
      }
      const btn = document.getElementById('btn-ai');
      const lvl = currentLevel();
      const st = work().levels[lvl.id];
      const content = st.content || '';
      const tail = content.slice(-800);
      const wordCount = content.replace(/\s/g, '').length;
      const isChapter = lvl.type === 'chapter';
      const isWorldview = lvl.type === 'worldview';
      const isProtagonist = lvl.type === 'protagonist';
      const isOutline = lvl.type === 'outline';

      let contextHint = '';
      if (isWorldview) {
        contextHint = '【世界观设定】请用具体场景和细节展现世界观,不要用百科全书式罗列。通过角色的所见所闻来展现世界的规则和氛围。';
      } else if (isProtagonist) {
        contextHint = '【主角设定】通过一个具体场景展现主角的性格/能力/缺陷。用行动和对话代替直接描述。让读者通过故事认识主角。';
      } else if (isOutline) {
        contextHint = '【故事大纲】简洁清晰地列出故事主线/卷结构/关键转折点。每卷20-30章,标注核心冲突和爽点节奏。';
      } else if (isChapter) {
        const chapterNum = parseInt(lvl.id.replace('ch', '')) || 1;
        if (chapterNum <= 3) {
          contextHint = '【黄金三章】这是前3章之一,必须在100字内让读者知道:主角是谁、有什么能力/处境、本章核心冲突是什么。章末必须留强悬念。';
        } else if (chapterNum % 10 === 0) {
          contextHint = '【Boss章】这是一个小卷的高潮章节。需要:冲突全面爆发+主角反击/突破+围观者震惊反应+章末留大钩子。爽点要写够。';
        } else {
          contextHint = '【正文章节】保持快节奏推进。每段一句,对话30-40%。紧张用短句,舒展用长句。章末必须有悬念钩子。';
        }
      }

      const prompt = '关卡类型:' + lvl.name + (isChapter ? ' (第' + (parseInt(lvl.id.replace('ch',''))||1) + '章)' : '') +
        '\n当前字数:' + wordCount + '字' +
        '\n' + contextHint +
        '\n\n前文末尾(800字):\n' + (tail || '(空章节,请从头开始)') +
        '\n\n请续写300-500字,严格遵守平台格式规范。';
      const autoDedai = getAutoDedai();

      btn.disabled = true;
      btn.textContent = '⏳ AI 续写中…';
      try {
        const out = await callAI(prompt);
        if (!out || out.startsWith('⚠️') || out.startsWith('❌')) {
          toast(out, true);
          return;
        }
        let finalText = out;

        // 网文排版格式化
        finalText = formatNovelText(finalText);

        // 自动降AI味:3轮降重协议(困惑度打散+语义结构打乱+风格注入)
        if (autoDedai) {
          finalText = await threeRoundProtocol(finalText, function(msg) { btn.textContent = msg; });
          if (finalText && !finalText.startsWith('⚠️') && !finalText.startsWith('❌')) {
            finalText = formatNovelText(finalText);
          }
          btn.textContent = '✨ AI 生成';
        }

        ta.value = (ta.value ? ta.value + '\n\n' : '') + finalText;
        ta.dispatchEvent(new Event('input'));

        if (autoDedai) {
          const score = detectAiFlavor(finalText);
          toast('🪄 自动降重完成! AI味指数: ' + score.score + '/100');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ AI 生成';
      }
    });

    document.getElementById('btn-inspire').addEventListener('click', () => {
      alert('💡 灵感提示:\n\n' + inspireHint());
      updateWritingFeedback();
    });
    
    // 标题生成按钮事件
    const titleHintEl = document.getElementById('title-hint');
    if (titleHintEl) {
      titleHintEl.addEventListener('click', () => {
        const currentContent = getCurrentText();
        if (!currentContent) {
          toast('当前章节没有内容', true);
          return;
        }
        
        if (!validateContentForTitleGeneration(currentContent)) {
          return;
        }
        
        const titles = generateAllTitles(currentContent);
        showTitlePanel(titles);
      });
    }
    
    // 标题历史按钮事件
    const titleHistoryBtn = document.getElementById('btn-title-history');
    if (titleHistoryBtn) {
      titleHistoryBtn.addEventListener('click', () => {
        showTitleHistory(state.activeWorkId);
      });
    }
    
    // 标题策略菜单事件
    document.querySelectorAll('#title-menu .menu-item').forEach(item => {
      if (item.id === 'btn-title-history') return;
      item.addEventListener('click', () => {
        const strategy = item.dataset.copy;
        const currentContent = getCurrentText();
        if (!currentContent) {
          toast('当前章节没有内容', true);
          return;
        }
        
        const title = generateWechatTitle(currentContent, strategy);
        showTitlePanel({ [strategy]: title });
      });
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('确定要重置当前作品的全部进度吗?此操作不可撤销。')) return;
      const w = work();
      w.currentLevel = 1;
      w.levels = emptyLevels();
      scheduleSave();
      render();
    });

    // 复制按钮组
    const copyMenu = document.getElementById('copy-menu');
    document.getElementById('btn-copy').addEventListener('click', async () => {
      const html = mdToWechatHtml(gatherCurrentText());
      if (!html) { toast('当前章节没有内容', true); return; }
      const ok = await copyToClipboard(html);
      toast(ok ? '已复制当前章节为公众号格式 ✓' : '复制失败,请改用预览手动复制', !ok);
    });
    document.getElementById('btn-copy-more').addEventListener('click', e => {
      e.stopPropagation();
      copyMenu.classList.toggle('open');
    });
    document.querySelectorAll('#copy-menu .menu-item').forEach(item => {
      item.addEventListener('click', async () => {
        copyMenu.classList.remove('open');
        const act = item.dataset.copy;
        if (act === 'current') {
          const html = mdToWechatHtml(gatherCurrentText());
          if (!html) { toast('当前章节没有内容', true); return; }
          const ok = await copyToClipboard(html);
          toast(ok ? '已复制当前章节 ✓' : '复制失败', !ok);
        } else if (act === 'all') {
          const html = mdToWechatHtml(gatherWorkText());
          if (!html) { toast('整部作品为空', true); return; }
          const ok = await copyToClipboard(html);
          toast(ok ? '已复制整部作品 ✓' : '复制失败', !ok);
        } else if (act === 'preview') {
          showPreview(mdToWechatHtml(gatherCurrentText()));
        } else if (act === 'copy-html') {
          const html = mdToWechatHtml(gatherCurrentText());
          if (!html) { toast('当前章节没有内容', true); return; }
          const ok = await copyToClipboard(html);
          toast(ok ? '已复制 HTML 源码 ✓' : '复制失败', !ok);
        }
      });
    });
    document.addEventListener('click', e => {
      if (copyMenu.classList.contains('open') && !copyMenu.contains(e.target)
          && e.target.id !== 'btn-copy-more') copyMenu.classList.remove('open');
    });

    // Modal events
    document.getElementById('modal-close').addEventListener('click', hidePreview);
    document.getElementById('modal-ok').addEventListener('click', hidePreview);
    document.getElementById('modal-copy').addEventListener('click', async () => {
      const ok = await copyToClipboard(modalHtml);
      toast(ok ? '已复制预览内容 ✓' : '复制失败', !ok);
    });
    document.querySelectorAll('.modal-head .tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
    document.getElementById('modal-bg').addEventListener('click', e => {
      if (e.target.id === 'modal-bg') hidePreview();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hidePreview();
    });

    // API 设置弹窗事件
    document.getElementById('btn-api-settings').addEventListener('click', showApiSettings);
    document.getElementById('api-settings-close').addEventListener('click', hideApiSettings);
    document.getElementById('api-settings-cancel').addEventListener('click', hideApiSettings);
    document.getElementById('api-settings-save').addEventListener('click', saveApiSettings);
    document.getElementById('api-key-clear').addEventListener('click', () => {
      setApiKey('');
      document.getElementById('api-key-input').value = '';
      toast('API Key 已清除');
    });
    document.getElementById('api-settings-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'api-settings-modal-bg') hideApiSettings();
    });
    document.getElementById('api-key-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') saveApiSettings();
    });

    // 全文搜索弹窗事件
    document.getElementById('btn-search').addEventListener('click', showSearch);
    document.getElementById('search-modal-close').addEventListener('click', hideSearch);
    document.getElementById('search-modal-ok').addEventListener('click', hideSearch);
    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('search-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'search-modal-bg') hideSearch();
    });
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') performSearch();
        if (e.key === 'Escape') hideSearch();
      });
    }

    // 作品集 / 成品展示
    document.getElementById('btn-showcase').addEventListener('click', showShowcase);
    document.getElementById('showcase-modal-close').addEventListener('click', hideShowcase);
    document.getElementById('showcase-modal-ok').addEventListener('click', hideShowcase);
    document.getElementById('showcase-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'showcase-modal-bg') hideShowcase();
    });
    document.getElementById('showcase-export-all').addEventListener('click', exportAllShowcase);
    document.getElementById('showcase-filter').addEventListener('input', renderShowcase);
    document.getElementById('showcase-sort').addEventListener('change', renderShowcase);

    // 阅读模式
    document.getElementById('reader-modal-close').addEventListener('click', hideReader);
    document.getElementById('reader-modal-ok').addEventListener('click', hideReader);
    document.getElementById('reader-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'reader-modal-bg') hideReader();
    });
    document.getElementById('reader-copy-all').addEventListener('click', readerCopyAll);
    document.getElementById('reader-export').addEventListener('click', readerExport);

    // 除 AI 味
    document.getElementById('btn-dedai').addEventListener('click', showDedai);
    document.getElementById('btn-detect').addEventListener('click', showDetectResult);
    document.getElementById('dedai-modal-close').addEventListener('click', hideDedai);
    document.getElementById('dedai-cancel').addEventListener('click', hideDedai);
    document.getElementById('dedai-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'dedai-modal-bg') hideDedai();
    });
    document.querySelectorAll('.dedai-modes button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.dedai-modes button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dedaiState.mode = btn.getAttribute('data-mode');
        updateDedaiButtons();
      });
    });
    document.getElementById('dedai-detect-btn').addEventListener('click', () => runDedaiDetect());
    document.getElementById('dedai-go').addEventListener('click', () => runDedaiRewrite());
    document.getElementById('dedai-apply').addEventListener('click', applyDedaiResult);
    document.getElementById('dedai-revert').addEventListener('click', revertDedaiResult);

    // 付费章节设置
    document.getElementById('btn-paid-set').addEventListener('click', showPaidModal);
    document.getElementById('paid-modal-close').addEventListener('click', hidePaidModal);
    document.getElementById('paid-cancel').addEventListener('click', hidePaidModal);
    document.getElementById('paid-save').addEventListener('click', savePaidSettings);
    document.getElementById('paid-toggle-row').addEventListener('click', () => {
      const cb = document.getElementById('paid-checkbox');
      cb.checked = !cb.checked;
      updatePaidToggleUI(cb.checked);
      updatePaidPreview();
    });
    document.getElementById('paid-checkbox').addEventListener('change', e => {
      updatePaidToggleUI(e.target.checked);
      updatePaidPreview();
    });
    document.getElementById('paid-price-input').addEventListener('input', updatePaidPreview);
    document.getElementById('paid-trial-input').addEventListener('input', updatePaidPreview);
    document.getElementById('paid-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'paid-modal-bg') hidePaidModal();
    });

    // 作品切换
    document.getElementById('work-switcher').addEventListener('click', e => {
      e.stopPropagation();
      toggleWorkMenu();
    });
    document.getElementById('btn-new-work').addEventListener('click', () => {
      const name = prompt('新作品名称', '未命名作品');
      if (name == null) return;
      createWork(name.trim() || '未命名作品');
      closeWorkMenu();
    });
    document.addEventListener('click', e => {
      const menu = document.getElementById('work-menu');
      if (menu.classList.contains('open') && !menu.contains(e.target)) closeWorkMenu();
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveNow()) {
          const t = document.getElementById('save-text');
          const old = t.textContent;
          t.textContent = '已保存 ✓';
          setTimeout(() => { t.textContent = old || '已保存'; }, 1200);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        showSearch();
      }
    });

    document.getElementById('todo-stat').addEventListener('click', () => {
      const panel = document.getElementById('todo-panel');
      if (panel.classList.contains('collapsed')) panel.classList.remove('collapsed');
    });
    document.getElementById('todo-toggle').addEventListener('click', toggleTodoPanel);
    document.getElementById('todo-head') && document.getElementById('todo-head').addEventListener('click', toggleTodoPanel);
    document.getElementById('save-indicator').addEventListener('click', () => {
      if (document.getElementById('save-indicator').classList.contains('error')) scheduleSave();
    });
  }
  
  // ===== 公众号标题生成 =====
  const TITLE_HISTORY_KEY = 'novel-quest.title-history';
  const API_KEY_STORAGE = 'novel-quest.api-key';
  
  // 5种标题策略
  const TITLE_STRATEGIES = {
    // 悬念式：引起好奇心的反问句
    suspense: {
      generate: (content) => `那些成功作家是如何${content}的？`,
      description: '悬念式标题，引发好奇心'
    },
    // 数字式：列举重要性的标题
    numbers: {
      generate: (content) => `10个${content}的高效方法`,
      description: '数字式标题，突显重要性'
    },
    // 反转式：打破认知的标题
    reversal: {
      generate: (content) => `${content}不是因为${content}的原因`,
      description: '反转式标题，打破常规思维'
    },
    // 痛点式：解决问题的标题
    pain: {
      generate: (content) => `${content}怎么办？教你${content}个方法`,
      description: '痛点式标题，解决用户问题'
    },
    // 故事式：讲述成功的标题
    story: {
      generate: (content) => `那些成功作家是如何${content}的`,
      description: '故事式标题，讲述励志故事'
    }
  };
  
  // 智能标题生成函数
  function generateWechatTitle(content, strategy = 'suspense') {
    if (!content || content.length < 10) {
      return '';
    }
    
    const strategies = TITLE_STRATEGIES;
    const selectedStrategy = strategies[strategy] || strategies.suspense;
    
    // 提取内容中的关键词
    const keywords = extractKeywords(content);
    
    // 根据关键词生成标题
    let title = selectedStrategy.generate(keywords.join('/'));
    
    // 确保标题长度合理
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    
    return title;
  }
  
  // 提取关键词
  function extractKeywords(content) {
    const words = content.split(/\s+/);
    const stopWords = ['的', '是', '在', '和', '与', '或', '但', '如果', '因为', '所以'];
    
    return words.filter(word => 
      word.length > 2 && 
      !stopWords.includes(word) &&
      !/^[a-zA-Z0-9]+$/.test(word) &&
      !/^./.test(word)
    ).slice(0, 5);
  }
  
  // 生成所有策略的标题
  function generateAllTitles(content) {
    const strategies = Object.keys(TITLE_STRATEGIES);
    const titles = {};
    
    strategies.forEach(strategy => {
      titles[strategy] = generateWechatTitle(content, strategy);
    });
    
    return titles;
  }
  
  // 保存标题历史
  function saveTitleHistory(workId, title, strategy) {
    const history = JSON.parse(localStorage.getItem(TITLE_HISTORY_KEY) || '{}');
    
    if (!history[workId]) {
      history[workId] = [];
    }
    
    const titleRecord = {
      id: Date.now(),
      title,
      strategy,
      workId,
      createdAt: new Date().toISOString(),
      chapter: currentLevel().name
    };
    
    history[workId].push(titleRecord);
    
    // 只保留最近20个记录
    if (history[workId].length > 20) {
      history[workId] = history[workId].slice(-20);
    }
    
    localStorage.setItem(TITLE_HISTORY_KEY, JSON.stringify(history));
  }
  
  // 获取标题历史
  function getTitleHistory(workId) {
    const history = JSON.parse(localStorage.getItem(TITLE_HISTORY_KEY) || '{}');
    return history[workId] || [];
  }
  
  // 获取策略名称
  function getStrategyName(strategy) {
    const strategyNames = {
      suspense: '悬念式',
      numbers: '数字式',
      reversal: '反转式',
      pain: '痛点式',
      story: '故事式'
    };
    return strategyNames[strategy] || strategy;
  }
  
  // 标题生成结果面板
  function showTitlePanel(titles) {
    const titleContent = document.getElementById('title-content');
    titleContent.innerHTML = '';
    
    if (titles.history) {
      // 显示历史记录
      titles.history.forEach(record => {
        const titleElement = document.createElement('div');
        titleElement.className = 'title-option';
        titleElement.innerHTML = `
          <div class="title-text">${record.title}</div>
          <div class="title-strategy">${getStrategyName(record.strategy)} - ${record.chapter}</div>
          <div class="title-time">${new Date(record.createdAt).toLocaleString()}</div>
        `;
        
        titleElement.addEventListener('click', () => {
          copyTitleToClipboard(record.title);
        });
        
        titleContent.appendChild(titleElement);
      });
    } else {
      // 显示策略标题
      Object.entries(titles).forEach(([strategy, title]) => {
        if (!title) return;
        
        const titleElement = document.createElement('div');
        titleElement.className = 'title-option';
        titleElement.innerHTML = `
          <div class="title-text">${title}</div>
          <div class="title-strategy">${getStrategyName(strategy)}</div>
        `;
        
        titleElement.addEventListener('click', () => {
          copyTitleToClipboard(title);
        });
        
        titleContent.appendChild(titleElement);
      });
    }
    
    document.getElementById('title-modal-bg').classList.add('open');
  }
  
  // 复制标题到剪贴板
  function copyTitleToClipboard(title) {
    if (!title) return false;
    
    return copyToClipboard(title)
      .then(() => {
        toast('标题已复制到剪贴板 ✓', false);
        return true;
      })
      .catch(() => {
        toast('复制失败，请手动复制', true);
        return false;
      });
  }
  
  // 验证内容是否适合生成标题
  function validateContentForTitleGeneration(content) {
    if (!content || typeof content !== 'string') {
      return false;
    }
    
    if (content.trim().length < 10) {
      toast('内容太短，建议至少写10个字', true);
      return false;
    }
    
    if (!/[a-zA-Z\u4e00-\u9fa5]/.test(content)) {
      toast('内容似乎不包含文字，无法生成标题', true);
      return false;
    }
    
    return true;
  }
  
  // 渲染标题历史
  function renderTitleHistory() {
    const w = work();
    const history = getTitleHistory(w.id);
    const titleHistoryElement = document.getElementById('title-history');
    
    if (!titleHistoryElement) return;
    
    titleHistoryElement.innerHTML = '';
    
    if (history.length === 0) {
      titleHistoryElement.innerHTML = '<div class="title-empty">还没有标题历史记录</div>';
      return;
    }
    
    const recentHistory = history.slice(-3);
    recentHistory.forEach(record => {
      const titleElement = document.createElement('div');
      titleElement.className = 'title-history-item';
      titleElement.innerHTML = `
        <div class="title-history-text">${record.title}</div>
        <div class="title-history-meta">${getStrategyName(record.strategy)} - ${record.chapter}</div>
        <div class="title-history-time">${new Date(record.createdAt).toLocaleString()}</div>
      `;
      
      titleElement.addEventListener('click', () => {
        copyTitleToClipboard(record.title);
      });
      
      titleHistoryElement.appendChild(titleElement);
    });
  }
  
  // ===== 12.5 全文搜索 =====
  const SEARCH_HISTORY_KEY = 'novel-quest.search-history';
  const SEARCH_HISTORY_MAX = 10;
  const SNIPPET_RADIUS = 60;

  function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveSearchHistory(keyword) {
    if (!keyword) return;
    let history = getSearchHistory().filter(k => k !== keyword);
    history.push(keyword);
    if (history.length > SEARCH_HISTORY_MAX) {
      history = history.slice(-SEARCH_HISTORY_MAX);
    }
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  }

  function clearSearchHistory() {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function buildSnippet(text, idx, keyword) {
    const start = Math.max(0, idx - SNIPPET_RADIUS);
    const end = Math.min(text.length, idx + keyword.length + SNIPPET_RADIUS);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < text.length) snippet = snippet + '…';
    const escapedSnippet = escapeHtml(snippet);
    const escapedKeyword = escapeHtml(keyword);
    const re = new RegExp(escapeRegExp(escapedKeyword), 'gi');
    return escapedSnippet.replace(re, '<mark>$&</mark>');
  }

  function searchInWork(workId, keyword, isAll) {
    if (!keyword) return [];
    const results = [];
    const MAX = 200;
    const re = new RegExp(escapeRegExp(keyword), 'gi');
    const workList = isAll ? Object.values(state.works) : [state.works[workId]];
    outer: for (const w of workList) {
      if (!w || !w.levels) continue;
      for (const lvl of LEVELS) {
        const st = w.levels[lvl.id];
        if (!st || !st.content) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(st.content)) !== null) {
          if (m.index === re.lastIndex) re.lastIndex++;
          results.push({
            workId: w.id,
            workName: w.name,
            levelId: lvl.id,
            levelName: lvl.name,
            index: m.index,
            match: m[0],
            snippet: buildSnippet(st.content, m.index, keyword),
          });
          if (results.length >= MAX) break outer;
        }
      }
    }
    return results;
  }

  function renderSearchHistory() {
    const container = document.getElementById('search-history');
    if (!container) return;
    const history = getSearchHistory();
    if (history.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<span style="font-size:11px;color:var(--muted);align-self:center;">最近:</span>' +
      history.map(k => `<span class="search-history-chip" data-key="${escapeHtml(k)}">${escapeHtml(k)}</span>`).join('');
    container.querySelectorAll('.search-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('search-input');
        if (input) {
          input.value = chip.dataset.key;
          performSearch();
        }
      });
    });
  }

  function renderSearchResults(results, keyword) {
    const container = document.getElementById('search-results');
    const summary = document.getElementById('search-summary');
    if (!container) return;
    if (!keyword) {
      container.innerHTML = '<div class="search-empty">输入关键词开始搜索</div>';
      if (summary) summary.textContent = '';
      return;
    }
    if (results.length === 0) {
      container.innerHTML = `<div class="search-empty">未找到「${escapeHtml(keyword)}」相关内容</div>`;
      if (summary) summary.textContent = `未找到「${keyword}」`;
      return;
    }
    if (summary) summary.textContent = `找到 ${results.length} 处匹配`;
    container.innerHTML = results.map((r, i) => `
      <div class="search-result-item" data-i="${i}">
        <div class="search-result-chapter">${escapeHtml(r.workName)} · ${escapeHtml(r.levelName)}</div>
        <div class="search-result-snippet">${r.snippet}</div>
      </div>
    `).join('');
    container.querySelectorAll('.search-result-item').forEach((el, i) => {
      el.addEventListener('click', () => jumpToSearchResult(results[i]));
    });
  }

  function jumpToSearchResult(result) {
    hideSearch();
    if (state.activeWorkId !== result.workId) {
      switchWork(result.workId);
    }
    setTimeout(() => {
      switchLevel(result.levelId);
      const ta = document.getElementById('editor');
      if (ta) {
        const before = ta.value.slice(0, result.index);
        const lines = before.split('\n').length;
        const lineHeight = 22;
        ta.scrollTop = Math.max(0, (lines - 5) * lineHeight);
        ta.focus();
        ta.setSelectionRange(result.index, result.index + result.match.length);
        toast('已跳转到匹配位置');
      }
    }, 50);
  }

  function performSearch() {
    const input = document.getElementById('search-input');
    const scope = document.getElementById('search-scope');
    if (!input) return;
    const keyword = input.value.trim();
    if (!keyword) {
      renderSearchResults([], '');
      return;
    }
    const isAll = scope && scope.value === 'all';
    const results = searchInWork(state.activeWorkId, keyword, isAll);
    renderSearchResults(results, keyword);
    if (results.length > 0) {
      saveSearchHistory(keyword);
      renderSearchHistory();
    }
  }

  function showSearch() {
    const modal = document.getElementById('search-modal-bg');
    if (modal) modal.classList.add('open');
    const input = document.getElementById('search-input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
    renderSearchHistory();
    renderSearchResults([], '');
  }

  function hideSearch() {
    const modal = document.getElementById('search-modal-bg');
    if (modal) modal.classList.remove('open');
  }

  // ===== 12.6 作品集 / 成品展示页 =====
  const COVER_GRADIENTS = [
    'linear-gradient(135deg, #6ea8ff 0%, #9b6eff 100%)',
    'linear-gradient(135deg, #f5c451 0%, #ef4444 100%)',
    'linear-gradient(135deg, #4ade80 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #10b981 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
    'linear-gradient(135deg, #db2777 0%, #f97316 100%)',
    'linear-gradient(135deg, #14b8a6 0%, #6366f1 100%)',
  ];

  function workStats(w) {
    let totalWords = 0;
    let chapterCount = 0;
    let completedChapters = 0;
    let completedLevels = 0;
    let lastUpdate = 0;
    LEVELS.forEach(lvl => {
      const lv = w.levels[lvl.id];
      if (!lv) return;
      if (lv.content) {
        totalWords += lv.content.length;
        if (lvl.type === 'chapter' || lvl.type === 'boss') {
          chapterCount += 1;
          const isDone = lv.status === 'done' ||
            (lvl.targets || []).every(t => t.test ? t.test(lv.content) : false);
          if (isDone) completedChapters += 1;
        }
      }
      if (lv.status === 'done') completedLevels += 1;
    });
    const totalLevels = LEVELS.length;
    const progress = Math.round((completedLevels / totalLevels) * 100);
    if (w.updatedAt) {
      const t = new Date(w.updatedAt).getTime();
      if (!isNaN(t) && t > lastUpdate) lastUpdate = t;
    }
    if (w.createdAt) {
      const t = new Date(w.createdAt).getTime();
      if (!isNaN(t) && t > lastUpdate) lastUpdate = t;
    }
    return {
      totalWords, chapterCount, completedChapters,
      completedLevels, totalLevels, progress, lastUpdate,
    };
  }

  function getCoverGradient(w, idx) {
    if (w.coverGradient) return w.coverGradient;
    return COVER_GRADIENTS[idx % COVER_GRADIENTS.length];
  }

  function formatDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function getShowcaseFilter() {
    return (document.getElementById('showcase-filter').value || '').trim().toLowerCase();
  }

  function getShowcaseSort() {
    return document.getElementById('showcase-sort').value || 'updated';
  }

  function getSortedFilteredWorks() {
    const filter = getShowcaseFilter();
    const sort = getShowcaseSort();
    const arr = Object.values(state.works).map((w, idx) => ({ w, idx, stats: workStats(w) }));
    let filtered = filter
      ? arr.filter(x => x.w.name.toLowerCase().includes(filter))
      : arr;
    filtered.sort((a, b) => {
      switch (sort) {
        case 'created': return new Date(b.w.createdAt || 0) - new Date(a.w.createdAt || 0);
        case 'words': return b.stats.totalWords - a.stats.totalWords;
        case 'progress': return b.stats.progress - a.stats.progress;
        case 'name': return (a.w.name || '').localeCompare(b.w.name || '', 'zh-CN');
        case 'updated':
        default: return b.stats.lastUpdate - a.stats.lastUpdate;
      }
    });
    return filtered;
  }

  function renderShowcase() {
    const list = document.getElementById('showcase-list');
    const summary = document.getElementById('showcase-summary');
    if (!list || !summary) return;
    const items = getSortedFilteredWorks();
    if (items.length === 0) {
      const filter = getShowcaseFilter();
      list.innerHTML = '<div class="showcase-empty" style="grid-column:1/-1;">'
        + '<div class="big">' + (filter ? '🔍' : '📭') + '</div>'
        + '<div>' + (filter ? '没有匹配的作品' : '还没有任何作品') + '</div>'
        + (filter ? '' : '<div style="margin-top:8px;font-size:12px;">点击顶栏「＋ 新建作品」开始创作</div>')
        + '</div>';
      summary.textContent = '共 0 部作品';
      return;
    }
    const totalWords = items.reduce((s, x) => s + x.stats.totalWords, 0);
    const totalChapters = items.reduce((s, x) => s + x.stats.completedChapters, 0);
    summary.textContent = '共 ' + items.length + ' 部作品 · ' + totalWords.toLocaleString() + ' 字 · ' + totalChapters + ' 章已完成';
    list.innerHTML = items.map(({ w, idx, stats }) => {
      const gradient = getCoverGradient(w, idx);
      const isCurrent = w.id === state.activeWorkId;
      const badge = isCurrent
        ? '<div class="showcase-cover-badge">当前</div>'
        : (stats.progress >= 100 ? '<div class="showcase-cover-badge">完结</div>' : '');
      return '<div class="showcase-card" data-id="' + w.id + '">'
        + '<div class="showcase-cover" style="--cover-bg:' + gradient + ';">'
        + badge
        + '<div class="showcase-cover-title">' + escapeHtml(w.name || '未命名') + '</div>'
        + '<div class="showcase-cover-sub">' + formatDateShort(w.createdAt) + '</div>'
        + '</div>'
        + '<div class="showcase-info">'
        + '<div class="showcase-row"><span>总字数</span><b>' + stats.totalWords.toLocaleString() + '</b></div>'
        + '<div class="showcase-row"><span>章节</span><b>' + stats.completedChapters + ' / ' + stats.chapterCount + '</b></div>'
        + '<div class="showcase-row"><span>关卡</span><b>' + stats.completedLevels + ' / ' + stats.totalLevels + '</b></div>'
        + '<div class="showcase-row"><span>更新</span><b>' + formatDateTime(w.updatedAt || w.createdAt) + '</b></div>'
        + '<div class="showcase-progress"><div class="showcase-progress-fill" style="width:' + stats.progress + '%;"></div></div>'
        + '<div class="showcase-row"><span>完成度</span><b>' + stats.progress + '%</b></div>'
        + '</div>'
        + '<div class="showcase-actions">'
        + '<button data-act="read" data-id="' + w.id + '">📖 阅读</button>'
        + '<button data-act="edit" data-id="' + w.id + '">✏️ 编辑</button>'
        + '<button data-act="copy" data-id="' + w.id + '">📋 复制</button>'
        + '<button data-act="del" data-id="' + w.id + '" class="danger">🗑️</button>'
        + '</div>'
        + '</div>';
    }).join('');
    list.querySelectorAll('.showcase-card').forEach(card => {
      const id = card.getAttribute('data-id');
      card.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const act = btn.getAttribute('data-act');
          if (act === 'read') openReader(id);
          else if (act === 'edit') { switchWork(id); hideShowcase(); }
          else if (act === 'copy') copyWorkShowcase(id);
          else if (act === 'del') deleteWorkFromShowcase(id);
        });
      });
      card.addEventListener('click', () => openReader(id));
    });
  }

  function showShowcase() {
    const modal = document.getElementById('showcase-modal-bg');
    if (!modal) return;
    document.getElementById('showcase-filter').value = '';
    document.getElementById('showcase-sort').value = 'updated';
    renderShowcase();
    modal.classList.add('open');
  }

  function hideShowcase() {
    const modal = document.getElementById('showcase-modal-bg');
    if (modal) modal.classList.remove('open');
  }

  function copyWorkShowcase(workId) {
    const w = state.works[workId];
    if (!w) return;
    const text = gatherWorkTextOf(w);
    if (!text) { toastKind('作品暂无内容', 'warn'); return; }
    const html = mdToWechatHtml(text);
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
    ]).then(() => toastKind('已复制 ' + w.name + '（含 HTML）', 'ok'))
      .catch(() => {
        navigator.clipboard.writeText(text)
          .then(() => toastKind('已复制 ' + w.name + '（纯文本）', 'ok'))
          .catch(() => toastKind('复制失败,请手动操作', 'bad'));
      });
  }

  function deleteWorkFromShowcase(workId) {
    const w = state.works[workId];
    if (!w) return;
    if (!confirm('确定删除作品「' + w.name + '」?此操作不可恢复!')) return;
    if (state.works[workId]) delete state.works[workId];
    if (Object.keys(state.works).length === 0) {
      const newId = uid();
      state.works[newId] = { id: newId, name: '我的第一本小说', createdAt: new Date().toISOString(), currentLevel: 1, levels: emptyLevels(), todoDone: {} };
      state.activeWorkId = newId;
    } else if (state.activeWorkId === workId) {
      state.activeWorkId = Object.keys(state.works)[0];
    }
    saveNow();
    render();
    renderShowcase();
    toastKind('已删除「' + w.name + '」', 'ok');
  }

  function exportAllShowcase() {
    const works = Object.values(state.works);
    if (works.length === 0) { toastKind('没有可导出的作品', 'warn'); return; }
    const chunks = works.map(w => '# ' + w.name + '\n\n' + (gatherWorkTextOfWithPaid(w) || '（空）'));
    const combined = chunks.join('\n\n---\n\n');
    const html = mdToWechatHtml(combined);
    const fileName = '全部作品-' + formatDateShort(new Date().toISOString()) + '.html';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toastKind('已导出 ' + works.length + ' 部作品', 'ok');
  }

  // ----- 阅读模式 -----
  let readerWorkId = null;
  let readerActiveLevelId = null;

  function buildReaderToc(w) {
    const toc = [];
    LEVELS.forEach(lvl => {
      const lv = w.levels[lvl.id];
      if (!lv) return;
      if (lvl.type === 'world') {
        toc.push({ id: lvl.id, type: 'world', name: '📖 世界观', words: (lv.content || '').length });
      } else if (lvl.type === 'character') {
        toc.push({ id: lvl.id, type: 'character', name: '👤 主角档案', words: (lv.content || '').length });
      } else if (lvl.type === 'outline') {
        toc.push({ id: lvl.id, type: 'outline', name: '🗺️ 三幕大纲', words: (lv.content || '').length });
      } else if (lvl.type === 'chapter' || lvl.type === 'boss') {
        if (lv.content) {
          const paidTag = lv.paid ? ' 💰' : '';
          toc.push({ id: lvl.id, type: lvl.type, name: lvl.name + paidTag, words: lv.content.length });
        }
      }
    });
    return toc;
  }

  function renderReaderToc(toc) {
    const wrap = document.getElementById('reader-toc');
    if (!wrap) return;
    if (toc.length === 0) {
      wrap.innerHTML = '<div style="padding:20px 14px;color:var(--muted);font-size:12px;text-align:center;">尚无内容</div>';
      return;
    }
    let html = '';
    let lastSection = '';
    toc.forEach(item => {
      let section = '';
      if (item.type === 'world' || item.type === 'character' || item.type === 'outline') section = '设定';
      else section = '正文';
      if (section !== lastSection) {
        html += '<div class="reader-toc-section">' + section + '</div>';
        lastSection = section;
      }
      const isActive = item.id === readerActiveLevelId;
      const words = item.words > 0 ? '<div class="meta">' + item.words + ' 字</div>' : '';
      html += '<div class="reader-toc-item' + (isActive ? ' active' : '') + '" data-id="' + item.id + '">'
        + '<div>' + escapeHtml(item.name) + '</div>' + words
        + '</div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.reader-toc-item').forEach(el => {
      el.addEventListener('click', () => {
        readerActiveLevelId = Number(el.getAttribute('data-id'));
        renderReaderContent(readerWorkId);
        wrap.querySelectorAll('.reader-toc-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
      });
    });
  }

  function renderReaderContent(workId) {
    const w = state.works[workId];
    const container = document.getElementById('reader-content');
    if (!w || !container) return;
    const lv = w.levels[readerActiveLevelId];
    if (!lv) { container.innerHTML = '<div class="empty-chapter">未选择章节</div>'; return; }
    const lvl = LEVELS.find(l => l.id === readerActiveLevelId);
    let html = '';
    if (lvl.type === 'chapter' || lvl.type === 'boss') {
      const badge = lvl.type === 'boss' ? '<span class="badge boss">🔥 Boss 关</span>' : '';
      html += '<h1>' + escapeHtml(lvl.name) + badge + '</h1>';
    } else if (lvl.type === 'world') {
      html += '<h1>📖 世界观</h1>';
    } else if (lvl.type === 'character') {
      html += '<h1>👤 主角档案</h1>';
    } else if (lvl.type === 'outline') {
      html += '<h1>🗺️ 三幕大纲</h1>';
    }
    const content = (lv.content || '').trim();
    if (!content) {
      html += '<div class="empty-chapter">本关尚未创作内容</div>';
    } else if (lv.paid) {
      const trial = lv.trialChars || 500;
      const trialText = content.slice(0, trial);
      html += mdToWechatHtml(trialText);
      if (trialText.length < content.length) {
        html += '<div style="margin:24px 0;padding:20px;background:linear-gradient(135deg,rgba(245,196,81,.12),rgba(245,196,81,.04));border:1px dashed var(--gold);border-radius:8px;text-align:center;">'
          + '<div style="font-size:18px;margin-bottom:8px;">🔒</div>'
          + '<div style="font-size:15px;font-weight:700;color:var(--gold);margin-bottom:6px;">本章为付费内容</div>'
          + '<div style="font-size:13px;color:var(--muted);">以上为试读部分（' + trial + '字），付费解锁完整章节 · ¥' + escapeHtml(lv.price || '0.99') + '</div>'
          + '</div>';
      }
    } else {
      html += mdToWechatHtml(content);
    }
    container.innerHTML = html;
    container.scrollTop = 0;
  }

  function openReader(workId, levelId) {
    const w = state.works[workId];
    if (!w) return;
    readerWorkId = workId;
    const toc = buildReaderToc(w);
    if (toc.length === 0) {
      toastKind('该作品尚无内容', 'warn');
      return;
    }
    if (!levelId) {
      const lastChapter = toc.filter(t => t.type === 'chapter' || t.type === 'boss').pop();
      readerActiveLevelId = lastChapter ? lastChapter.id : toc[0].id;
    } else {
      readerActiveLevelId = levelId;
    }
    document.getElementById('reader-title').textContent = '📖 ' + w.name;
    renderReaderToc(toc);
    renderReaderContent(workId);
    document.getElementById('reader-modal-bg').classList.add('open');
  }

  function hideReader() {
    const modal = document.getElementById('reader-modal-bg');
    if (modal) modal.classList.remove('open');
    readerWorkId = null;
    readerActiveLevelId = null;
  }

  function readerCopyAll() {
    if (!readerWorkId) return;
    const w = state.works[readerWorkId];
    const text = gatherWorkTextOfWithPaid(w);
    if (!text) { toastKind('无内容可复制', 'warn'); return; }
    const html = mdToWechatHtml(text);
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
    ]).then(() => toastKind('已复制「' + w.name + '」', 'ok'))
      .catch(() => {
        navigator.clipboard.writeText(text)
          .then(() => toastKind('已复制（纯文本）', 'ok'))
          .catch(() => toastKind('复制失败', 'bad'));
      });
  }

  function readerExport() {
    if (!readerWorkId) return;
    const w = state.works[readerWorkId];
    const text = gatherWorkTextOfWithPaid(w);
    if (!text) { toastKind('无内容可导出', 'warn'); return; }
    const html = mdToWechatHtml(text);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = w.name + '-' + formatDateShort(new Date().toISOString()) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toastKind('已导出「' + w.name + '」', 'ok');
  }

  // ===== 启动 =====
  if (typeof globalThis !== 'undefined') {
    globalThis.__NQ__ = {
      get LEVELS() { return LEVELS; },
      get state() { return state; },
      set state(v) { state = v; },
      freshState, loadState, saveNow, createWork, deleteWork, switchWork,
      totalWordsOf, doneCountOf, emptyLevels, currentLevel, work,
      mdToWechatHtml, gatherWorkText, gatherCurrentText, wxInline, wxBlock,
      updateWritingCalendar, getCalendarDays, getCalendarIntensity,
      renderCalendar, showCalendarDetail, hideCalendarDetail,
      updateWritingFeedback, inspireHint,
      generateWechatTitle, generateAllTitles, saveTitleHistory,
      getTitleHistory, showTitlePanel, copyTitleToClipboard,
      validateContentForTitleGeneration, renderTitleHistory,
      gatherCurrentText,
      callAI, getApiKey, setApiKey, hasApiKey, showApiSettings, hideApiSettings,
      showSearch, hideSearch, performSearch, searchInWork,
      showShowcase, hideShowcase, renderShowcase, workStats,
      openReader, hideReader, exportAllShowcase,
      showDedai, hideDedai, runDedaiDetect, runDedaiRewrite,
      applyDedaiResult, showDetectResult,
      detectAiFlavor, dedaiLocal, dedaiUltimate, postProcessText, splitLongSentences, polishHuman, deduplicateText, removeEmDashes,
      showPaidModal, hidePaidModal, savePaidSettings, updatePaidRow, updatePaidPreview,
      nqDialog, nqAlert, nqConfirm,
      formatNovelText,
    };
  }
  
  // ===== 日历渲染 =====
  function renderCalendar() {
    const w = work();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    
    const days = getCalendarDays(w.id, year, month);
    const heatmap = document.getElementById('calendar-heatmap');
    
    if (!days || days.length === 0) {
      heatmap.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 10px;">还没有写作记录</div>';
      return;
    }
    
    let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:8px;">';
    
    // 星期标题
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(d => {
      html += `<div style="text-align:center;font-size:10px;color:var(--muted);">${d}</div>`;
    });
    
    // 日期
    days.forEach(day => {
      if (!day) {
        html += '<div style="height:20px;"></div>';
      } else {
        const intensity = getCalendarIntensity(day.words);
        const colorClass = intensity === 0 ? 'var(--muted)' : 
                          intensity === 1 ? 'var(--accent)' : 
                          intensity === 2 ? 'var(--warn)' : 
                          intensity === 3 ? '#10b981' : '#059669';
        const borderColor = intensity >= 2 ? 'rgba(255,255,255,0.3)' : 'transparent';
        
        html += `<div style="height:20px;background-color:${colorClass};opacity:${intensity * 0.15};border:1px solid ${borderColor};border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${intensity >= 2 ? '#111' : 'var(--text)'};cursor:pointer;transition:transform 0.1s;" data-date="${day.date}" onclick="if (window.__NQ__ && window.__NQ__.showCalendarDetail) { window.__NQ__.showCalendarDetail('${day.date}', {words: ${day.words}, chapters: ${day.chapters}, todos: ${day.todos}}); }" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${day.day}</div>`;
      }
    });
    
    html += '</div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding:0 5px;">';
    html += `<span>${year}年${month}月</span><span>${w.name}</span></div>`;
    
    // 图例
    html += '<div style="display:flex;gap:12px;margin-top:8px;padding:8px;background:var(--panel-2);border-radius:6px;font-size:10px;color:var(--muted);">';
    html += '<div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;background:var(--muted);border-radius:2px;"></div> 0</div>';
    html += '<div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;background:var(--accent);border-radius:2px;opacity:0.15;"></div> 1-199字</div>';
    html += '<div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;background:var(--warn);border-radius:2px;opacity:0.15;"></div> 200-399字</div>';
    html += '<div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;background:#10b981;border-radius:2px;opacity:0.15;"></div> 400-799字</div>';
    html += '<div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;background:#059669;border-radius:2px;opacity:0.15;"></div> 800+字</div>';
    html += '</div>';
    
    heatmap.innerHTML = html;
  }
  
  // ===== 事件绑定 =====
  document.addEventListener('DOMContentLoaded', () => {
    bind();
    render();
    updateStorage();
    
    // 初始化日历
    setTimeout(() => {
      renderCalendar();
    }, 100);
    
    // 日历弹窗事件
    document.getElementById('calendar-modal-close').addEventListener('click', hideCalendarDetail);
    document.getElementById('calendar-modal-ok').addEventListener('click', hideCalendarDetail);
    document.getElementById('calendar-modal-bg').addEventListener('click', e => {
      if (e.target.id === 'calendar-modal-bg') hideCalendarDetail();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideCalendarDetail();
    });
    
    // 点击日历单元格显示详情
    document.addEventListener('click', e => {
      const cell = e.target.closest('#calendar-heatmap > div > div');
      if (cell) {
        const dayText = cell.textContent;
        const dateStr = cell.getAttribute('data-date');
        if (dayText && dateStr) {
          const w = work();
          const data = getCalendarDays(w.id, new Date(dateStr).getFullYear(), new Date(dateStr).getMonth() + 1).find(d => d && d.date === dateStr) || { words: 0, chapters: 0, todos: 0 };
          showCalendarDetail(dateStr, data);
        }
      }
    });
  });
})();
