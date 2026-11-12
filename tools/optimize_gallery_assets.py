from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent.parent
PAGES = {
    "2026": "2026/2026-gallery.html",
    "gif": "gif/gif-gallery.html",
    "gnsj": "gnsj/gnsj-gallery.html",
    "hwsj": "hwsj/hwsj-gallery.html",
    "dp": "dp/dp-gallery.html",
    "ztlogo": "ztlogo/ztlogo-gallery.html",
    "logo": "logo/logo-gallery.html",
    "AIGC": "AIGC/aigc-gallery.html",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
FULL_QUALITY = 95
THUMB_QUALITY = 86
THUMB_MAX_WIDTH = 1440
LONG_EDGE_LIMIT = 16383
POSTER_QUALITY = 88
GIF_CRF = 18
VIDEO_CRF = 20


def extract_sources(html_path: Path) -> list[str]:
    content = html_path.read_text(encoding="utf-8")
    sources = re.findall(r'<(?:img|video)[^>]+src="([^"]+)"', content, flags=re.I)
    result: list[str] = []
    for source in sources:
        suffix = Path(source).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
            continue
        if source.startswith("optimized/"):
            continue
        if source not in result:
            result.append(source)
    return result


def output_dirs(page_dir: Path) -> tuple[Path, Path, Path]:
    full_dir = page_dir / "optimized" / "full"
    thumb_dir = page_dir / "optimized" / "thumbs"
    poster_dir = page_dir / "optimized" / "posters"
    full_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    poster_dir.mkdir(parents=True, exist_ok=True)
    return full_dir, thumb_dir, poster_dir


def resize_width(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image.copy()
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def optimize_image(source: Path, page_dir: Path, full_dir: Path, thumb_dir: Path) -> dict:
    with Image.open(source) as raw:
        image = ImageOps.exif_transpose(raw)
        icc_profile = image.info.get("icc_profile")
        has_alpha = "A" in image.getbands()

        if max(image.size) > LONG_EDGE_LIMIT:
            full_path = full_dir / f"{source.stem}.jpg"
            flat = Image.new("RGB", image.size, (3, 3, 2))
            if has_alpha:
                flat.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
            else:
                flat.paste(image.convert("RGB"))
            flat.save(
                full_path,
                "JPEG",
                quality=92,
                optimize=True,
                progressive=True,
                subsampling=0,
                icc_profile=icc_profile,
            )
            return {
                "type": "image",
                "src": full_path.relative_to(page_dir).as_posix(),
                "thumb": full_path.relative_to(page_dir).as_posix(),
                "width": image.width,
                "height": image.height,
                "wide": True,
            }

        full_path = full_dir / f"{source.stem}.webp"
        if source.suffix.lower() == ".webp" and full_path == source:
            pass
        else:
            save_image = image.convert("RGBA") if has_alpha else image.convert("RGB")
            save_image.save(
                full_path,
                "WEBP",
                quality=FULL_QUALITY,
                method=6,
                alpha_quality=100,
                icc_profile=icc_profile,
            )

        thumb_path = thumb_dir / f"{source.stem}.webp"
        thumb = resize_width(image, THUMB_MAX_WIDTH)
        thumb_save = thumb.convert("RGBA") if has_alpha else thumb.convert("RGB")
        thumb_save.save(
            thumb_path,
            "WEBP",
            quality=THUMB_QUALITY,
            method=6,
            alpha_quality=100,
            icc_profile=icc_profile,
        )
        return {
            "type": "image",
            "src": full_path.relative_to(page_dir).as_posix(),
            "thumb": thumb_path.relative_to(page_dir).as_posix(),
            "width": image.width,
            "height": image.height,
        }


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        check=True,
    )


def transcode_video(source: Path, output: Path, *, from_gif: bool) -> None:
    args: list[str] = ["-i", str(source)]
    if from_gif:
        args += [
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-fps_mode",
            "vfr",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            str(GIF_CRF),
            "-pix_fmt",
            "yuv420p",
            "-an",
        ]
    else:
        args += [
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            str(VIDEO_CRF),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ]
    args += ["-movflags", "+faststart", str(output)]
    run_ffmpeg(args)


def create_poster(source: Path, poster: Path) -> None:
    run_ffmpeg(
        [
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-c:v",
            "libwebp",
            "-quality",
            str(POSTER_QUALITY),
            str(poster),
        ]
    )


def probe_dimensions(source: Path) -> tuple[int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def optimize_video(source: Path, page_dir: Path, full_dir: Path, poster_dir: Path) -> dict:
    output = full_dir / f"{source.stem}.mp4"
    poster = poster_dir / f"{source.stem}.webp"
    source_is_gif = source.suffix.lower() == ".gif"
    transcode_video(source, output, from_gif=source_is_gif)
    if not source_is_gif and output.stat().st_size >= source.stat().st_size:
        shutil.copyfile(source, output)
    create_poster(output, poster)
    width, height = probe_dimensions(output)
    return {
        "type": "video",
        "src": output.relative_to(page_dir).as_posix(),
        "poster": poster.relative_to(page_dir).as_posix(),
        "width": width,
        "height": height,
    }


def optimize_page(page_key: str, html_relative: str) -> dict[str, dict]:
    html_path = ROOT / html_relative
    page_dir = html_path.parent
    full_dir, thumb_dir, poster_dir = output_dirs(page_dir)
    page_meta: dict[str, dict] = {}

    for source_text in extract_sources(html_path):
        source = page_dir / source_text
        if not source.exists():
            print(f"SKIP missing: {page_key}/{source_text}")
            continue

        suffix = source.suffix.lower()
        if suffix == ".gif" or suffix in VIDEO_EXTENSIONS:
            page_meta[source_text] = optimize_video(source, page_dir, full_dir, poster_dir)
        else:
            page_meta[source_text] = optimize_image(source, page_dir, full_dir, thumb_dir)

        original_size = source.stat().st_size
        optimized_path = ROOT / page_dir / page_meta[source_text]["src"]
        optimized_size = optimized_path.stat().st_size
        print(
            f"{page_key:6} {source_text:52} "
            f"{original_size / 1048576:5.2f}MB -> {optimized_size / 1048576:5.2f}MB"
        )

    return page_meta


def main() -> None:
    meta: dict[str, dict[str, dict]] = {}
    for page_key, html_relative in PAGES.items():
        print(f"\n[{page_key}]")
        meta[page_key] = optimize_page(page_key, html_relative)

    output = ROOT / "js" / "gallery-asset-meta.js"
    content = "window.__GALLERY_ASSET_META__ = " + json.dumps(
        meta, ensure_ascii=False, indent=2
    ) + ";\n"
    output.write_text(content, encoding="utf-8")
    print(f"\nWrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
