"""Plain-assert tests. Run: python3 scripts/liquids_test.py"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dataclasses import asdict
from itertools import combinations, permutations
from math import prod
from random import Random
from time import perf_counter
from unittest.mock import patch
from src.lib.packing.liquids import pack_liquids, calibrate_slack


def member(i, dims, shape='box', qty=1, upright=False, axis=2):
    return dict(item_id=str(i), qty=qty, dims_cm=dims, shape=shape, upright_only=upright, height_axis=axis)


def check_geometry(result, members):
    assert result.feasible
    assert len(result.arrangement) == sum(m['qty'] for m in members)
    assert len({(p['item_id'], p['instance_index']) for p in result.arrangement}) == len(result.arrangement)
    by_id = {m['item_id']: m for m in members}
    for p in result.arrangement:
        source = by_id[p['item_id']]
        assert sorted(p['orientation']) == [0, 1, 2]
        assert p['size'] == [source['dims_cm'][i] for i in p['orientation']]
        assert 0 <= p['instance_index'] < source['qty']
        assert all(p['position'][i] >= 0 and p['position'][i] + p['size'][i] <= result.bbox_cm[i] + 1e-8 for i in range(3))
        if source['upright_only']:
            assert p['orientation'][2] == source['height_axis']
    for a, b in combinations(result.arrangement, 2):
        assert any(a['position'][k] + a['size'][k] <= b['position'][k] + 1e-8
                   or b['position'][k] + b['size'][k] <= a['position'][k] + 1e-8 for k in range(3))
    assert result.volume_cm3 + 1e-8 >= result.lower_bound_cm3


one = pack_liquids([member('one', [3, 4, 5])])
assert one.bbox_cm == [3, 4, 5] and one.volume_cm3 == 60 * 1.15
assert pack_liquids([]).arrangement == [] and pack_liquids([]).volume_cm3 == 0
print('PASS 1: singleton bbox [3, 4, 5]; empty bundle')

three = pack_liquids([member('three', [3, 4, 5], qty=3, upright=True)])
assert prod(three.bbox_cm) <= 3 * 60 * 1.05
print(f'PASS 2: three upright boxes bbox volume {prod(three.bbox_cm):.1f} cm3 (sum 180.0)')

rng = Random(71)
random_bundles = []
for trial in range(200):
    members = []
    for i in range(rng.randint(2, 10)):
        shape = rng.choice(['box', 'cylinder'])
        dims = [rng.randint(2, 12) for _ in range(3)]
        axis = rng.randrange(3)
        if shape == 'cylinder':
            cross = [k for k in range(3) if k != axis]
            dims[cross[1]] = dims[cross[0]]
        members.append(member(i, dims, shape, upright=rng.choice([True, False]), axis=axis))
    result = pack_liquids(members, restarts=4, seed=trial)
    check_geometry(result, members)
    random_bundles.append(members)
print('PASS 3-4: 200 random mixed bundles, no overlaps, complete accounting, bbox containment, volume >= lower bound')

different = False
for members in random_bundles[:20]:
    a = pack_liquids(members, restarts=4, seed=4)
    b = pack_liquids(members, restarts=4, seed=4)
    assert asdict(a) == asdict(b)
    different |= a.arrangement != pack_liquids(members, restarts=4, seed=19).arrangement
assert different
print('PASS 5: same-seed completed runs identical; different seed changed an arrangement')
print('PASS 6: upright height-axis preserved in all 200 random cases')

small = pack_liquids([member('large', [10, 10, 10])], max_dims=[2, 2, 2], restarts=4)
assert not small.feasible and small.arrangement == []
roomy = pack_liquids(random_bundles[0], max_dims=[100, 120, 140], restarts=4)
check_geometry(roomy, random_bundles[0])
assert any(all(roomy.bbox_cm[k] <= dims[k] + 1e-8 for k in range(3)) for dims in permutations([100, 120, 140]))
print('PASS 7: too-small max_dims infeasible; roomy max_dims feasible')

ten = [member(i, [2 + i % 5, 3 + i % 4, 5 + i % 6]) for i in range(10)]
start = perf_counter()
timed = pack_liquids(ten)
elapsed = perf_counter() - start
assert elapsed < 1, elapsed
check_geometry(timed, ten)
print(f'PASS 8: ten containers, 300 requested restarts: {elapsed:.3f}s; budget warning={any("time budget" in w for w in timed.warnings)}')

try:
    pack_liquids([dict(item_id='missing-bottle', qty=1, shape='box'), member('bad-bottle', [1, 0, 3])])
    assert False, 'expected ValueError'
except ValueError as error:
    assert 'missing-bottle' in str(error) and 'bad-bottle' in str(error)
print('PASS 9: missing/invalid dimensions name all offending item IDs')

assert calibrate_slack([(10, 10), (10, 12), (10, 11), (10, 20), (10, 13)]) == 1.2
try:
    calibrate_slack([(10, 12)] * 4)
    assert False
except ValueError as error:
    assert 'at least 5' in str(error)
with patch('src.lib.packing.liquids.perf_counter', side_effect=[0, 1]):
    timeout = pack_liquids(ten)
assert timeout.feasible and any('time budget' in w for w in timeout.warnings)
print('PASS calibration and forced-timeout fallback; all assertions passed')
