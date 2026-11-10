# 条件ごとの結果の表（セルは「IntenTrip/よくある回り方 画面の言い方」）を matrix.md に書き出す
import json
from pathlib import Path
HERE = Path(__file__).parent
V = {'shorter': '減', 'zero': '減(0分)', 'same': '同', 'longer': '長', 'usualLate': '比べ相手が間に合わない', 'usualClosed': '比べ相手が閉まる時刻を過ぎる'}
SUB = [[], ['有名'], ['静か'], ['有名', '静か']]
hm = lambda m: f"{m // 60}:{m % 60:02d}"
DAY = {'holiday': '休', 'weekday': '平'}
out = []
for table in ['saved', 'none']:
    d = json.loads((HERE / f'results-{table}.json').read_text())
    rows = d['rows']
    tb = 'あり' if table == 'saved' else 'なし'
    cell = lambda r: f"{r['planCrowded']}/{r['usualCrowded']} {V[r['verdict']]}"
    for end in [900, 1080]:
        out.append(f"\n#### A おまかせ（時刻表の目安{tb}）・帰る時刻 {hm(end)}\n")
        cols = [(day, s) for day in ['holiday', 'weekday'] for s in [450, 540, 600, 720]]
        out.append('| 希望の札 | ' + ' | '.join(f"{DAY[d0]} {hm(s)}" for d0, s in cols) + ' |')
        out.append('|---|' + '---|' * len(cols))
        for c in SUB:
            line = [cell(next(r for r in rows if r['group'] == 'A' and r['conds'] == c and r['day'] == day and r['start'] == s and r['end'] == end)) for day, s in cols]
            out.append(f"| {'+'.join(c) or '希望なし'} | " + ' | '.join(line) + ' |')
    out.append(f"\n#### A2 回り方の設定（時刻表の目安{tb}）・休日\n")
    out.append('| 設定 | 希望の札 | 場所 | 結果 |')
    out.append('|---|---|---:|---|')
    for r in rows:
        if r['group'] == 'A2':
            out.append(f"| {r['note']} | {'+'.join(r['conds']) or '希望なし'} | {r['stops']} | {cell(r)} |")
    out.append(f"\n#### B 同じ場所の並びだけ（時刻表の目安{tb}）・昼食は手打ちそば 花もも・帰る時刻 18:00\n")
    cols = [(day, s) for day in ['holiday', 'weekday'] for s in [540, 600]]
    out.append('| 行きたい場所 | ' + ' | '.join(f"{DAY[d0]} {hm(s)}" for d0, s in cols) + ' |')
    out.append('|---|' + '---|' * len(cols))
    for note in dict.fromkeys(r['note'] for r in rows if r['group'] == 'B'):
        line = [cell(next(r for r in rows if r['group'] == 'B' and r['note'] == note and r['day'] == day and r['start'] == s)) for day, s in cols]
        out.append(f"| {note} | " + ' | '.join(line) + ' |')
    out.append(f"\n#### EX 例の 4 か所を選んで組む（時刻表の目安{tb}）・帰る時刻 15:00（12:00 発は 18:00）\n")
    out.append('| 曜日 | ' + ' | '.join(hm(s) for s in [450, 540, 600, 720]) + ' |')
    out.append('|---|---|---|---|---|')
    for day in ['holiday', 'weekday']:
        line = [cell(next(r for r in rows if r['group'] == 'EX' and r['day'] == day and r['start'] == s)) for s in [450, 540, 600, 720]]
        out.append(f"| {DAY[day]} | " + ' | '.join(line) + ' |')
(HERE / 'matrix.md').write_text('\n'.join(out) + '\n')
print('\n'.join(out))
