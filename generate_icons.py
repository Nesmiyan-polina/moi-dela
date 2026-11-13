"""Export the vector-style checkmark mark as PWA PNG icons."""

from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).parent / "icons"
out.mkdir(exist_ok=True)

for size in (180, 192, 512):
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), "#15572e")
    draw = ImageDraw.Draw(canvas)
    points = [(0.27, 0.52), (0.43, 0.67), (0.74, 0.34)]
    draw.line(
        [(int(x * size * scale), int(y * size * scale)) for x, y in points],
        fill="white",
        width=int(size * scale * 0.09),
        joint="curve",
    )
    radius = int(size * scale * 0.045)
    for x, y in (points[0], points[-1]):
        cx, cy = int(x * size * scale), int(y * size * scale)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill="white")
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(out / f"icon-{size}.png")
