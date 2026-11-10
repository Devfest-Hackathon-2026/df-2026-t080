# results-areas.json（8 エリア）を集計して summary-areas.json と areas.md を書く
import json
import statistics as st
from pathlib import Path
HERE = Path(__file__).parent
d = json.loads((HERE / 'results-areas.json').read_text())
rows = d['rows']


def stats(rs):
    n = len(rs)
    pct = [(r['usualCrowded'] - r['planCrowded']) / r['usualCrowded'] * 100 for r in rs if r['usualCrowded'] > 0]
    return {
        'n': n,
        'usual_mean': round(st.mean(r['usualCrowded'] for r in rs), 1),
        'plan_mean': round(st.mean(r['planCrowded'] for r in rs), 1),
        'mean_cut_pct': round((1 - sum(r['planCrowded'] for r in rs) / max(1, sum(r['usualCrowded'] for r in rs))) * 100, 1),
        'median_cut_pct': round(st.median(pct), 1) if pct else None,
        'median_diff': st.median(r['usualCrowded'] - r['planCrowded'] for r in rs),
        'better': sum(r['verdict'] in ('shorter', 'zero') for r in rs),
        'same': sum(r['verdict'] == 'same' for r in rs),
        'both0': sum(r['usualCrowded'] == 0 and r['planCrowded'] == 0 for r in rs),
        'worse': sum(r['verdict'] == 'longer' for r in rs),
        'usual_late': sum(r['verdict'] == 'usualLate' for r in rs),
        'usual_closed': sum(r['verdict'] == 'usualClosed' for r in rs),
        'worse_any': sum(r['planCrowded'] > r['usualCrowded'] for r in rs),
    }


out = {'all': stats(rows)}
for a in dict.fromkeys(r['area'] for r in rows):
    out[a] = stats([r for r in rows if r['area'] == a])
for day in ['holiday', 'weekday']:
    out[f'all-{day}'] = stats([r for r in rows if r['day'] == day])
(HERE / 'summary-areas.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
md = ['# 8 エリアの比べ（summarize_areas.py が書いた）', '', '移動はアプリの式で見積もり（道の表・時刻表の目安なし）。希望なし。各エリア 16 通り（休日・平日 × 出発 8:00・9:00・10:00・12:00 × 帰る時刻 15:00・18:00）。', '',
      '| エリア | 数 | 平均（よくある回り方 → IntenTrip） | 合計で減った割合 | 1 プランごとの減り方の中央値 | 減った | 同じくらい（うち両方 0 分） | 長くなった（画面の判定） | 1 分でも長くなった |', '|---|---:|---|---:|---:|---:|---|---:|---:|']
for k, v in out.items():
    md.append(f"| {k} | {v['n']} | {v['usual_mean']} 分 → {v['plan_mean']} 分 | {v['mean_cut_pct']}% | {v['median_cut_pct']}% | {v['better']} | {v['same']}（{v['both0']}） | {v['worse']} | {v['worse_any']} |")
md += ['', '## 全部の結果', '', '| エリア | 曜日 | 出発 | 帰る | IntenTrip | よくある回り方 | 画面の言い方 |', '|---|---|---|---|---:|---:|---|']
hm = lambda m: f"{m // 60}:{m % 60:02d}"
for r in rows:
    md.append(f"| {r['area']} | {'休日' if r['day'] == 'holiday' else '平日'} | {hm(r['start'])} | {hm(r['end'])} | {r['planCrowded']} 分 | {r['usualCrowded']} 分 | {r['screen']} |")
(HERE / 'areas.md').write_text('\n'.join(md) + '\n')
for k, v in out.items():
    print(k, v)
