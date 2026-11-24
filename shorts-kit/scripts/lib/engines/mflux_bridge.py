"""
Batch background generator for the stickman explainer style.
Loads the model once (4-bit) and renders every job in the input JSON.
Models: "z-image-turbo" (default — Apache-2.0, no Hugging Face login) or "schnell" (FLUX.1, gated: needs `hf auth login`).

Usage: .venv-mflux/bin/python mflux_bridge.py jobs.json
jobs.json: {"width": 1536, "height": 864, "steps": 4,
            "jobs": [{"prompt": "...", "seed": 7, "out": "/abs/path.png"}, ...]}
Prints one line per finished image: "DONE <out>" or "FAIL <out> <reason>".
"""
import json
import sys
import traceback

from mflux.models.common.config import ModelConfig


# Pre-quantized 4-bit weights (Apache-2.0, ~5.9 GB, no login) instead of the 33 GB original repo.
Z_IMAGE_Q4_REPO = "mflux-community/z-image-turbo-mflux-q4"


def load_model(name: str, quantize: int):
    if name.startswith("z-image"):
        from mflux.models.common.resolution.config_resolution import ConfigResolution
        from mflux.models.z_image.variants.z_image import ZImage

        cfg = ConfigResolution.resolve_restricted("z-image-turbo", "z-image-turbo", model_path=Z_IMAGE_Q4_REPO)
        return ZImage(model_config=cfg, model_path=Z_IMAGE_Q4_REPO)
    from mflux.models.flux.variants.txt2img.flux import Flux1

    return Flux1(model_config=ModelConfig.from_name(model_name=name), quantize=quantize)


def main() -> int:
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    width = int(spec.get("width", 1536))
    height = int(spec.get("height", 864))
    model = spec.get("model", "z-image-turbo")
    steps = int(spec.get("steps", 9 if model.startswith("z-image") else 4))
    flux = load_model(model, int(spec.get("quantize", 4)))
    extra = {"guidance": 0.0} if model.startswith("z-image") else {}
    failures = 0
    for job in spec["jobs"]:
        out = job["out"]
        try:
            image = flux.generate_image(
                seed=int(job.get("seed", 7)),
                prompt=job["prompt"],
                num_inference_steps=steps,
                width=width,
                height=height,
                **extra,
            )
            image.save(path=out, export_json_metadata=False)
            print(f"DONE {out}", flush=True)
        except Exception as exc:  # keep going: one bad prompt must not stop the video
            failures += 1
            print(f"FAIL {out} {exc}", flush=True)
            traceback.print_exc(file=sys.stderr)
    return 1 if failures == len(spec["jobs"]) and failures else 0


if __name__ == "__main__":
    sys.exit(main())
