# usage: python3 slice.py shots/NAME.png [sliceHeight=1100] -> writes shots/slices/NAME_0.png ...
import sys, os
from PIL import Image
p = sys.argv[1]; h = int(sys.argv[2]) if len(sys.argv) > 2 else 1100
im = Image.open(p); os.makedirs('shots/slices', exist_ok=True)
base = os.path.splitext(os.path.basename(p))[0]; n = 0
for y in range(0, im.height, h):
    im.crop((0, y, im.width, min(y + h, im.height))).save(f'shots/slices/{base}_{n}.png'); n += 1
print(n)
