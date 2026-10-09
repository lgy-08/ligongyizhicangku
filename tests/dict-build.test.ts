import { describe, expect, it } from 'vitest';
import { compactTranslation, parseCsv, parseExchange, selectEntries } from '../scripts/dict-lib.mjs';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and newlines inside quotes', () => {
    const csv = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', ''],
    ]);
  });
  it('handles a last line without newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseExchange', () => {
  it('parses ECDICT exchange strings', () => {
    expect(parseExchange('0:run/1:i/i:running')).toEqual({ '0': 'run', '1': 'i', i: 'running' });
    expect(parseExchange('')).toEqual({});
  });
});

describe('compactTranslation', () => {
  it('splits literal \\n, drops [网络] lines, limits to 4 lines', () => {
    expect(compactTranslation('n. 罩\\nv. 覆盖\\n[网络] 胡德')).toBe('n. 罩\nv. 覆盖');
    expect(compactTranslation('1\\n2\\n3\\n4\\n5').split('\n')).toHaveLength(4);
  });
});

const HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';
const csvRows = (lines: string[]) => parseCsv([HEADER, ...lines].join('\n'));

describe('selectEntries', () => {
  it('keeps common/tagged lowercase words and builds form -> lemma mappings', () => {
    const rows = csvRows([
      'run,rʌn,,"v. 跑",,5,1,zk,300,250,p:ran/i:running/3:runs,,',
      'running,rʌniŋ,,"n. 赛跑",,,,gk,3200,3000,0:run/1:i,,',
      'ran,ræn,,"v. 跑(过去式)",,,,,0,0,0:run/1:p,,',
      'Hague,heig,,"海牙",,,,,0,0,,,',
      'obscureword,x,,"罕见词",,,,,0,90000,,,',
      'nodef,x,,,,,,zk,10,10,,,',
    ]);
    const { entries, forms } = selectEntries(rows);
    expect(entries.map((e) => e[0])).toEqual(['run', 'running']);
    expect(forms).toEqual({ ran: 'run', running: 'run', runs: 'run' });
    expect(entries[0]).toEqual(['run', 'rʌn', 'v. 跑', 'zk', 250]);
  });
  it('keeps phrases made of common words, drops technical terms, long phrases and rare words', () => {
    const rows = csvRows([
      'give,giv,,"v. 给",,5,1,zk,80,80,,,',
      'up,ap,,"adv. 向上",,5,1,zk,50,50,,,',
      'zinc,zink,,"n. 锌",,1,,cet6,9000,9500,,,',
      'oxide,oksaid,,"n. 氧化物",,1,,cet6,9800,9900,,,',
      'quark,kwork,,"n. 夸克",,,,toefl,25000,26000,,,',
      'give up,,,"放弃, 停止\\n[法] 交出",,,,,0,0,,,',
      'zinc oxide,,,"[化] 氧化锌",,,,,0,0,,,',
      'give up quark,,,"测试",,,,,0,0,,,',
      'up up up up up up,,,"太长",,,,,0,0,,,',
    ]);
    const { entries, stats } = selectEntries(rows);
    const phraseEntries = entries.filter((e) => e[0].includes(' '));
    expect(phraseEntries).toEqual([['give up', '', '放弃, 停止', '', 0]]); // technical line removed
    expect(stats).toMatchObject({ words: 5, phrases: 1 });
  });

  it('fails clearly when a column is missing', () => {
    expect(() => selectEntries(parseCsv('word,phonetic\nrun,x'))).toThrow(/column "translation" not found/);
  });
});
