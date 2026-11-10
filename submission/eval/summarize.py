# results-saved.json と results-none.json を集計して summary.json と表（tables.md）を書く。
# B 群（場所を固定）は希望の札でプランが変わらないので、希望なしの 24 通りだけを数える。
import json
import statistics as st
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
WORD = {'shorter': '減らせます', 'zero': '0分です', 'same': '同じくらい', 'longer': '長くなります', 'usualLate': 'よくある回り方が帰る時刻に間に合わない', 'usualClosed': 'よくある回り方は閉まる時刻を過ぎる'}
DAY = {'holiday': '休日', 'weekday': '平日'}


def hm(m):
    return f'{m // 60}:{m % 60:02d}'


def counted(rows):
    return [r for r in rows if not (r['group'] == 'B' and r['conds'])]


def stats(rows):
    if not rows:
        return None
    diffs = [r['diff'] for r in rows]
    c = Counter(r['verdict'] for r in rows)
    return {
        'n': len(rows),
        'plan_mean': round(st.mean(r['planCrowded'] for r in rows), 1),
        'usual_mean': round(st.mean(r['usualCrowded'] for r in rows), 1),
        'diff_mean': round(st.mean(diffs), 1),
        'diff_median': st.median(diffs),
        'better': c['shorter'] + c['zero'],
        'same': c['same'],
        'same_both0': sum(1 for r in rows if r['verdict'] == 'same' and r['planCrowded'] == 0 and r['usualCrowded'] == 0),
        'worse': c['longer'],
        'usual_late': c['usualLate'],
        'usual_closed': c['usualClosed'],
        'diff_pos': sum(1 for d in diffs if d > 0),
        'diff_zero': sum(1 for d in diffs if d == 0),
        'diff_neg': sum(1 for d in diffs if d < 0),
        'plan0': sum(1 for r in rows if r['planCrowded'] == 0),
        'share_mean': round(st.mean(r['planCrowded'] / r['stayTotal'] for r in rows) * 100, 1),
    }


def label(r):
    conds = '+'.join(r['conds']) if r['conds'] else '希望なし'
    if r['group'] == 'B':
        return f"{r['note']}"
    extra = f"・{r['note']}" if r.get('note') else ''
    return f'{conds}{extra}'


def lunch_odd(r):
    out = []
    for s in r['plan']:
        if s['slot'] == 'lunch':
            h, m = map(int, s['arrive'].split(':'))
            if not (11 * 60 <= h * 60 + m <= 13 * 60 + 30):
                out.append(s['arrive'])
    return out


summary = {}
md = []
for table in ['saved', 'none']:
    d = json.loads((HERE / f'results-{table}.json').read_text())
    rows = counted(d['rows'])
    by = {}
    for g in ['A', 'A2', 'B', 'EX']:
        by[g] = stats([r for r in rows if r['group'] == g])
    by['all'] = stats(rows)
    for day in ['holiday', 'weekday']:
        by[f'A-{day}'] = stats([r for r in rows if r['group'] == 'A' and r['day'] == day])
        by[f'B-{day}'] = stats([r for r in rows if r['group'] == 'B' and r['day'] == day])
    for start in [450, 540, 600, 720]:
        by[f'A-start{start // 60}:{start % 60:02d}'] = stats([r for r in rows if r['group'] == 'A' and r['start'] == start])
    for end in [900, 1080]:
        by[f'A-end{end // 60}'] = stats([r for r in rows if r['group'] == 'A' and r['end'] == end])
    by['A-with有名'] = stats([r for r in rows if r['group'] == 'A' and '有名' in r['conds']])
    by['A-without有名'] = stats([r for r in rows if r['group'] == 'A' and '有名' not in r['conds']])
    cf = d.get('cf') or []
    rid = {r['id']: r for r in d['rows']}
    if cf:
      by['cf'] = {
        'n': len(cf),
        'app_plan_mean': round(st.mean(rid[x['id']]['planCrowded'] for x in cf), 1),
        'app_diff_mean': round(st.mean(rid[x['id']]['diff'] for x in cf), 1),
        'app_better': sum(1 for x in cf if rid[x['id']]['verdict'] in ('shorter', 'zero')),
        'noicon_plan_mean': round(st.mean(x['planCrowded'] for x in cf), 1),
        'noicon_diff_mean': round(st.mean(x['diff'] for x in cf), 1),
        'noicon_better': sum(1 for x in cf if x['verdict'] in ('shorter', 'zero')),
        'app_famous_mean': round(st.mean(rid[x['id']]['famousSights'] for x in cf), 2),
        'noicon_famous_mean': round(st.mean(x['famousSights'] for x in cf), 2),
    }
    by['lunch_outside_11_1330'] = [(r['id'], lunch_odd(r)) for r in rows if lunch_odd(r)]
    summary[table] = by

    md.append(f'\n### 表{"あり（画面と同じ）" if table == "saved" else "なし（式で見積もり）"}・{len(rows)} 通り\n')
    md.append('| 群 | 条件 | 曜日 | 出発 | 場所 | IntenTrip | よくある回り方 | 差 | 画面の言い方 |')
    md.append('|---|---|---|---|---|---:|---:|---:|---|')
    for r in rows:
        md.append(f"| {r['group']} | {label(r)} | {DAY[r['day']]} | {hm(r['start'])} | {r['stops']} | {r['planCrowded']}分 | {r['usualCrowded']}分 | {r['diff']:+d} | {WORD[r['verdict']]} |")

(HERE / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1))
(HERE / 'tables.md').write_text('# 条件ごとの全部の結果（summarize.py が書いた）\n\n差＝よくある回り方 − IntenTrip（正なら IntenTrip の方が短い）。B は場所を固定した比べ（希望の札は結果を変えないので希望なしだけ）。\n' + '\n'.join(md) + '\n')
for t in summary:
    print('=====', t)
    for k, v in summary[t].items():
        print(k, v)
