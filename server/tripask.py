# 泊まりの旅を作る画面で、利用者が書いた 1 行の文から旅のまとめ（行き先・泊数・日付・宿・希望・時刻）を読み取る。
# Gemini には文に書いてある事を拾わせるだけで、場所を探したり、提案を書いたりはさせない。
# 返すのは、今のまとめへの差分（文に無い物は返さない）。
import datetime, json, math, re

NIGHTS_MAX = 3
TEXT_MAX = 300
NAME_MAX = 60
WISH_MAX = 200
DAYS_AHEAD = 366
EARLIEST, LATEST = 5 * 60, 23 * 60 + 55
WEEK = {'ja': '月火水木金土日', 'en': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}

PROMPT = '''あなたは旅行の申し込みの読み取り係です。利用者が書いた文から、泊まりの旅の内容を読み取り、JSON だけを返してください。

今日: {today}（{weekday}）
今のまとめ（これまでに読み取った内容）:
{summary}

利用者が今回書いた文: 「{text}」

返す形（今回の文に書いてある項目だけを入れる。書いていない項目はキーごと省く）:
{{
  "from": "行き先の駅か地名（例: 京都、金沢駅）",
  "nights": 泊数の数（「2泊3日」なら 2。「3日間」なら 2）,
  "date": "出発の日付 YYYY-MM-DD（「来週の土曜」などは今日から数える）",
  "stays": ["1泊目の宿", "2泊目の宿", ...],
  "back": true,
  "end": "最終日に観光を終える場所",
  "wish": "旅全体の希望（利用者の言葉のまま、短く）",
  "days": [{{"wish": "1日目の希望", "start": "HH:MM", "end": "HH:MM"}}, ...],
  "over": true
}}

決まり:
- 書いてある事だけを拾う。書いていない場所・希望・時刻を考えて足さない。提案や説明を書かない。
- stays は泊の順。宿の名前（「ホテルグランヴィア京都」）が書いてあれば、そのまま入れる。宿を地名や駅名で書いてあるときは、地名・駅名だけを入れる（「強羅の旅館」→「強羅」、「奈良駅前のホテル」→「奈良駅」、「祇園のあたり」→「祇園」、「near Gion」→「Gion」）。前の泊と同じ宿の泊は null。「毎晩同じ宿」「ずっと四条」なら 1 つ目だけ入れる。
- 今のまとめを直す文（「やっぱり2泊目は嵐山」「3泊にする」）は、直した項目だけを返す。stays を直すときは、直さない泊も今のまとめの値で埋めて、全部の泊を返す。
- back は、最終日に出発した所へ戻ると、場所として書いてあるとき（「出発した所に戻る」「京都駅に戻る」）だけ true にする。帰る時刻が書いてあるだけ（「6時までに帰りたい」）では back を入れない。
- end は、戻らずに別の場所で観光を終えるときの場所。stays と同じく、施設の名前はそのまま、地名や駅名で書いてあるときは地名・駅名だけを入れる。
- days は日の順。触れていない日は {{}} にする。start はその日に出発する時刻、end はその日の観光を終える（宿に着く・帰る）時刻。「最終日は17時ごろ帰る」は最後の日の end。時刻は 24 時間の HH:MM。
- 特定の日の希望（「2日目は嵐山を回りたい」）は days のその日の wish に、旅全体の希望は wish に入れる。
- 4泊以上を頼まれたら nights を入れず、over を true にする。
- 「日帰り」と書いてあっても、行き先などの書いてある項目は拾う。泊数は入れない。
- 質問や相談（「おすすめの場所を教えて」「どこがいい？」）、まだ決めていないという返事は、どの項目にも入れない。
{lang_rule}'''

LANG_RULE = {
    'ja': '- from・stays・end・wish は、利用者の言葉（日本語）のまま書く。',
    'en': '- The user is reading an English screen. Write from, stays, end, and wish in the user’s words (English if they wrote English). Place names may stay as written.',
}


def today_of(v, now=None):
    """画面が送ってきた今日（YYYY-MM-DD）。サーバーの日付（日本時間）から 1 日より離れていれば、サーバーの日付"""
    now = now or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    mine = now.date()
    got = day_of(v)
    return got if got and abs((got - mine).days) <= 1 else mine


