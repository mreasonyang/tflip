"""Render the static social card with Pillow; never runs during a site build.

Run on macOS with Python and Pillow. The PNG is checked in so deployment does
not depend on system fonts or a graphics runtime.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCALE = 3
ROOT = Path(__file__).resolve().parent.parent
PAPER, INK, PURPLE, ORANGE = '#f4f2ed', '#23232c', '#b8aafa', '#ff7957'
image = Image.new('RGB', (1200 * SCALE, 630 * SCALE), PAPER)
draw = ImageDraw.Draw(image)


def box(coords):
    return tuple(round(v * SCALE) for v in coords)


def font(size, bold=False, mono=False):
    path = '/System/Library/Fonts/Menlo.ttc' if mono else (
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold
        else '/System/Library/Fonts/Supplemental/Arial.ttf')
    return ImageFont.truetype(path, round(size * SCALE))


def text(x, y, value, size, fill=INK, bold=False, mono=False):
    draw.text(box((x, y)), value, font=font(size, bold, mono), fill=fill)


def line(points, fill, width=2):
    draw.line([box(point) for point in points], fill=fill, width=round(width * SCALE), joint='curve')


# Use the site's arrow mark, paper background, purple cards, and orange accents.
draw.rounded_rectangle(box((64, 57, 120, 113)), radius=9 * SCALE, fill=INK)
line([(78, 99), (106, 71), (85, 71)], PURPLE, 4)
line([(106, 71), (106, 92)], PURPLE, 4)
text(136, 53, 'Tflip', 51, bold=True)
text(65, 165, 'MOTION PLAYGROUND', 15, fill='#777680', mono=True)
text(61, 209, 'A little motion.', 61, bold=True)
text(61, 281, 'A lot of', 61, bold=True)
text(61, 353, 'character.', 61, fill='#5755ff', bold=True)
text(65, 449, '3D rolls, flights, and landings.', 25)
text(65, 488, 'Built for your interface.', 25, fill='#777680')

draw.rounded_rectangle(box((630, 56, 1136, 539)), radius=25 * SCALE, fill='#191a22')
text(663, 87, 'ROLL / FLY / LAND', 14, fill='#b8aafa', mono=True)
draw.arc(box((661, 145, 1121, 454)), start=12, end=339, fill='#5b546d', width=2 * SCALE)
draw.arc(box((681, 166, 1097, 431)), start=0, end=324, fill='#393443', width=2 * SCALE)


def card(cx, cy, angle, color, foreground=False):
    card_image = Image.new('RGBA', (246 * SCALE, 288 * SCALE))
    card_draw = ImageDraw.Draw(card_image)
    card_draw.rounded_rectangle(box((8, 8, 238, 280)), radius=18 * SCALE, fill=color)
    if foreground:
        card_draw.text(box((29, 32)), 'TFLIP / 01', font=font(13, mono=True), fill='#514468')
        card_draw.text(box((29, 88)), 'MAKE', font=font(38, bold=True), fill='#27213d')
        card_draw.text(box((29, 134)), 'IT MOVE.', font=font(32, bold=True), fill='#27213d')
        card_draw.line([box((29, 215)), box((215, 215))], fill='#8f7cbb', width=2 * SCALE)
        card_draw.text(box((29, 237)), 'YOUR NEXT IDEA', font=font(12, mono=True), fill='#514468')
    rotated = card_image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    image.paste(rotated, (round(cx * SCALE - rotated.width / 2), round(cy * SCALE - rotated.height / 2)), rotated)


card(927, 326, -19, '#41394e')
card(894, 310, -3, '#7562bf')
card(854, 292, 12, PURPLE, True)
draw.ellipse(box((1007, 390, 1095, 478)), fill=ORANGE)
line([(1035, 451), (1067, 419), (1043, 419)], '#3d2530', 4)
line([(1067, 419), (1067, 443)], '#3d2530', 4)
line([(1026, 166), (1026, 204)], ORANGE, 4)
line([(1007, 185), (1045, 185)], ORANGE, 4)
line([(1013, 172), (1039, 198)], ORANGE, 3)
line([(1013, 198), (1039, 172)], ORANGE, 3)

line([(64, 563), (1136, 563)], '#dad8d4', 1)
text(65, 585, 'tflip.kyun.si', 17, mono=True)
text(668, 585, 'TypeScript   Vanilla JS   React', 16, fill='#777680', mono=True)
output = ROOT / 'playground/social-card-v1.png'
image.resize((1200, 630), Image.Resampling.LANCZOS).save(output, optimize=True)
print(f'{output.name}: 1200 × 630, {output.stat().st_size} bytes')
