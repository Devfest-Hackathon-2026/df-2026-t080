# 試験用の偽の Gemini（app.py の ZT_LLM_MODULE に渡す）。呼ばれた回数を数え、決まった答えを返す
import json

CALLS = []


def ask(prompt, model=''):
    CALLS.append(prompt[:40])
    if '"lines"' in prompt:
        return json.dumps({'lines': ['（試験）ペンギンの一言の 1 行目です。', '（試験）ペンギンの一言の 2 行目です。']})
    return json.dumps({'text': '格子戸の向こうを見てみよう', 'reply': '今回はプランを変えられませんでした。', 'ops': [], 'places': []})


def ask_image(prompt, raw, mime, model=''):
    CALLS.append('image')
    return json.dumps({})


def quota():
    return None
