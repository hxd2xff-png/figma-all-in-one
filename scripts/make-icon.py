# -*- coding: utf-8 -*-
"""
把项目根目录的 icon.jpg 转换为 Figma 插件发布所需的图标素材。
- 输出 icon-128.png：128x128、透明背景、纯黑图形（Figma 社区要求的图标规格）
- 白底会被转成透明，图形保留抗锯齿边缘

用法（在 figma-all-in-one 目录下）：
    python scripts/make-icon.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'icon.jpg')
DST = os.path.join(ROOT, 'icon-128.png')
SIZE = 128

img = Image.open(SRC).convert('RGBA')
print('原图:', SRC, img.size)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
src_px = img.load()

out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
dst_px = out.load()

for y in range(SIZE):
    for x in range(SIZE):
        r, g, b, _ = src_px[x, y]
        # 感知亮度（0=黑, 255=白）
        lum = (r * 299 + g * 587 + b * 114) // 1000
        alpha = 255 - lum            # 白 -> 0（透明），黑 -> 255（实心）
        # 极低 alpha 直接清零，避免 jpg 噪点在白底留下灰雾
        dst_px[x, y] = (0, 0, 0, alpha) if alpha > 12 else (0, 0, 0, 0)

out.save(DST)
print('已生成:', DST, out.size, '模式', out.mode)
