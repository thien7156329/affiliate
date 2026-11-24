#!/bin/bash
# One-shot VieNeu setup on a new machine (run from shorts-kit/):
#   bash scripts/setup-vieneu.sh
# 1) Python 3.12 venv in .venv-vieneu
# 2) VieNeu-TTS v3.8.3 installed from the vendored source (vendor/VieNeu-TTS, Apache-2.0)
# 3) first load: downloads the model (~600 MB) into .cache/vieneu and restores the channel's
#    trained voices (voices/trained/vieneu_custom_presets.json) into the package.
# Fine-tuning a new voice: see vendor/VieNeu-TTS/finetune/README.md
set -e
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo "Install uv first: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
uv venv --python 3.12 .venv-vieneu
uv pip install --python .venv-vieneu/bin/python -e vendor/VieNeu-TTS
.venv-vieneu/bin/python scripts/lib/engines/vieneu_bridge.py --voices | tail -5
echo "VieNeu ready. Trained voices restored; list above should include Mai Bé Phương, BuBu_Part4, DuDu_NamChinh."
