"""Pure, bounded 3D liquid-bundle estimation; no I/O or external dependencies."""
from dataclasses import dataclass
from itertools import permutations
from math import isfinite, pi, prod
from random import Random
from statistics import median
from time import perf_counter

DEFAULT_SLACK = 1.15  # ASSUMPTION: volume allowance, pending real-bundle calibration.
TIME_BUDGET_SECONDS = 0.5
EPS = 1e-9


@dataclass
class BundleResult:
    volume_cm3: float
    bbox_cm: list[float]
    lower_bound_cm3: float
    flexible: bool
    feasible: bool
    arrangement: list[dict]
    warnings: list[str]


def _dims(value):
    return (isinstance(value, (list, tuple)) and len(value) == 3
            and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                    and isfinite(v) and v > 0 for v in value)
            and isfinite(prod(value)))


def _orientations(member):
    dims, h = member['dims_cm'], member.get('height_axis', 2)
    upright = member.get('upright_only', False)
    # ASSUMPTION: explicit height_axis wins over the ambiguous "tallest side"
    # wording. A short, wide container must not have its width treated as height.
    cross = [i for i in range(3) if i != h]
    if member['shape'] == 'cylinder':
        orders = [(cross[0], cross[1], h)]
        if not upright:
            orders += [(h, cross[0], cross[1]), (cross[0], h, cross[1])]
    else:
        orders = [p for p in permutations(range(3)) if not upright or p[2] == h]
    # Identity first when allowed: a singleton keeps its own bounding box.
    orders.sort(key=lambda p: (p != (0, 1, 2), p))
    seen, result = set(), []
    for order in orders:
        size = tuple(float(dims[i]) for i in order)
        if size not in seen:
            seen.add(size)
            result.append((size, order))
    return result


def _overlaps(position, size, placed):
    return any(all(position[k] < p['position'][k] + p['size'][k] - EPS
                   and position[k] + size[k] > p['position'][k] + EPS
                   for k in range(3)) for p in placed)


def _bbox(placements):
    return [max((p['position'][k] + p['size'][k] for p in placements), default=0.) for k in range(3)]


def _placement(instance, position, size, orientation):
    return dict(item_id=instance['item_id'], instance_index=instance['instance_index'],
                position=list(position), size=list(size), orientation=list(orientation))


class _BudgetReached(Exception):
    pass


def _search(order, bounds, deadline):
    placed, points, bbox = [], {(0., 0., 0.)}, [0., 0., 0.]
    for instance in order:
        best = None
        for position in sorted(points, key=lambda p: (p[2], p[1], p[0])):
            for size, orientation in instance['orientations']:
                if perf_counter() >= deadline:
                    raise _BudgetReached
                if bounds and any(position[k] + size[k] > bounds[k] + EPS for k in range(3)):
                    continue
                if _overlaps(position, size, placed):
                    continue
                new_bbox = [max(bbox[k], position[k] + size[k]) for k in range(3)]
                score = (prod(new_bbox), position[2], position[1], position[0])
                if best is None or score < best[0]:
                    best = score, position, size, orientation, new_bbox
        if best is None:
            return None
        _, position, size, orientation, bbox = best
        placed.append(_placement(instance, position, size, orientation))
        # Positive face corners are extreme-point candidates. Also project them
        # onto the floor so an elevated face does not force unnecessary stacking.
        for axis in range(3):
            point = list(position)
            point[axis] += size[axis]
            points.add(tuple(point))
            points.add((point[0], point[1], 0.))
        points = {p for p in points if not any(
            all(box['position'][k] - EPS <= p[k] < box['position'][k] + box['size'][k] - EPS
                for k in range(3)) for box in placed)}
    return placed


