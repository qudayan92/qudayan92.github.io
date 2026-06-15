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
      levels[lvl.id] = { status: idx === 0 ? 'unlocked' : 'locked', content: '' };
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

  function renderSidebar() {
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    const w = work();
    LEVELS.forEach(lvl => {
      const st = w.levels[lvl.id];
      const item = document.createElement('div');
      item.className = 'level' +
        (lvl.id === w.currentLevel ? ' active' : '') +
        (st.status === 'locked' ? ' locked' : '') +
        (st.status === 'done' ? ' done' : '') +
        (lvl.type === 'boss' ? ' boss' : '');
      item.innerHTML =
        '<div class="badge">' + (st.status === 'done' ? '✓' : lvl.id) + '</div>' +
        '<div class="meta">' +
          '<div class="name">' + escapeHtml(lvl.name) + '</div>' +
          '<div class="sub">' + escapeHtml(lvl.sub) + '</div>' +
        '</div>';
      item.addEventListener('click', () => { if (st.status !== 'locked') switchLevel(lvl.id); });
      list.appendChild(item);
    });

    const footer = document.getElementById('level-footer');
    footer.innerHTML =
      '<button class="side-btn" id="btn-rename-work">✎ 重命名作品</button>' +
      '<button class="side-btn danger" id="btn-delete-work">🗑 删除当前作品</button>';
    document.getElementById('btn-rename-work').addEventListener('click', () => renameWork(state.activeWorkId));
    document.getElementById('btn-delete-work').addEventListener('click', () => deleteWork(state.activeWorkId));

    document.getElementById('level-total').textContent = LEVELS.length;
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
    renderTodoPanel();
    renderCalendar();
    updateWritingFeedback();
  }

  // ===== 通关 =====
  function tryComplete() {
    const lvl = currentLevel();
    const st = work().levels[lvl.id];
    const allOk = lvl.targets.every(t => t.test(st.content));
    if (!allOk) { alert('尚未达到通关条件,请检查目标清单。'); return; }
    st.status = 'done';
    const next = LEVELS.find(l => l.id === lvl.id + 1);
    if (next) {
      work().levels[next.id].status = 'unlocked';
      work().currentLevel = next.id;
    }
    scheduleSave();
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

  // ===== AI 续写 (DeepSeek API) =====
  async function callAI(prompt) {
    const apiKey = getApiKey();
    if (!apiKey) {
      return '⚠️ 未配置 API Key，请先点击右上角 ⚙️ 设置 DeepSeek API Key。';
    }

    const systemPrompt = '你是一位才华横溢的中文小说家。根据用户提供的上下文，续写一段精彩的、符合故事逻辑的文字。保持原文的风格和语调，续写300-500字左右。直接输出续写内容，不要加任何前缀说明。';

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
          temperature: 0.8,
          max_tokens: 1024,
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

  function showApiSettings() {
    const modal = document.getElementById('api-settings-modal-bg');
    if (modal) modal.classList.add('open');
    const input = document.getElementById('api-key-input');
    if (input) {
      input.value = getApiKey();
      input.focus();
    }
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
      const tail = (st.content || '').slice(-500);
      const prompt = '关卡:' + lvl.name + '\n\n当前内容末尾:\n' + tail;

      btn.disabled = true;
      btn.textContent = '⏳ AI 续写中…';
      try {
        const out = await callAI(prompt);
        ta.value = (ta.value ? ta.value + '\n\n' : '') + out;
        ta.dispatchEvent(new Event('input'));
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
    const chunks = works.map(w => '# ' + w.name + '\n\n' + (gatherWorkTextOf(w) || '（空）'));
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
          toc.push({ id: lvl.id, type: lvl.type, name: lvl.name, words: lv.content.length });
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
    const text = gatherWorkTextOf(w);
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
    const text = gatherWorkTextOf(w);
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
