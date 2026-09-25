/* 校园跑章法器 —— 核心计算逻辑（纯函数，浏览器与 Node.js 通用） */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CampusRunCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MS_PER_DAY = 86400000;

  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  // 归一化为本地日期的 0 点，规避时分秒与夏令时对天数计算的影响
  function dateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // b - a 的整天数（b 晚于 a 为正）
  function diffDays(a, b) {
    return Math.round((dateOnly(b) - dateOnly(a)) / MS_PER_DAY);
  }

  function addDays(d, n) {
    var r = dateOnly(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  // 解析 'YYYY-MM-DD' 为本地 0 点 Date；非法日期返回 null
  function parseDate(str) {
    if (typeof str !== 'string') return null;
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var day = Number(m[3]);
    var dt = new Date(y, mo - 1, day);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) {
      return null;
    }
    return dt;
  }

  function toDateKey(d) {
    var y = d.getFullYear();
    var mo = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + mo + '-' + day;
  }

  // 剩余天数（截止当天为 0 天，已过期按 0 计）
  function daysUntil(deadline, today) {
    return Math.max(0, diffDays(today, deadline));
  }

  /**
   * 计算完整计划
   * @param {number} target     目标次数
   * @param {number} completed  已完成次数
   * @param {Date}   deadline   截止日期（本地 0 点）
   * @param {number} maxPerWeek 每周希望的最大次数
   * @param {Date}   today      今天（本地 0 点）
   * @returns {object}
   */
  function calcPlan(target, completed, deadline, maxPerWeek, today) {
    target = clamp(Math.round(Number(target) || 0), 0, 100000);
    completed = clamp(Math.round(Number(completed) || 0), 0, target);
    maxPerWeek = Math.max(1, Math.round(Number(maxPerWeek) || 0));

    var remaining = target - completed;
    var daysLeft = Math.max(0, diffDays(today, deadline));
    var weeksLeft = daysLeft / 7;

    var requiredPerWeek = 0;
    if (remaining > 0 && weeksLeft > 0) {
      requiredPerWeek = remaining / weeksLeft;
    } else if (remaining > 0) {
      requiredPerWeek = Infinity; // 已到期仍有剩余
    }

    // 以「每周最多 maxPerWeek 次」倒推理想起始点，估算当前应完成次数
    var weeksNeeded = Math.ceil(target / maxPerWeek);
    var plannedStart = addDays(deadline, -weeksNeeded * 7);
    var totalDays = weeksNeeded * 7;
    var expectedCompleted = 0;
    var elapsed = diffDays(plannedStart, today);
    if (elapsed > 0) {
      expectedCompleted = clamp(Math.round(target * Math.min(totalDays, elapsed) / totalDays), 0, target);
    }

    var status;
    if (remaining <= 0) {
      status = 'done';
    } else if (daysLeft <= 0) {
      status = 'overdue';
    } else if (completed > expectedCompleted) {
      status = 'ahead';
    } else if (completed === expectedCompleted) {
      status = 'onTrack';
    } else {
      status = 'behind';
    }

    return {
      target: target,
      completed: completed,
      remaining: remaining,
      daysLeft: daysLeft,
      weeksLeft: weeksLeft,
      requiredPerWeek: requiredPerWeek,
      expectedCompleted: expectedCompleted,
      status: status
    };
  }

  return {
    clamp: clamp,
    dateOnly: dateOnly,
    diffDays: diffDays,
    addDays: addDays,
    parseDate: parseDate,
    toDateKey: toDateKey,
    daysUntil: daysUntil,
    calcPlan: calcPlan
  };
});
