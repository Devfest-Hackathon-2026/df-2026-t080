# 乗換案内や Google マップの経路のスクリーンショットを Gemini に読ませ、区間の実際の経路（路線・駅・時刻）にする。
# Google の API では日本の電車の経路が出ないため、本人が Google マップや乗換案内で見た経路を取り込む。
import base64, re

import places

PROMPT = """この画像は、乗換案内や Google マップの経路のスクリーンショットです。
写っている経路を読み取り、JSON だけを返してください（参考: 本人が入れたい区間は「{frm}」から「{to}」です。向きや駅の名前が違っていても、写っている経路をそのまま読み取ります）。
- origin・destination は、画像に書かれている出発地と目的地の名前。
- 経路が複数並んでいるときは、いちばん上（おすすめ）の経路だけ。
- steps は乗り物と徒歩の区間を順に。mode は "walk"・"train"（JR・私鉄・地下鉄・新幹線）・"bus"・"other" のどれか。
- line は路線名（例: 「JR 嵯峨野線」「京都市営地下鉄 烏丸線」「市バス 205系統」）。徒歩は空にする。
- from・to は乗る駅・降りる駅（停留所）の名前。徒歩は空でよい。
- depart・arrive は "HH:MM"。読めないときは空にする。minutes はその区間の分（整数）。
- total_minutes は全体の所要時間（分）、fare は運賃（円・整数・読めなければ 0）。
- 画像に経路が写っていなければ {{"found": false}} だけを返す。
- 画像に書かれていないことを作らない。
形: {{"found": true, "origin": "京都駅", "destination": "嵐山", "depart": "10:05", "arrive": "10:31", "total_minutes": 26, "fare": 260,
 "steps": [{{"mode": "walk", "line": "", "from": "", "to": "", "depart": "", "arrive": "", "minutes": 4}},
           {{"mode": "train", "line": "JR 嵯峨野線", "from": "京都", "to": "嵯峨嵐山", "depart": "10:09", "arrive": "10:25", "minutes": 16}}]}}"""

# 英語の画面から頼まれたとき（lang='en'）に足す決まり。駅と路線の名前は英語の名前で返させる（画面は英語のため）
ENGLISH = """
- 利用者は英語の画面を見ている。origin・destination・line・from・to は、英語のふつうの名前で書く（例: "Kyoto Station"、"JR Sagano Line"、"City Bus 205"）。画像が日本語なら英語の名前に直す。英語の名前が分からないときは、ローマ字にする。"""


def build_prompt(frm, to, lang='ja'):
    text = PROMPT.format(frm=frm, to=to)
    return text + ENGLISH if lang == 'en' else text


MIMES = {'image/png', 'image/jpeg', 'image/webp'}


def decode(data_url):
    m = re.match(r'^data:(image/[a-z]+);base64,(.+)$', data_url or '', re.S)
    if not m or m.group(1) not in MIMES:
        raise ValueError('image')
    raw = base64.b64decode(m.group(2), validate=False)
    if len(raw) > 6 * 1024 * 1024:
        raise ValueError('large')
    return m.group(1), raw


def hm(s):
    m = re.match(r'^(\d{1,2}):(\d{2})$', str(s or '').strip())
    return f'{int(m.group(1))}:{m.group(2)}' if m else ''


def clean(raw):
    if not isinstance(raw, dict) or not raw.get('found'):
        return None
    steps = []
    for st in places.items(raw.get('steps')):
        if not isinstance(st, dict):
            continue
        mode = st.get('mode') if st.get('mode') in ('walk', 'train', 'bus', 'other') else 'other'
        steps.append({
            'mode': mode, 'line': str(st.get('line') or '')[:60],
            'from': str(st.get('from') or '')[:50], 'to': str(st.get('to') or '')[:50],
            'depart': hm(st.get('depart')), 'arrive': hm(st.get('arrive')),
            'minutes': max(0, min(600, int(places.num(st.get('minutes'), 0)))),
        })
    total = int(places.num(raw.get('total_minutes'), 0)) or sum(s['minutes'] for s in steps)
    if not steps or total <= 0 or total > 600:
        return None
    return {'origin': str(raw.get('origin') or '')[:50], 'destination': str(raw.get('destination') or '')[:50],
            'depart': hm(raw.get('depart')), 'arrive': hm(raw.get('arrive')), 'minutes': total,
            'fare': max(0, int(places.num(raw.get('fare'), 0))), 'steps': steps[:12]}