def day_of(v):
    if not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
        return None
    try:
        return datetime.date.fromisoformat(v)
    except ValueError:
        return None


def text_of(v, n):
    if not isinstance(v, str):
        return None
    t = re.sub(r'\s+', ' ', v).strip()
    return t[:n] if t else None


def minutes_of(v):
    if not isinstance(v, str):
        return None
    m = re.fullmatch(r'([01]?\d|2[0-3]):([0-5]\d)', v.strip())
    if not m:
        return None
    t = int(m.group(1)) * 60 + int(m.group(2))
    return t if EARLIEST <= t <= LATEST else None


def count_of(v):
    """泊数の数（整数のときだけ）"""
    if isinstance(v, bool):
        return None
    if isinstance(v, float) and math.isfinite(v) and v == int(v):
        v = int(v)
    return v if isinstance(v, int) else None


def summary_of(s):
    """プロンプトに見せる今のまとめ（知っている項目だけ。字数を切る）"""
    if not isinstance(s, dict):
        return {}
    out = {}
    for k in ('from', 'end', 'wish', 'date'):
        t = text_of(s.get(k), WISH_MAX if k == 'wish' else NAME_MAX)
        if t:
            out[k] = t
    n = count_of(s.get('nights'))
    if n and 1 <= n <= NIGHTS_MAX:
        out['nights'] = n
    if s.get('back') is True:
        out['back'] = True
    stays = s.get('stays')
    if isinstance(stays, list):
        out['stays'] = [text_of(x, NAME_MAX) for x in stays[:NIGHTS_MAX]]
    days = s.get('days')
    if isinstance(days, list):
        out['days'] = [clean_day(d, hm=True) for d in days[:NIGHTS_MAX + 1]]
    return out


def clean_day(d, hm=False):
    """日ごとの希望と時刻。hm: 時刻を HH:MM の字で受け取る（今のまとめは分の数で来る）"""
    if not isinstance(d, dict):
        return {}
    out = {}
    w = text_of(d.get('wish'), WISH_MAX)
    if w:
        out['wish'] = w
    for k in ('start', 'end'):
        v = d.get(k)
        if hm and count_of(v) is not None:
            t = count_of(v)
            if EARLIEST <= t <= LATEST:
                out[k] = f'{t // 60:02d}:{t % 60:02d}'
            continue
        t = minutes_of(v)
        if t is not None:
            out[k] = t if not hm else v.strip()
    return out


def build_prompt(body, today):
    lang = 'en' if body.get('lang') == 'en' else 'ja'
    wd = WEEK[lang][today.weekday()]
    summary = summary_of(body.get('summary'))
    return PROMPT.format(today=today.isoformat(), weekday=wd, summary=json.dumps(summary, ensure_ascii=False) if summary else '（まだ無い）',
                         text=text_of(body.get('text'), TEXT_MAX) or '', lang_rule=LANG_RULE[lang])


def clean(raw, today):
    """Gemini の返事を、まとめへの差分に整える。範囲外・形の違う値は捨てる"""
    if not isinstance(raw, dict):
        return {}
    out = {}
    f = text_of(raw.get('from'), NAME_MAX)
    if f:
        out['from'] = f
    n = count_of(raw.get('nights'))
    if n is not None and n > NIGHTS_MAX:
        out['over'] = True
    elif n is not None and n >= 1:
        out['nights'] = n
    if raw.get('over') is True and 'nights' not in out:
        out['over'] = True
    d = day_of(raw.get('date'))
    if d and 0 <= (d - today).days <= DAYS_AHEAD:
        out['date'] = d.isoformat()
    stays = raw.get('stays')
    if isinstance(stays, list) and stays:
        got = [text_of(x, NAME_MAX) for x in stays[:NIGHTS_MAX]]
        while got and not got[-1]:
            got.pop()
        if any(got):
            out['stays'] = got
    if raw.get('back') is True:
        out['end'] = None
    else:
        e = text_of(raw.get('end'), NAME_MAX)
        if e:
            out['end'] = e
    w = text_of(raw.get('wish'), WISH_MAX)
    if w:
        out['wish'] = w
    days = raw.get('days')
    if isinstance(days, list):
        got = [clean_day(x) for x in days[:NIGHTS_MAX + 1]]
        while got and not got[-1]:
            got.pop()
        if got:
            out['days'] = got
    return out
