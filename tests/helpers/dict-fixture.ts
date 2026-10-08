import { Dictionary, type DictFile } from '../../src/dict/dictionary';

/** Small hand-made dictionary in the same shape as public/dict/ecdict-lite.json. */
export const FIXTURE_DICT_FILE: DictFile = {
  format: 'lingualens-dict',
  version: 1,
  source: 'test fixture',
  count: 12,
  entries: [
    ['run', 'rʌn', 'v. 跑\\nn. 跑步', 'zk gk', 300],
    ['running', "'rʌniŋ", 'n. 赛跑', 'gk', 3200],
    ['go', 'gәu', 'v. 去', 'zk', 50],
    ['mouse', 'maus', 'n. 老鼠', 'zk', 2800],
    ['walk', 'wɔ:k', 'v. 走', 'zk', 900],
    ['stop', 'stɔp', 'v. 停止', 'zk', 600],
    ['make', 'meik', 'v. 制作', 'zk', 70],
    ['study', "'stʌdi", 'v. 学习', 'zk', 500],
    ['box', 'bɔks', 'n. 盒子', 'zk', 2500],
    ['leave', 'li:v', 'v. 离开', 'zk', 400],
    ['left', 'left', 'a. 左边的', 'zk', 450],
    ['serendipity', ',serәn\'dipiti', 'n. 意外发现珍奇事物的本领', '', 30000],
  ],
  forms: {
    running: 'run',
    ran: 'run',
    runs: 'run',
    went: 'go',
    gone: 'go',
    mice: 'mouse',
    left: 'leave',
  },
};

export const fixtureDict = () => new Dictionary(FIXTURE_DICT_FILE);
