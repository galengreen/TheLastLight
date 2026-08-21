#!/usr/bin/env python3
"""Build the deterministic ``THE LAST LIGHT`` landing-screen package.

The hero starts as a smooth generated reference, is cropped to 16:9, reduced
to a 480x270 hard-palette project by per-cell averaging and nearest-palette
mapping, and is then enlarged 4x with nearest-neighbour pixels for the
1920x1080 runtime PNG.  The logo starts as a font-rendered transparent
reference, is reduced to a 400x150 indexed project, and is enlarged 2x.

This deliberately contains no semantic scene generator.  The high-resolution
reference establishes composition; the deterministic reduction establishes
the actual pixel-art output.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FORMAT = "pixel-poc/v1"
ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "assets" / "landing"
DEFAULT_HERO_REFERENCE = DEFAULT_OUTPUT / "the_last_light_hero_reference.png"

HERO_LOGICAL_SIZE = (480, 270)
HERO_RUNTIME_SIZE = (1920, 1080)
LOGO_LOGICAL_SIZE = (400, 150)
LOGO_RUNTIME_SIZE = (800, 300)

# The first colours are drawn from the existing soldier/zombie/prop vocabulary;
# the final entries reserve a small, deliberate range for floodlights and flare.
HERO_PALETTE: tuple[tuple[str, str], ...] = (
    ("void", "#080a09"),
    ("deep_olive", "#101511"),
    ("charcoal", "#171b17"),
    ("forest_shadow", "#20261d"),
    ("olive_shadow", "#2b3023"),
    ("military_olive", "#3b422c"),
    ("earth_dark", "#443d2d"),
    ("mud_brown", "#4d3929"),
    ("wasteland_brown", "#5f513e"),
    ("dry_olive", "#68523b"),
    ("dust_olive", "#7c6751"),
    ("bone_shadow", "#927d62"),
    ("floodlight_soft", "#b9ad83"),
    ("floodlight_bone", "#ddd2aa"),
    ("floodlight_hot", "#f6edc9"),
    ("rust_shadow", "#4a2320"),
    ("rust", "#71332a"),
    ("crimson_shadow", "#3b1217"),
    ("crimson_dark", "#57191d"),
    ("crimson", "#7d2025"),
    ("flare_red", "#a92b2e"),
    ("flare_hot", "#df5144"),
)

LOGO_PALETTE: tuple[tuple[str, str], ...] = (
    ("transparent", "#00000000"),
    ("extrusion", "#10120f"),
    ("red_shadow", "#54191b"),
    ("warning_crimson", "#9b292c"),
    ("dirty_bone", "#968c6f"),
    ("bone", "#d1c399"),
    ("bone_light", "#eee5c5"),
)


def parse_hex(value: str) -> tuple[int, int, int, int]:
    digits = value.lstrip("#")
    if len(digits) == 6:
        digits += "ff"
    if len(digits) != 8:
        raise ValueError(f"invalid colour {value}")
    return tuple(int(digits[index : index + 2], 16) for index in range(0, 8, 2))  # type: ignore[return-value]


def nearest_colour(colour: tuple[int, int, int], palette: list[tuple[int, int, int]]) -> int:
    return min(
        range(len(palette)),
        key=lambda index: sum((colour[channel] - palette[index][channel]) ** 2 for channel in range(3)),
    )


def crop_to_ratio(image: Image.Image, width: int, height: int) -> Image.Image:
    """Center-crop a reference to the exact requested aspect ratio."""
    target_ratio = width / height
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        crop_height = image.height
        crop_width = round(crop_height * target_ratio)
    else:
        crop_width = image.width
        crop_height = round(crop_width / target_ratio)
    left = (image.width - crop_width) // 2
    top = (image.height - crop_height) // 2
    return image.crop((left, top, left + crop_width, top + crop_height))


def reduce_rgb(
    image: Image.Image,
    target_size: tuple[int, int],
    palette_entries: tuple[tuple[str, str], ...],
) -> list[list[int]]:
    """Average each source cell, then map it to a fixed palette without dithering."""
    target_width, target_height = target_size
    source = crop_to_ratio(image.convert("RGB"), target_width, target_height)
    source_pixels = source.load()
    palette = [parse_hex(colour)[:3] for _, colour in palette_entries]
    pixels: list[list[int]] = []
    for output_y in range(target_height):
        y0 = output_y * source.height // target_height
        y1 = max(y0 + 1, (output_y + 1) * source.height // target_height)
        row: list[int] = []
        for output_x in range(target_width):
            x0 = output_x * source.width // target_width
            x1 = max(x0 + 1, (output_x + 1) * source.width // target_width)
            total = [0, 0, 0]
            count = 0
            for y in range(y0, min(y1, source.height)):
                for x in range(x0, min(x1, source.width)):
                    colour = source_pixels[x, y]
                    total[0] += colour[0]
                    total[1] += colour[1]
                    total[2] += colour[2]
                    count += 1
            average = tuple(channel // max(1, count) for channel in total)
            row.append(nearest_colour(average, palette))
        pixels.append(row)
    return pixels


def add_established_zombie_silhouettes(image: Image.Image) -> Image.Image:
    """Place a few existing game silhouettes into the forest perimeter.

    These are not a procedural zombie generator: they are the already-approved
    ``Last Light`` sprites, tinted and composited as distant silhouettes so the
    hero carries the same visual vocabulary as gameplay. The final reduction
    turns them into the same hard palette as the rest of the scene.
    """
    result = image.convert("RGBA")
    placements = (
        ("zombie_runner_64.png", (842, 318), (31, 39, 31), 205),
        ("zombie_runner_64.png", (1384, 360), (25, 31, 25), 225),
        ("zombie_brute_64.png", (1495, 596), (29, 34, 27), 220),
    )
    for filename, position, tint, opacity in placements:
        sprite_path = ROOT / "assets" / "64" / filename
        with Image.open(sprite_path) as opened:
            sprite = opened.convert("RGBA")
        sprite_pixels = sprite.load()
        for y in range(sprite.height):
            for x in range(sprite.width):
                red, green, blue, alpha = sprite_pixels[x, y]
                if alpha == 0:
                    continue
                luminance = (red * 3 + green * 6 + blue) // 10
                lift = 8 if luminance > 105 else 0
                sprite_pixels[x, y] = (
                    min(255, tint[0] + lift),
                    min(255, tint[1] + lift),
                    min(255, tint[2] + lift),
                    alpha * opacity // 255,
                )
        result.alpha_composite(sprite, position)
    return result


def draw_logo_reference(path: Path) -> dict[str, object]:
    """Create an exact-text transparent display/stencil reference."""
    width, height = 1600, 600
    font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf")
    if not font_path.exists():
        raise FileNotFoundError(f"required font is missing: {font_path}")
    top_font = ImageFont.truetype(str(font_path), 220)
    bottom_font = ImageFont.truetype(str(font_path), 300)
    lines = (("THE LAST", top_font, (100, 45)), ("LIGHT", bottom_font, (100, 260)))

    shadow = parse_hex("#10120fff")
    red_shadow = parse_hex("#54191bff")
    crimson = parse_hex("#9b292cff")
    bone = parse_hex("#d1c399ff")
    bone_light = parse_hex("#eee5c5ff")
    dirty_bone = parse_hex("#968c6fff")

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    # Broad, stepped extrusion gives the title a strong silhouette over dark
    # backgrounds without adding a solid box behind the transparent logo.
    for offset in range(18, 1, -2):
        for text, font, position in lines:
            x, y = position
            draw.text((x + offset, y + offset), text, font=font, fill=shadow, anchor="lt")
    for text, font, position in lines:
        x, y = position
        draw.text((x + 7, y + 8), text, font=font, fill=red_shadow, anchor="lt")

    face_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    face_draw = ImageDraw.Draw(face_layer)
    face_mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(face_mask)
    for text, font, position in lines:
        face_draw.text(position, text, font=font, fill=bone, anchor="lt")
        mask_draw.text(position, text, font=font, fill=255, anchor="lt")

    # Deterministic dirty-ivory patches: all are clipped to letter faces.
    randomizer = random.Random(0x1A57)
    face_pixels = face_layer.load()
    mask_pixels = face_mask.load()
    for _ in range(42):
        x = randomizer.randrange(90, 1390)
        y = randomizer.randrange(90, 540)
        scratch_width = randomizer.randrange(8, 42)
        scratch_height = randomizer.randrange(3, 10)
        for yy in range(y, min(height, y + scratch_height)):
            for xx in range(x, min(width, x + scratch_width)):
                if mask_pixels[xx, yy] >= 200:
                    face_pixels[xx, yy] = dirty_bone

    # Small stencil breaks reveal the dark extrusion below; they are sparse
    # enough to weather the face without compromising exact legibility.
    stencil_rectangles = (
        (195, 145, 236, 157),
        (480, 127, 523, 138),
        (735, 184, 780, 194),
        (122, 380, 164, 391),
        (364, 449, 411, 461),
        (645, 365, 693, 376),
        (1016, 472, 1065, 483),
    )
    for left, top, right, bottom in stencil_rectangles:
        for yy in range(top, bottom):
            for xx in range(left, right):
                if 0 <= xx < width and 0 <= yy < height and mask_pixels[xx, yy] >= 200:
                    face_pixels[xx, yy] = (0, 0, 0, 0)
    canvas.alpha_composite(face_layer)

    # Restrained warning marks: a broken red underline and two small registration
    # bars. These are not text and remain part of the title silhouette.
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((100, 548, 640, 563), fill=crimson)
    draw.rectangle((690, 548, 835, 563), fill=red_shadow)
    draw.rectangle((1050, 548, 1155, 563), fill=crimson)
    draw.rectangle((1275, 548, 1375, 563), fill=red_shadow)
    # Break the underline into a few hard chips to avoid a clean UI-like rule.
    draw.rectangle((325, 548, 355, 563), fill=(0, 0, 0, 0))
    draw.rectangle((895, 548, 924, 563), fill=(0, 0, 0, 0))
    draw.rectangle((1180, 548, 1208, 563), fill=(0, 0, 0, 0))

    # A few bone-light chips give the face a weathered, directional highlight.
    highlight = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight)
    for left, top, right, bottom in ((130, 105, 168, 111), (820, 321, 866, 328), (1004, 432, 1036, 438)):
        highlight_draw.rectangle((left, top, right, bottom), fill=bone_light)
    canvas.alpha_composite(highlight)
    canvas.save(path)
    return {
        "font": str(font_path),
        "font_family": "DejaVu Sans Mono Bold",
        "font_license_note": "DejaVu Fonts license; final runtime PNG has no font dependency.",
        "text": "THE LAST LIGHT",
        "reference_size": [width, height],
    }


def reduce_rgba(
    image: Image.Image,
    target_size: tuple[int, int],
    palette_entries: tuple[tuple[str, str], ...],
    coverage: float = 0.18,
) -> list[list[int]]:
    """Reduce a transparent reference by hard alpha coverage and color voting."""
    target_width, target_height = target_size
    source = image.convert("RGBA")
    source_pixels = source.load()
    palette = [parse_hex(colour)[:3] for _, colour in palette_entries]
    opaque_palette = palette[1:]
    output: list[list[int]] = []
    for output_y in range(target_height):
        y0 = output_y * source.height // target_height
        y1 = max(y0 + 1, (output_y + 1) * source.height // target_height)
        row: list[int] = []
        for output_x in range(target_width):
            x0 = output_x * source.width // target_width
            x1 = max(x0 + 1, (output_x + 1) * source.width // target_width)
            total = [0, 0, 0]
            visible = 0
            area = max(1, (x1 - x0) * (y1 - y0))
            for y in range(y0, min(y1, source.height)):
                for x in range(x0, min(x1, source.width)):
                    red, green, blue, alpha = source_pixels[x, y]
                    if alpha >= 128:
                        total[0] += red
                        total[1] += green
                        total[2] += blue
                        visible += 1
            if visible / area < coverage:
                row.append(0)
            else:
                average = tuple(channel // max(1, visible) for channel in total)
                row.append(nearest_colour(average, opaque_palette) + 1)
        output.append(row)
    return output


def write_project(path: Path, width: int, height: int, palette_entries: tuple[tuple[str, str], ...], pixels: list[list[int]], metadata: dict[str, object]) -> None:
    project = {
        "format": FORMAT,
        "width": width,
        "height": height,
        "palette": [{"name": name, "hex": colour} for name, colour in palette_entries],
        "metadata": metadata,
        "pixels": pixels,
    }
    path.write_text(json.dumps(project, indent=2) + "\n")
    tool = ROOT / "pixel_tool.py"
    subprocess.run([sys.executable, str(tool), "render", str(path), "--scale", "1"], check=True)
    return project  # type: ignore[return-value]


def nearest_resize(source_path: Path, destination: Path, size: tuple[int, int]) -> None:
    with Image.open(source_path) as opened:
        image = opened.resize(size, Image.Resampling.NEAREST)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the THE LAST LIGHT landing-screen art package")
    parser.add_argument("--hero-reference", type=Path, default=DEFAULT_HERO_REFERENCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    if not args.hero_reference.exists():
        parser.error(f"hero reference not found: {args.hero_reference}")

    with Image.open(args.hero_reference) as opened:
        composited_reference = add_established_zombie_silhouettes(opened)
        hero_pixels = reduce_rgb(composited_reference, HERO_LOGICAL_SIZE, HERO_PALETTE)
    hero_project_path = output / "the_last_light_hero_480x270.json"
    hero_project = write_project(
        hero_project_path,
        *HERO_LOGICAL_SIZE,
        HERO_PALETTE,
        hero_pixels,
        {
            "kind": "landing-hero-logical-source",
            "source_reference": args.hero_reference.name,
            "logical_size": list(HERO_LOGICAL_SIZE),
            "runtime_size": list(HERO_RUNTIME_SIZE),
            "runtime_scale": 4,
            "conversion": "exact 16:9 crop + per-cell RGB average + fixed nearest palette; no filtering/dither",
            "composition_note": "left third intentionally remains dark for menu UI; focus is center-right with floodlights and crimson flare",
            "established_sprite_accents": [
                "assets/64/zombie_runner_64.png (two distant tinted silhouettes)",
                "assets/64/zombie_brute_64.png (one distant tinted silhouette)",
            ],
        },
    )
    hero_native = hero_project_path.with_suffix(".png")
    hero_runtime = output / "the_last_light_hero_1920x1080.png"
    hero_preview = output / "the_last_light_hero_1920x1080_preview_2x.png"
    nearest_resize(hero_native, hero_runtime, HERO_RUNTIME_SIZE)
    nearest_resize(hero_runtime, hero_preview, (3840, 2160))

    logo_reference = output / "the_last_light_logo_reference.png"
    logo_info = draw_logo_reference(logo_reference)
    with Image.open(logo_reference) as opened:
        logo_pixels = reduce_rgba(opened, LOGO_LOGICAL_SIZE, LOGO_PALETTE)
    logo_project_path = output / "the_last_light_logo_400x150.json"
    logo_project = write_project(
        logo_project_path,
        *LOGO_LOGICAL_SIZE,
        LOGO_PALETTE,
        logo_pixels,
        {
            "kind": "transparent-pixel-logo-logical-source",
            "source_reference": logo_reference.name,
            "logical_size": list(LOGO_LOGICAL_SIZE),
            "runtime_size": list(LOGO_RUNTIME_SIZE),
            "runtime_scale": 2,
            "conversion": "alpha coverage + average visible colour + fixed nearest palette; no filtering/dither",
            **logo_info,
        },
    )
    logo_native = logo_project_path.with_suffix(".png")
    logo_runtime = output / "the_last_light_logo.png"
    logo_preview = output / "the_last_light_logo_preview_2x.png"
    nearest_resize(logo_native, logo_runtime, LOGO_RUNTIME_SIZE)
    nearest_resize(logo_runtime, logo_preview, (1600, 600))

    package_metadata = {
        "package": "THE LAST LIGHT landing screen",
        "hero": {
            "runtime": hero_runtime.name,
            "editable_project": hero_project_path.name,
            "native_logical": hero_native.name,
            "preview_2x": hero_preview.name,
            "runtime_dimensions": list(HERO_RUNTIME_SIZE),
            "placement": "full viewport; keep left third available for lower-left menu",
        },
        "logo": {
            "runtime": logo_runtime.name,
            "editable_project": logo_project_path.name,
            "reference": logo_reference.name,
            "preview_2x": logo_preview.name,
            "runtime_dimensions": list(LOGO_RUNTIME_SIZE),
            "placement": "upper-left, approximately x=72..872 and y=56..356 at 1920x1080; scale down proportionally on narrower viewports",
            "font_caveat": logo_info["font_license_note"],
        },
        "pipeline": "build_landing_package.py",
    }
    (output / "the_last_light_landing_pipeline.json").write_text(json.dumps(package_metadata, indent=2) + "\n")
    print(f"hero project: {hero_project_path}")
    print(f"hero runtime: {hero_runtime} ({HERO_RUNTIME_SIZE[0]}x{HERO_RUNTIME_SIZE[1]})")
    print(f"hero 2x preview: {hero_preview}")
    print(f"logo project: {logo_project_path}")
    print(f"logo runtime: {logo_runtime} ({LOGO_RUNTIME_SIZE[0]}x{LOGO_RUNTIME_SIZE[1]})")
    print(f"logo 2x preview: {logo_preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
