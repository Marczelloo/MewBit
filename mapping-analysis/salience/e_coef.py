import pickle
R = pickle.load(open("/scripts/models.pkl","rb"))["R"]["coefs"]
for lv, c in R.items():
    c = {k:v for k,v in c.items() if not k.startswith("rc_") and k!="has_repeat"}
    top = sorted(c.items(), key=lambda kv:-abs(kv[1]))[:8]
    print(lv, " ".join("%s %+.2f" % kv for kv in top))
