"""The choice shared by every variant: the foreground first, then only as much of the rest as is missing."""


def select(t, base, flagged, on_grid, budget, min_gap_ms=90, fill_gap_ms=None):
    """Indices of at most `budget` moments. Only `flagged` differs between the variants."""
    n = len(t)
    by_score = sorted(range(n), key=lambda i: -base[i])
    chosen = []

    def add(i, gap):
        if len(chosen) < budget and i not in chosen and all(abs(t[i] - t[c]) >= gap for c in chosen):
            chosen.append(i)

    if not any(flagged):
        for i in by_score:
            add(i, min_gap_ms)
        return chosen

    for i in by_score:
        if flagged[i]:
            add(i, min_gap_ms)
    # Too little melody: strong places in its gaps, then strong places, then anything left.
    if fill_gap_ms is not None:
        for i in by_score:
            if on_grid[i]:
                add(i, fill_gap_ms)
    for i in by_score:
        if on_grid[i]:
            add(i, min_gap_ms)
    for i in by_score:
        add(i, min_gap_ms)
    return chosen
