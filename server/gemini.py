# Gemini を呼ぶ部品（Vertex AI・公式の google-genai）。
# 設定は環境変数で行う:
#   GOOGLE_GENAI_USE_VERTEXAI=true
#   GOOGLE_CLOUD_PROJECT=<プロジェクト ID>
#   GOOGLE_CLOUD_LOCATION=global（または asia-northeast1 など）
#   ZT_MODEL=<Vertex AI のモデル一覧にある Gemini のモデル名>
#   ZT_THINKING=LOW（考える量。空にすると指定しない＝モデルの既定。考える量に対応しないモデルでは空にする）
# 認証は Application Default Credentials（Cloud Run ではサービス アカウント、手元では `gcloud auth application-default login`）。
# 手元の開発では、Vertex AI の代わりに自分の Gemini API キー（GEMINI_API_KEY）でも動く（google-genai が環境変数から読む。ルートの .env.example を参照）。
import os
import time

TIMEOUT_MS = int(float(os.environ.get('ZT_TIMEOUT', '300')) * 1000)
# 1 分あたりの上限に当たったとき（429）に、待ってからやり直す秒数
RETRY_WAITS = (3, 8, 15)
THINKING = os.environ.get('ZT_THINKING', 'LOW').strip().upper()

_client = None
# 送る前ごとに呼ぶ係（app.py の Limited が入れる。429 でやり直す分も、1 回ずつ数える）
before_send = None


class Skip(Exception):
    pass


def _config(temperature):
    from google.genai import types
    extra = {'thinking_config': types.ThinkingConfig(thinking_level=THINKING)} if THINKING else {}
    return types.GenerateContentConfig(response_mime_type='application/json', temperature=temperature, **extra)


def _generate(**kw):
    from google.genai import errors
    for wait in (*RETRY_WAITS, None):
        if before_send is not None:
            before_send()
        try:
            return _get_client().models.generate_content(**kw)
        except errors.APIError as e:
            code = getattr(e, 'code', None)
            if code == 429 and wait is not None:
                time.sleep(wait)
                continue
            raise Skip('枠' if code == 429 else f'Gemini の呼び出しに失敗しました（{code if code is not None else "?"}）') from e


def _get_client():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types
        _client = genai.Client(http_options=types.HttpOptions(timeout=TIMEOUT_MS))
    return _client


def ask(prompt, model):
    """prompt を 1 回送り、返事の文字列を返す。JSON で返すよう指定する。"""
    if not model:
        raise Skip('ZT_MODEL を設定してください')
    res = _generate(
        model=model,
        contents=prompt,
        config=_config(0.4),
    )
    if not res.text:
        raise Skip('答えがありません')
    return res.text


def ask_image(prompt, data, mime, model):
    """画像 1 枚と文を送り、返事の文字列を返す（乗換案内のスクリーンショットを読むのに使う）"""
    if not model:
        raise Skip('ZT_MODEL を設定してください')
    from google.genai import types
    res = _generate(
        model=model,
        contents=[types.Part.from_bytes(data=data, mime_type=mime), prompt],
        config=_config(0.1),
    )
    if not res.text:
        raise Skip('答えがありません')
    return res.text


def quota():
    """残りの枠は Vertex AI からは読まない（予算アラートと API の上限で管理する）"""
    return None
