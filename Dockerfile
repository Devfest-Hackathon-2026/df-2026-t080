# IntenTrip を Cloud Run で動かす（画面とサーバーを 1 つのコンテナに入れる）。
#   docker build -t intentrip .（Google マップを使うときは --build-arg VITE_GOOGLE_MAPS_KEY=…）
#   docker run -p 8080:8080 -e PORT=8080 intentrip
# Gemini（Vertex AI）の設定は、実行するときの環境変数で渡す（web/README.md の「Cloud Run に置く」）。

# 1. 画面を組み立てる（pnpm）
FROM node:22-slim AS web
WORKDIR /app/web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# Google マップのキー（無ければ MapLibre の地図）。キーはブラウザに配られる種類で、使えるサイトを絞ってある
ARG VITE_GOOGLE_MAPS_KEY=""
ENV VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY
RUN pnpm build

# 2. サーバー（uv で依存を入れる。サーバーが画面と API を両方配る）
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app/server
COPY server/requirements.txt ./
RUN uv pip install --system --no-cache -r requirements.txt
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
RUN useradd --create-home --uid 10001 app && mkdir -p cache && chown -R app /app/server/cache
USER app
EXPOSE 8080
CMD ["python", "-u", "app.py"]
