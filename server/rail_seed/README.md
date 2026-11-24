# 同梱の路線と駅のデータ

このフォルダの JSON は、OpenStreetMap の鉄道の路線（relation）と駅（node）の抜粋です。Overpass API から取れないときのフォールバックとして、`server/rail.py` が読み込みます。

- 著作権: © OpenStreetMap contributors（https://www.openstreetmap.org/copyright）
- ライセンス: Open Database License（ODbL）1.0（https://opendatacommons.org/licenses/odbl/1-0/）
- 取得元: Overpass API（取得日は各ファイルの `fetched`）
- 加工: Overpass API の応答から、路線の ID・タグ・構成要素と、駅の位置・名前だけを残した

| ファイル | 範囲（南・西・北・東） |
|---|---|
| `34.60_135.40_34.80_135.60.json` | 大阪の中心部を通る路線と、その駅 |

このデータを再配布するときは、上の著作権の表示を残し、ODbL 1.0 のまま配布してください。
