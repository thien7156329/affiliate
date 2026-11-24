"""
Bridge for the `vieneu` engine (VieNeu-TTS, Vietnamese, offline, Apache-2.0).

    python vieneu_bridge.py job.json     # synthesise every line of the job
    python vieneu_bridge.py --voices     # list the preset voices

job.json: {"lines": ["...", ...], "voice": "<preset name or path to a 3-8 s wav>",
           "mode": "v3turbo", "out": "<dir>", "cache": "<dir>"}
Writes <out>/line-<i>.wav and prints one "." per line.

Model files are downloaded once into <cache> as plain files (local_dir), not
into the shared Hugging Face cache: huggingface_hub 2.x keeps blobs outside
the model folder and onnxruntime refuses to load external data from there.
"""

import json
import os
import sys
from pathlib import Path

DEFAULT_CACHE = Path(__file__).resolve().parents[3] / ".cache" / "vieneu"


def patch_hub(cache: Path) -> None:
    import huggingface_hub

    orig_file = huggingface_hub.hf_hub_download
    orig_snap = huggingface_hub.snapshot_download

    def local(repo_id: str) -> str:
        return str(cache / repo_id.replace("/", "--"))

    def hf_hub_download(repo_id, filename, *a, **kw):
        if not os.path.isdir(repo_id):
            kw.setdefault("local_dir", local(repo_id))
        return orig_file(repo_id, filename, *a, **kw)

    def snapshot_download(repo_id, *a, **kw):
        if not os.path.isdir(repo_id):
            kw.setdefault("local_dir", local(repo_id))
        return orig_snap(repo_id, *a, **kw)

    huggingface_hub.hf_hub_download = hf_hub_download
    huggingface_hub.snapshot_download = snapshot_download


CUSTOM_PRESETS = Path(__file__).resolve().parents[3] / "voices" / "trained" / "vieneu_custom_presets.json"


def restore_custom_presets() -> None:
    """Put the channel's trained voices back into the installed vieneu package (a fresh install loses them)."""
    if not CUSTOM_PRESETS.exists():
        return
    try:
        import vieneu

        target = Path(vieneu.__file__).parent / "assets" / "voices_v3_turbo.json"
        data = json.loads(target.read_text("utf8"))
        custom = json.loads(CUSTOM_PRESETS.read_text("utf8")).get("presets", {})
        missing = {k: v for k, v in custom.items() if k not in data.get("presets", {})}
        if missing:
            data.setdefault("presets", {}).update(missing)
            target.write_text(json.dumps(data, ensure_ascii=False), "utf8")
            print(f"[vieneu] restored trained voices: {', '.join(missing)}", file=sys.stderr)
    except Exception as exc:  # never block synthesis on this
        print(f"[vieneu] could not restore trained voices: {exc}", file=sys.stderr)


def load(mode: str, cache: Path):
    restore_custom_presets()
    patch_hub(cache)
    from vieneu import Vieneu

    return Vieneu(mode=mode) if mode else Vieneu()


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: vieneu_bridge.py job.json | --voices")
    if sys.argv[1] == "--voices":
        tts = load("", DEFAULT_CACHE)
        for label, voice_id in tts.list_preset_voices():
            print(f"{label}\t{voice_id}")
        return

    job = json.loads(Path(sys.argv[1]).read_text("utf8"))
    tts = load(job.get("mode") or "", Path(job.get("cache") or DEFAULT_CACHE))
    voice = job.get("voice") or ""
    per_line = job.get("voices") or []
    names = {v for pair in tts.list_preset_voices() for v in pair}

    def is_ref(v: str) -> bool:
        return v.lower().endswith((".wav", ".mp3", ".flac", ".m4a"))

    for v in {voice, *[x for x in per_line if x]}:
        if v and not is_ref(v) and v not in names:
            sys.exit(f'unknown VieNeu voice "{v}"; list them with: .venv-vieneu/bin/python scripts/lib/engines/vieneu_bridge.py --voices')
    out = Path(job["out"])
    for i, text in enumerate(job["lines"]):
        v = (per_line[i] if i < len(per_line) else None) or voice
        kw = {"ref_audio": v} if is_ref(v) else ({"voice": v} if v else {})
        audio = tts.infer(text, temperature=0.4, top_p=0.9, apply_watermark=False, **kw)
        tts.save(audio, str(out / f"line-{i}.wav"))
        print(".", end="", flush=True)
    print()


if __name__ == "__main__":
    main()
