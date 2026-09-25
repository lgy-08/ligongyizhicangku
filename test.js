/* 校园跑章法器 —— 日期计算与边界条件测试（node test.js 运行） */
'use strict';

var assert = require('node:assert/strict');
var Core = require('./core.js');

var pass = 0;
var fail = 0;

function d(s) {
  var p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    console.log('  ✗ ' + name);
    console.log('      ' + e.message);
  }
}

console.log('核心函数');
check('clamp 夹取到范围内', function () {
  assert.equal(Core.clamp(5, 0, 10), 5);
  assert.equal(Core.clamp(-3, 0, 10), 0);
  assert.equal(Core.clamp(99, 0, 10), 10);
});

check('parseDate 解析合法日期', function () {
  var dt = Core.parseDate('2026-12-25');
  assert.equal(dt.getFullYear(), 2026);
  assert.equal(dt.getMonth(), 11);
  assert.equal(dt.getDate(), 25);
});

check('parseDate 拒绝非法日期（2026-02-30）', function () {
  assert.equal(Core.parseDate('2026-02-30'), null);
  assert.equal(Core.parseDate('abc'), null);
  assert.equal(Core.parseDate(''), null);
});

check('diffDays 跨月计算整天数', function () {
  assert.equal(Core.diffDays(d('2026-09-24'), d('2026-10-01')), 7);
  assert.equal(Core.diffDays(d('2026-10-01'), d('2026-09-24')), -7);
});

check('daysUntil 截止当天为 0，过期按 0', function () {
  assert.equal(Core.daysUntil(d('2026-09-24'), d('2026-09-24')), 0);
  assert.equal(Core.daysUntil(d('2026-09-20'), d('2026-09-24')), 0);
  assert.equal(Core.daysUntil(d('2026-10-29'), d('2026-09-24')), 35);
});

console.log('计划计算');
check('基础：剩余 25，剩余 35 天，每周至少 5 次', function () {
  var p = Core.calcPlan(50, 25, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(p.remaining, 25);
  assert.equal(p.daysLeft, 35);
  assert.equal(p.weeksLeft, 5);
  assert.equal(p.requiredPerWeek, 5);
});

check('进度判断：领先 / 正常 / 落后', function () {
  // maxPerWeek=7 → 需 8 周(56天)，理想起点 09-03，今天 09-24 已过 21 天
  var ahead = Core.calcPlan(50, 25, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(ahead.expectedCompleted, 19);
  assert.equal(ahead.status, 'ahead');

  var on = Core.calcPlan(50, 19, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(on.status, 'onTrack');

  var behind = Core.calcPlan(50, 18, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(behind.status, 'behind');
});

check('未到理想起点时 expected=0，已完成 0 为正常', function () {
  var p = Core.calcPlan(50, 0, d('2026-10-29'), 7, d('2026-08-30'));
  assert.equal(p.expectedCompleted, 0);
  assert.equal(p.status, 'onTrack');
});

check('全部完成 → done，剩余为 0', function () {
  var p = Core.calcPlan(50, 50, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(p.status, 'done');
  assert.equal(p.remaining, 0);
  assert.equal(p.requiredPerWeek, 0);
});

check('截止已过且有剩余 → overdue，每周至少为 Infinity', function () {
  var p = Core.calcPlan(50, 10, d('2026-09-20'), 7, d('2026-09-24'));
  assert.equal(p.daysLeft, 0);
  assert.equal(p.status, 'overdue');
  assert.equal(p.requiredPerWeek, Infinity);
});

check('completed 超过 target 被夹取到 target', function () {
  var p = Core.calcPlan(50, 60, d('2026-10-29'), 7, d('2026-09-24'));
  assert.equal(p.completed, 50);
  assert.equal(p.status, 'done');
});

check('maxPerWeek 为 0 或负数时按 1 兜底，不崩溃', function () {
  var p = Core.calcPlan(50, 10, d('2026-10-29'), 0, d('2026-09-24'));
  assert.equal(p.status === 'behind' || p.status === 'ahead' || p.status === 'onTrack', true);
  assert.ok(Number.isFinite(p.requiredPerWeek));
});

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
if (fail > 0) process.exit(1);
