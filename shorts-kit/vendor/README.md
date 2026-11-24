# vendor/

- **VieNeu-TTS v3.8.3** — https://github.com/pnnbao97/VieNeu-TTS (Apache-2.0, see `VieNeu-TTS/LICENSE`).
  Vendored so a new machine installs the exact version the channel's trained voices were made with
  (`bash scripts/setup-vieneu.sh`) and can fine-tune new voices (`VieNeu-TTS/finetune/`).
  Model weights are not in git: they download on first run into `.cache/vieneu/`.
