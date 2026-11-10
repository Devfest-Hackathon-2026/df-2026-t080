#!/usr/bin/env python3
"""ルートから、画面のビルドとサーバーの起動をまとめて行う（Windows・macOS・Linux 共通）。

使い方:
    python run.py          画面をビルドして、サーバーを起動する（http://localhost:8124）
    python run.py --dev    画面の開発サーバー（http://localhost:5173）とサーバーを同時に起動する
    python run.py --skip-build   ビルド済みの web/dist をそのまま使う

必要なもの: Python 3.9 以上、uv、pnpm（README を参照）
Gemini を使う設定は、ルートの .env に書く（.env.example を .env にコピーして埋める）。
設定しなくても、サンプルデータの表示までは動く。
"""
import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
SERVER = os.path.join(ROOT, 'server')


def need(cmd: str, hint: str) -> str:
    path = shutil.which(cmd)
    if not path:
        sys.exit(f'{cmd} が見つかりません。{hint}')
    return path


def load_env(path: str):
    """ルートの .env を読んで、環境変数に入れる（すでに設定されている値は上書きしない）"""
    if not os.path.isfile(path):
        return
    n = 0
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            key, val = key.strip(), val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in '"\'':
                val = val[1:-1]
            if key and val and key not in os.environ:
                os.environ[key] = val
                n += 1
    print(f'.env から {n} 件の設定を読みました', flush=True)


def run(args, cwd):
    shown = [os.path.basename(args[0])] + args[1:]
    print(f'\n$ {" ".join(shown)}  ({os.path.relpath(cwd, ROOT)})', flush=True)
    if subprocess.call(args, cwd=cwd) != 0:
        sys.exit(f'失敗しました: {" ".join(args)}')


def main():
    ap = argparse.ArgumentParser(description='画面のビルドとサーバーの起動をまとめて行う')
    ap.add_argument('--dev', action='store_true', help='画面を開発サーバー（HMR）で起動する')
    ap.add_argument('--skip-build', action='store_true', help='画面のビルドを省く（web/dist をそのまま使う）')
    opt = ap.parse_args()

    load_env(os.path.join(ROOT, '.env'))
    pnpm = need('pnpm', 'https://pnpm.io/installation を見て入れてください。')
    uv = need('uv', 'https://docs.astral.sh/uv/ を見て入れてください。')

    # 画面の準備
    if not os.path.isdir(os.path.join(WEB, 'node_modules')):
        run([pnpm, 'install'], WEB)
    if not opt.dev and not opt.skip_build:
        run([pnpm, 'build'], WEB)

    # サーバーの準備（.venv が無いときだけ作る）
    if not os.path.isdir(os.path.join(SERVER, '.venv')):
        run([uv, 'venv'], SERVER)
        run([uv, 'pip', 'install', '-r', 'requirements.txt'], SERVER)

    procs = []
    try:
        if opt.dev:
            print('\n画面（開発）: http://localhost:5173   サーバー: http://localhost:8124', flush=True)
            procs.append(subprocess.Popen([pnpm, 'dev'], cwd=WEB))
        else:
            print('\n画面とサーバー: http://localhost:8124', flush=True)
        procs.append(subprocess.Popen([uv, 'run', 'python', 'app.py'], cwd=SERVER, env=os.environ.copy()))
        procs[-1].wait()
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == '__main__':
    main()
