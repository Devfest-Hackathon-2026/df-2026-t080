# 試験と画面の試し用の偽の Gemini（app.py の ZT_LLM_MODULE に渡す）。
# 頼みの「出発地:」「到着地:」の行（places.trip_prompt_area）から位置を読み、その 2 点の間とまわりに作り物の候補を散らして返す。
# 前の形の頼み（エリアの名前だけ）には、京都駅のまわりの候補を返す。
# ZT_FAKE_SHIFT=1 のときは、エリアの中心と候補の経度を 4 度ずらして返す（Gemini が経度を取り違えたときの形）
import hashlib, json, os, re

CALLS = []
POINT = re.compile(r'^(出発地|到着地): .*?北緯 ([0-9.]+)・東経 ([0-9.]+)', re.M)
KINDS = [('sight', 'famous', '寺'), ('sight', 'hidden', '庭園'), ('street', 'hidden', '通り'), ('sight', 'hidden', '公園'),
         ('food', 'hidden', 'そば'), ('food', 'famous', '食堂'), ('cafe', 'hidden', '喫茶'), ('sight', 'famous', '神社')]
HOURS = {'sight': ('09:00', '17:00'), 'street': ('00:00', '24:00'), 'food': ('11:00', '21:00'), 'cafe': ('10:00', '18:00')}


def _points(prompt):
    got = {k: (float(a), float(b)) for k, a, b in POINT.findall(prompt)}
    s = got.get('出発地', (34.9853, 135.7588))
    return s, got.get('到着地', s)


def _kind(prompt, i):
    head = prompt.split('\n', 1)[0]                # 決まりの文にも「食事の店」があるので、頼みの 1 行目だけで見分ける
    if '食事の店' in head:
        return ('food', 'hidden' if i % 2 else 'famous', '食堂')
    if 'カフェ' in head:
        return ('cafe', 'hidden', '喫茶')
    return KINDS[i % len(KINDS)]


def ask(prompt, model=''):
    CALLS.append(prompt[:40])
    (sa, so), (ea, eo) = _points(prompt)
    tag = hashlib.sha1(prompt.encode()).hexdigest()[:4]
    shift = 4.0 if os.environ.get('ZT_FAKE_SHIFT') == '1' else 0.0
    out = []
    for i in range(8):
        t = (i + 0.5) / 8
        side = (((i * 37) % 11) - 5) / 5 * 0.006
        kind, role, word = _kind(prompt, i)
        op, cl = HOURS[kind]
        out.append({
            'name': f'作り物の{word} {tag}{i}', 'name_ja': f'作り物の{word} {tag}{i}', 'kind': kind, 'role': role,
            'district': '北' if i % 2 else '南', 'lat': round(sa + (ea - sa) * t + side, 5), 'lng': round(so + (eo - so) * t - side - shift, 5),
            'stay': 40, 'open': op, 'close': cl, 'popularity': 3 + i % 3, 'best': 'any', 'tags': ['静か'] if i % 3 == 0 else [],
            'crowd': [1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0], 'weekday_drop': 1,
            'why': '作り物の候補です。', 'downside': '作り物の注意です。', 'basis': '作り物の根拠です。',
        })
    return json.dumps({
        'area': {'name': '作り物のエリア', 'lat': round((sa + ea) / 2, 5), 'lng': round((so + eo) / 2 - shift, 5), 'radius_km': 2},
        'start': {'name': '作り物の駅', 'lat': 35.0, 'lng': 135.0}, 'districts': ['北', '南'],
        'conditions': [], 'places': out,
    }, ensure_ascii=False)


def ask_image(prompt, raw, mime, model=''):
    CALLS.append('image')
    return json.dumps({})


def quota():
    return None
