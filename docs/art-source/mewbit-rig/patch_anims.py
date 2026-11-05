import re

s = open("anims.py", encoding="utf8").read()
# Every raise through arm_low and arm_mid gets the level arm between them.
s, n = re.subn(r'\("arm_low", None\), \("arm_mid", 75\)', '("arm_low", None), ("arm_out", 50), ("arm_mid", 75)', s)
print("series", n)
old = '''        series=((None, 16), ("both_low", None), ("both_mid", 80), ("both_up", None), ("stretch", None)),
        elev=track(n, (0, 16), (5, 16), (24, 172), (42, 176), (58, 16), (64, 16)),
'''
new = '''        # A pseudo elevation past the top: clasping the hands takes its own stretch of time, on the way up and down.
        series=((None, 16), ("both_low", None), ("both_out", 62), ("both_mid", 95), ("both_up", 160), ("stretch", 205)),
        elev=track(n, (0, 16), (5, 16), (20, 160), (30, 205), (42, 205), (48, 160), (60, 16), (64, 16)),
'''
assert old in s
s = s.replace(old, new)
old = '''        wob_l=track(n, (0, 0), (4, -8), (14, 4), (27, 0)), wob_r=track(n, (0, 0), (4, -22), (14, 4), (27, 0)),
    )
    for f in range(4, n):
        a.key_at[f] = "both_down"
'''
new = '''        # The hand slides off the hip and both arms fall: elevation here only runs from the drawing to the key.
        series=((None, 0), ("both_down", 1)), elev=track(n, (0, 0), (2, 0.05), (7, 1), (27, 1)),
        wob_l=track(n, (0, 0), (7, -4), (14, 3), (27, 0)), wob_r=track(n, (0, 0), (7, -6), (14, 3), (27, 0)),
    )
'''
assert old in s
s = s.replace(old, new)
open("anims.py", "w", encoding="utf8").write(s)
