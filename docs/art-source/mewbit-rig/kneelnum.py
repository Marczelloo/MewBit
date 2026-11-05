"""Per frame of crushed: top of the figure, lowest opaque row, width of the feet, stocking colour on the legs (game pixels)."""
import numpy as np
from PIL import Image
from skimage.color import rgb2lab

prev = None
for n in range(1, 29):
    im = np.asarray(Image.open(f"poses/crushed/{n:02d}.webp").convert("RGBA"), dtype=np.float32) / 255
    a = im[..., 3]
    rows = np.nonzero((a > 0.5).sum(1) > 3)[0]
    top, low = int(rows[0]), int(rows[-1])
    legs = im[max(low - 170, 0):low + 1, 170:470]
    m = legs[..., 3] > 0.9
    lab = rgb2lab(legs[..., :3])
    cloth = m & (lab[..., 0] > 13) & (lab[..., 0] < 58)
    L, A, B = lab[..., 0][cloth], lab[..., 1][cloth], lab[..., 2][cloth]
    area = int((a > 0.5).sum())
    jump = "" if prev is None else f"{abs(area - prev) / prev * 100:4.1f}%"
    prev = area
    print(f"{n:02d} top{top:4d} low{low:4d} area{area:7d} {jump:>6}  L{np.median(L):5.1f} p90{np.percentile(L, 90):5.1f} a{np.median(A):+5.1f} b{np.median(B):+5.1f}")