def pack_liquids(members, slack=DEFAULT_SLACK, max_dims=None, restarts=300, seed=0):
    """Estimate a soft bundle. orientation[k] is the original axis placed on k.

    ASSUMPTIONS: restarts is the total number of orders, including the initial
    height-descending one. instance_index is zero-based within each member.
    max_dims may be axis-permuted as requested; z remains vertical in the chosen
    bag frame. No cylinder hexagonal nesting: every container occupies its full
    axis-aligned bounding box, a deliberately conservative approximation.

    Seeded completed searches are deterministic. A wall-clock interruption can
    finish different numbers of restarts on different machines; its warning
    explicitly limits that guarantee. No finite heuristic proves infeasibility.
    """
    start = perf_counter()
    members = list(members)
    bad = [str(m.get('item_id', '<missing item_id>')) for m in members if not _dims(m.get('dims_cm'))]
    if bad:
        raise ValueError('Missing/non-positive/non-finite dims_cm for: ' + ', '.join(bad))
    if not isinstance(slack, (int, float)) or isinstance(slack, bool) or not isfinite(slack) or slack < 1:
        raise ValueError('slack must be finite and >= 1 (conservative volume multiplier)')
    if not isinstance(restarts, int) or isinstance(restarts, bool) or restarts < 1:
        raise ValueError('restarts must be an integer >= 1')
    if max_dims is not None and not _dims(max_dims):
        raise ValueError('max_dims must contain three positive finite dimensions')
    if len({m.get('item_id') for m in members}) != len(members):
        raise ValueError('Duplicate item_id; aggregate qty or provide distinct IDs')
    instances, warnings, lower_bound, box_sum = [], [], 0., 0.
    for m in members:
        if not isinstance(m.get('item_id'), str) or not m['item_id']:
            raise ValueError('Every member needs a non-empty item_id')
        qty, axis = m.get('qty'), m.get('height_axis', 2)
        if not isinstance(qty, int) or isinstance(qty, bool) or qty < 1:
            raise ValueError(f"Invalid qty for {m['item_id']}")
        if m.get('shape') not in ('cylinder', 'box'):
            raise ValueError(f"Invalid shape for {m['item_id']}")
        if type(axis) is not int or axis not in (0, 1, 2) or type(m.get('upright_only', False)) is not bool:
            raise ValueError(f"Invalid height_axis/upright_only for {m['item_id']}")
        dims = m['dims_cm']
        volume = prod(dims)
        if m['shape'] == 'cylinder':
            cross = [dims[k] for k in range(3) if k != axis]
            # ASSUMPTION: circular cylinder; when noisy transverse dimensions
            # differ, the smaller diameter gives a conservative lower bound.
            volume = pi * (min(cross) / 2) ** 2 * dims[axis]
            if abs(cross[0] - cross[1]) > EPS:
                warnings.append(f"{m['item_id']}: unequal cylinder diameters; lower bound uses the smaller diameter.")
        lower_bound += volume * qty
        box_sum += prod(dims) * qty
        orientations = _orientations(m)
        instances.extend(dict(item_id=m['item_id'], instance_index=i, orientations=orientations,
                              height=dims[axis]) for i in range(qty))
    if not isfinite(box_sum) or not isfinite(box_sum * slack):
        raise ValueError('Bundle volume is outside the finite numeric range')
    if not instances:
        return BundleResult(0., [0., 0., 0.], 0., True, True, [], [])

    # Valid unconstrained fallback before timed search; never return a partial
    # arrangement as a successfully packed bundle.
    best, offset = [], 0.
    for instance in instances:
        size, orientation = instance['orientations'][0]
        best.append(_placement(instance, (offset, 0., 0.), size, orientation))
        offset += size[0]
    bounds_list = list(dict.fromkeys(permutations(max_dims))) if max_dims is not None else [None]
    if max_dims is not None and not any(all(_bbox(best)[k] <= bounds[k] + EPS for k in range(3)) for bounds in bounds_list):
        best = None
    best_volume = prod(_bbox(best)) if best is not None else float('inf')
    initial = sorted(instances, key=lambda i: (-i['height'], i['item_id'], i['instance_index']))
    rng, deadline = Random(seed), start + TIME_BUDGET_SECONDS
    hit_budget = False
    try:
        for restart in range(restarts):
            order = list(initial)
            if restart:
                rng.shuffle(order)
            for bounds in bounds_list:
                if perf_counter() >= deadline:
                    raise _BudgetReached
                candidate = _search(order, bounds, deadline)
                if candidate is not None:
                    volume = prod(_bbox(candidate))
                    if volume < best_volume:
                        best, best_volume = candidate, volume
            # Full AABBs cannot occupy less than their summed volumes. No further
            # search improves a no-void solution, including singleton results.
            if best is not None and best_volume <= box_sum + EPS:
                break
    except _BudgetReached:
        hit_budget = True
    if hit_budget:
        warnings.append('0.5 second time budget reached; seed reproducibility is limited by wall-clock truncation.')
    if best is None:
        # ASSUMPTION for unspecified failure numbers: zero bbox/volume, empty
        # arrangement, retained lower bound. feasible MUST gate downstream use.
        warnings.append('No complete arrangement found within max_dims; heuristic failure is not proof of impossibility.')
        return BundleResult(0., [0., 0., 0.], lower_bound, True, False, [], warnings)
    bbox = _bbox(best)
    best_volume = max(prod(bbox), lower_bound)
    if max_dims is not None and best_volume * slack > prod(max_dims) + EPS:
        warnings.append('Boxes fit max_dims, but the slack-adjusted volume exceeds that bag volume.')
    return BundleResult(best_volume * slack, bbox, lower_bound, True, True, best, warnings)


def calibrate_slack(samples):
    samples = list(samples)
    if len(samples) < 5:
        raise ValueError('calibrate_slack requires at least 5 measured bundle samples')
    if any(not isinstance(s, (tuple, list)) or len(s) != 2
           or any(not isinstance(v, (int, float)) or isinstance(v, bool) or not isfinite(v) or v <= 0 for v in s)
           for s in samples):
        raise ValueError('Samples must contain positive finite (estimated, measured) volume pairs')
    # Return the requested raw median even if < 1; pack_liquids deliberately
    # refuses < 1 as non-conservative. Revisit the approximation before using it.
    return median(measured / estimated for estimated, measured in samples)
