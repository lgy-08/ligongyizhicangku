(function () {
  'use strict';

  var Core = window.CampusRunCore;
  var STORAGE_KEY = 'campusRunState_v1';

  var els = {
    statusBadge: document.getElementById('statusBadge'),
    progressText: document.getElementById('progressText'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    remaining: document.getElementById('remaining'),
    hint: document.getElementById('hint'),
    daysLeft: document.getElementById('daysLeft'),
    weeksLeft: document.getElementById('weeksLeft'),
    requiredPerWeek: document.getElementById('requiredPerWeek'),
    plusBtn: document.getElementById('plusBtn'),
    undoBtn: document.getElementById('undoBtn'),
    resetBtn: document.getElementById('resetBtn'),
    saveBtn: document.getElementById('saveBtn'),
    saveMsg: document.getElementById('saveMsg'),
    settingsForm: document.getElementById('settingsForm'),
    target: document.getElementById('target'),
    completed: document.getElementById('completed'),
    deadline: document.getElementById('deadline'),
    maxPerWeek: document.getElementById('maxPerWeek')
  };

  var state = loadState();
  var undoStack = []; // 内存中的撤销栈，保存每次 +1 前的已完成次数
  var resetArmed = false;
  var resetTimer = null;
  var saveMsgTimer = null;

  /* ---------- 状态读写 ---------- */

  function defaultState() {
    return {
      target: 50,
      completed: 0,
      deadline: Core.toDateKey(Core.addDays(new Date(), 90)),
      maxPerWeek: 7
    };
  }

  function toInt(v, dflt) {
    var n = Math.round(Number(v));
    return Number.isFinite(n) ? n : dflt;
  }

  function normalize(s) {
    var d = defaultState();
    var out = {
      target: toInt(s.target, d.target),
      completed: toInt(s.completed, d.completed),
      deadline: (typeof s.deadline === 'string' && Core.parseDate(s.deadline)) ? s.deadline : d.deadline,
      maxPerWeek: toInt(s.maxPerWeek, d.maxPerWeek)
    };
    if (out.target < 1) out.target = 1;
    if (out.completed < 0) out.completed = 0;
    if (out.completed > out.target) out.completed = out.target;
    if (out.maxPerWeek < 1) out.maxPerWeek = 1;
    return out;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 忽略损坏数据 */ }
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 计算与渲染 ---------- */

  function computePlan() {
    var dl = Core.parseDate(state.deadline);
    if (!dl) return null;
    return Core.calcPlan(state.target, state.completed, dl, state.maxPerWeek, new Date());
  }

  var STATUS_TEXT = { done: '已完成', overdue: '已到期', ahead: '进度提前', onTrack: '进度正常', behind: '进度落后' };

  function buildHint(plan) {
    switch (plan.status) {
      case 'done':
        return '目标已全部完成，可以安心休息啦 🎉';
      case 'overdue':
        return '已过截止日期，还差 ' + plan.remaining + ' 次未完成。';
      case 'ahead':
        return '节奏良好，可以维持当前频率。';
      case 'onTrack': {
        var n = Math.max(1, Math.ceil(plan.requiredPerWeek));
        return '进度正常，本周建议再完成 ' + n + ' 次。';
      }
      case 'behind': {
        var m = Math.ceil(plan.requiredPerWeek);
        return '当前存在进度欠账，需要适当提高频率（每周至少 ' + m + ' 次）。';
      }
      default:
        return '—';
    }
  }

  function fmtWeek(n) {
    if (!Number.isFinite(n)) return '—';
    return (Math.round(n * 10) / 10) + ' 周';
  }

  function render() {
    var plan = computePlan();

    // 表单回填
    els.target.value = state.target;
    els.completed.value = state.completed;
    els.deadline.value = state.deadline;
    els.maxPerWeek.value = state.maxPerWeek;

    if (!plan) {
      els.statusBadge.textContent = '—';
      els.statusBadge.className = 'badge';
      els.progressText.textContent = state.completed + ' / ' + state.target + ' 次';
      els.remaining.textContent = state.target - state.completed;
      els.hint.textContent = '请设置有效的截止日期';
      els.daysLeft.textContent = '—';
      els.weeksLeft.textContent = '—';
      els.requiredPerWeek.textContent = '—';
      return;
    }

    var pct = plan.target > 0 ? (plan.completed / plan.target) * 100 : 0;
    pct = Core.clamp(pct, 0, 100);

    els.statusBadge.textContent = STATUS_TEXT[plan.status];
    els.statusBadge.className = 'badge ' + plan.status;
    els.progressText.textContent = plan.completed + ' / ' + plan.target + ' 次';
    els.progressFill.style.width = pct + '%';
    els.progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));

    els.remaining.textContent = plan.remaining;

    if (plan.status === 'done' || plan.status === 'overdue') {
      els.daysLeft.textContent = plan.daysLeft + ' 天';
      els.weeksLeft.textContent = fmtWeek(plan.weeksLeft);
      els.requiredPerWeek.textContent = '—';
    } else {
      els.daysLeft.textContent = plan.daysLeft + ' 天';
      els.weeksLeft.textContent = fmtWeek(plan.weeksLeft);
      els.requiredPerWeek.textContent = Math.ceil(plan.requiredPerWeek) + ' 次/周';
    }

    els.hint.textContent = buildHint(plan);
    els.undoBtn.disabled = undoStack.length === 0;
  }

  /* ---------- 事件 ---------- */

  els.plusBtn.addEventListener('click', function () {
    if (state.completed >= state.target) return;
    undoStack.push(state.completed);
    state.completed += 1;
    saveState();
    render();
  });

  els.undoBtn.addEventListener('click', function () {
    if (undoStack.length === 0) return;
    state.completed = undoStack.pop();
    saveState();
    render();
  });

  els.settingsForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var target = toInt(els.target.value, state.target);
    var completed = toInt(els.completed.value, state.completed);
    var maxPerWeek = toInt(els.maxPerWeek.value, state.maxPerWeek);
    var deadline = els.deadline.value;

    if (target < 1) { flash('目标次数至少为 1'); return; }
    if (maxPerWeek < 1) { flash('每周最多次数至少为 1'); return; }
    if (!Core.parseDate(deadline)) { flash('请填写有效的截止日期'); return; }
    if (completed < 0) completed = 0;
    if (completed > target) completed = target;

    state.target = target;
    state.completed = completed;
    state.maxPerWeek = maxPerWeek;
    state.deadline = deadline;
    undoStack.length = 0;
    saveState();
    render();
    flash('已保存');
  });

  els.resetBtn.addEventListener('click', function () {
    if (!resetArmed) {
      resetArmed = true;
      els.resetBtn.textContent = '再次点击以确认重置';
      els.resetBtn.classList.add('armed');
      resetTimer = setTimeout(disarmReset, 5000);
      return;
    }
    disarmReset();
    state = defaultState();
    undoStack.length = 0;
    saveState();
    render();
    flash('已重置为本学期默认数据');
  });

  function disarmReset() {
    resetArmed = false;
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    els.resetBtn.textContent = '重置学期数据';
    els.resetBtn.classList.remove('armed');
  }

  function flash(msg) {
    els.saveMsg.textContent = msg;
    if (saveMsgTimer) clearTimeout(saveMsgTimer);
    saveMsgTimer = setTimeout(function () { els.saveMsg.textContent = ''; }, 2500);
  }

  /* ---------- 初始化 ---------- */

  render();
})();
