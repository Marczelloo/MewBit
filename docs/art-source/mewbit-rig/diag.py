import numpy as np
from PIL import Image
import rig
from segment import *
original=load(SOURCE); color,alpha=cut_alpha(original)
labels=np.load("labels.npy"); sil=np.load("body_silhouette.npy")
L=rig.build_layers(color,alpha,labels,sil)
np.savez_compressed("layers.npz",**L)
bg=np.array([.2,.75,.3])
tiles=[]
for name in ("hairBack","body","hairFront","jacket"):
    l=L[name]; im=l[...,:3]+bg*(1-l[...,3:4])
    im=Image.fromarray((im*255).astype(np.uint8)).crop((150,30,620,760)).resize((376,584),Image.LANCZOS)
    tiles.append(im)
s=Image.new("RGB",(376*4,584)); [s.paste(t,(i*376,0)) for i,t in enumerate(tiles)]
s.save("layers.jpg",quality=86)
# chest at the frame the user flagged against rest, head variants
def game(f,box,z):
    im=Image.open(f"out/{f:02d}.webp").convert("RGBA").crop(box); b=Image.new("RGB",im.size,(22,26,34)); b.paste(im,(0,0),im)
    return b.resize((b.width*z,b.height*z),Image.LANCZOS)
box=(275,205,395,300)
a=[game(1,box,4),game(58,box,4)]
heads=rig.head_variants(color,L["head"])
ev=[]
for st in ("open","half","closed"):
    h=heads[st]; im=h[...,:3]+np.array([.09,.1,.13])*(1-h[...,3:4])
    ev.append(Image.fromarray((np.clip(im,0,1)*255).astype(np.uint8)).crop((320,140,470,210)).resize((450,210),Image.LANCZOS))
s=Image.new("RGB",(480*2+6+450,380),(255,0,255)); s.paste(a[0],(0,0)); s.paste(a[1],(486,0))
for i,e in enumerate(ev): pass
s2=Image.new("RGB",(966,380+216*2),(255,0,255)); s2.paste(a[0],(0,0)); s2.paste(a[1],(486,0))
s2.paste(ev[0],(0,386)); s2.paste(ev[1],(486,386)); s2.paste(ev[2],(0,602))
s2.save("chest-eyes.jpg",quality=86)
