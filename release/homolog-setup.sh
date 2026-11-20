#!/usr/bin/env bash
# Substituído por release/publicar.sh (recado #109): o mesmo trabalho (migrations, segredos, funções, cron) mais o
# Worker e o smoke, com --conferir e parada no primeiro erro. Este arquivo só repassa, para quem ainda tem o comando
# antigo anotado. O endereço e o projeto agora ficam em release/ambientes/homolog.env.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "homolog-setup.sh foi substituído: rodando 'bash release/publicar.sh homolog'." >&2
if [[ $# -gt 0 ]]; then
  echo "Os argumentos ($*) são ignorados: projeto e endereço estão em release/ambientes/homolog.env." >&2
fi
exec bash release/publicar.sh homolog
