import sys, os

sys.path.insert(0, os.path.dirname(__file__))
from selection import select


def picked(t, base, flagged, grid, budget, **kw):
    return sorted(t[i] for i in select(t, base, flagged, grid, budget, **kw))


def test_too_many_flagged_drops_the_weakest_not_the_latest():
    t = [0, 1000, 2000, 3000]
    assert picked(t, [.9, .1, .8, .7], [1, 1, 1, 1], [0, 0, 0, 0], 3) == [0, 2000, 3000]


def test_too_few_flagged_fills_on_the_grid_first():
    t = [0, 1000, 2000, 3000]
    assert picked(t, [.1, .9, .2, .3], [1, 0, 0, 0], [0, 0, 1, 0], 2) == [0, 2000]


def test_fill_prefers_the_gaps_of_the_melody():
    t = [0, 200, 1000]
    assert picked(t, [.1, .9, .2], [1, 0, 0], [0, 1, 1], 2, fill_gap_ms=300) == [0, 1000]


def test_never_closer_than_the_minimum_gap():
    t = [0, 50, 100, 150, 200]
    out = picked(t, [.5, .9, .4, .8, .3], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], 5, min_gap_ms=90)
    assert all(b - a >= 90 for a, b in zip(out, out[1:]))


def test_budget_is_a_ceiling():
    t = list(range(0, 10000, 500))
    assert len(select(t, [.5] * 20, [1] * 20, [1] * 20, 7)) == 7


def test_no_flags_is_the_plain_ranking():
    t = [0, 1000, 2000, 3000]
    assert picked(t, [.1, .9, .2, .8], [0, 0, 0, 0], [1, 0, 0, 0], 2) == [1000, 3000]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
