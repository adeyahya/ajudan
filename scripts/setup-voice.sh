#!/bin/sh
# Ajudan's local voice for WhatsApp voice-note replies: OmniVoice (k2-fsa) in its own
# Python environment under ~/.ajudan/voice. About 4 GB (PyTorch + the 0.6B model).
# The model weights are CC-BY-NC (non-commercial); the code is Apache-2.0.
#
#   pnpm voice:setup
set -e
DIR="${AJUDAN_VOICE_DIR:-$HOME/.ajudan/voice}"
if ! command -v uv >/dev/null 2>&1; then
  echo "Needs uv (https://docs.astral.sh/uv/): brew install uv" >&2
  exit 1
fi
mkdir -p "$DIR"
rm -f "$DIR/.ready"
uv venv --allow-existing --python 3.11 "$DIR/.venv"
uv pip install --python "$DIR/.venv/bin/python" torch==2.8.0 torchaudio==2.8.0 omnivoice==0.2.1 soundfile==0.14.0 num2words==0.5.14
echo "Downloading the OmniVoice model…"
"$DIR/.venv/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('k2-fsa/OmniVoice')"
touch "$DIR/.ready"
echo "Voice is ready. Turn on voice replies in Business → WhatsApp."
