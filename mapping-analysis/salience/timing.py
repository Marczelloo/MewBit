import sys, glob, json, time
sys.path.insert(0,'/scripts')
import numpy as np
from extract import *
ids=["1127488","1141872","1196084"]
agg={}; tot=0
for sid in ids:
    p=glob.glob(f"{DATA}/audio/{sid}.*")[0]
    t0=time.time(); ser,dur,tm=compute_series(p); w=time.time()-t0
    tot+=dur/60
    for k,v in tm.items(): agg[k]=agg.get(k,0)+v
    agg["_wall"]=agg.get("_wall",0)+w
print("audio minutes",round(tot,2))
for k,v in agg.items(): print("%-10s %.2f s per audio minute"%(k,v/tot))
