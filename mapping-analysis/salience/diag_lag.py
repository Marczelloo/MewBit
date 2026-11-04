import sys, json, glob, os
sys.path.insert(0,'/scripts')
import numpy as np
from extract import *
from common import auc_fast, nearest_human
ids = ["1127488","1141872","1196084","1204419","1224013","384036"]
ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{DATA}/features/*.json"))[:8]
keys = ["os_broad","flux_full_all","flux_full_low","flux_full_lowmid","flux_full_highmid","flux_full_high","flux_P_highmid","flux_H_highmid","flux_P_lowmid","flux_H_lowmid"]
lags = list(range(-8,9))
acc = {k:np.zeros(len(lags)) for k in keys}; n=0
for sid in ids:
    f=json.load(open(f"{DATA}/features/{sid}.json"))
    h=json.load(open(f"{DATA}/human/normal/{sid}.json"))
    hm=np.array(sorted(set(x[0] for x in h)),float)
    ser,dur,tm=compute_series(glob.glob(f"{DATA}/audio/{sid}.*")[0])
    ts,P,pn=candidates(f)
    y=(nearest_human(ts,hm)>=0).astype(int)
    for k in keys:
        a=[]
        for L in lags:
            fr=np.clip(np.round(ts/FMS).astype(int)+L,0,len(ser[k])-1)
            a.append(auc_fast(ser[k][fr],y))
        acc[k]+=np.array(a)
    n+=1
print("lag(ms):", [round(L*FMS) for L in lags])
for k in keys:
    print("%-18s"%k, " ".join("%.2f"%v for v in acc[k]/n))
