import sys, json, glob, os
sys.path.insert(0,'/scripts')
import numpy as np
from extract import *
ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{DATA}/features/*.json"))
done=0
dl = list(range(-20,21))
acc=np.zeros(len(dl)); accb=np.zeros(len(dl)); n=0
for sid in ids:
    f=json.load(open(f"{DATA}/features/{sid}.json"))
    phr=f["phrases"]["list"]
    if not any(p["repeatOf"] is not None for p in phr): continue
    ser,dur,tm=compute_series(glob.glob(f"{DATA}/audio/{sid}.*")[0])
    o=ser["flux_full_all"]; z=(o-o.mean())/o.std()
    T=len(z)
    # correlation of z at frames in phrase vs frames shifted by lag
    c=np.zeros(len(dl)); cnt=0
    cb=np.zeros(len(dl))
    for i,p in enumerate(phr):
        if p["repeatOf"] is None: continue
        a=int(p["startMs"]/FMS); b=int(p["endMs"]/FMS); lag=p["lagMs"]/FMS
        lag2=(p["startMs"]-phr[p["repeatOf"]]["startMs"])/FMS
        for j,d in enumerate(dl):
            fr=np.arange(a,b); fr2=np.round(fr-lag+d).astype(int)
            ok=(fr2>=0)&(fr2<T)&(fr<T)
            c[j]+=np.corrcoef(z[fr[ok]],z[fr2[ok]])[0,1]
            fr3=np.round(fr-lag2+d).astype(int); ok=(fr3>=0)&(fr3<T)&(fr<T)
            cb[j]+=np.corrcoef(z[fr[ok]],z[fr3[ok]])[0,1]
        cnt+=1
    acc+=c/cnt; accb+=cb/cnt; n+=1
    done+=1
    if done>=10: break
print("delta frames(11.6ms):", dl)
print("corr using lagMs   :", " ".join("%.2f"%v for v in acc/n))
print("corr using startdiff:", " ".join("%.2f"%v for v in accb/n))
