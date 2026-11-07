"""Presentation order: working roots first, then selected-period token totals."""
import math


def ordered_snapshot(snapshot, period='1h'):
    """Return sorted arrays without mutating the collector's shared snapshot.

    Keep the flat session inventory and aggregated roots separate: sorting must
    never flatten a family or count its children twice. Quota percentages and
    lifetime tokens are not comparable substitutes for selected-period usage.
    """
    def key(row):
        working = ((row.get('children_working') or 0) > 0 or
                   (row.get('display_status') or row.get('status')) == 'working')
        values = ((row.get('usage') or {}).get('windows') or {}).get(period)
        amount = -1
        if (isinstance(values, list) and values and
                all(type(n) in (int, float) and math.isfinite(n) and n >= 0 for n in values)):
            total = sum(values)
            if math.isfinite(total):
                amount = total
        return (not working, -amount, str(row.get('id', '')))

    return {**snapshot, **{name: sorted(snapshot[name], key=key)
                          for name in ('sessions', 'root_sessions')
                          if isinstance(snapshot.get(name), list)}}
