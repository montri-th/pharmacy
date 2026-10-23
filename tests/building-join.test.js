import test from 'node:test';
import assert from 'node:assert/strict';
import {joinRows, containsPoint, footprint} from '../js/building-join.js';

// Synthetic footprints near Din Daeng (lon/lat squares; d = half-size in degrees).
const square = (cx, cy, d) => [[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]];
const X = 100.56, Y = 13.765;
const row = (id, dx, dy) => ({id, name: id, longitude: X + dx, latitude: Y + dy});

test('a published point joins the smallest drawn footprint that contains it; holes and the outside join nothing', () => {
  const outline = {key: 'osm:1', kind: 'osm', outer: square(X, Y, 0.001), holes: [square(X + 0.0007, Y + 0.0007, 0.0001)]};
  const part = {key: 'osm:2', kind: 'osm', outer: square(X - 0.0004, Y, 0.0002)};
  const rows = [row('in-part', -0.0004, 0), row('in-outline', 0.0004, -0.0004), row('in-hole', 0.0007, 0.0007), row('outside', 0.003, 0), {id: 'no-point', longitude: null, latitude: null}];
  const j = joinRows([outline, part], rows);
  assert.equal(j.byRow.get('in-part'), 'osm:2', 'a part inside an outline wins (smallest)');
  assert.equal(j.byRow.get('in-outline'), 'osm:1');
  assert.ok(!j.byRow.has('in-hole'), 'a courtyard (hole) is not inside');
  assert.ok(!j.byRow.has('outside') && !j.byRow.has('no-point'), 'rows without a point never join');
  assert.deepEqual(j.byBuilding.get('osm:1').map(r => r.id), ['in-outline']);
  assert.ok(containsPoint(footprint(part), [X - 0.0004, Y]) && !containsPoint(footprint(part), [X, Y]));
});

test('several points in one building stay several rows (the building panel lists them); the join never changes membership', () => {
  const b = {key: 'osm:9', kind: 'osm', outer: square(X, Y, 0.0005)};
  const rows = [row('a', 0, 0), row('b', 0.0001, 0.0001), row('c', -0.0001, 0)].map(r => ({...r, area: '102601'}));
  const before = JSON.stringify(rows);
  const j = joinRows([b], rows);
  assert.deepEqual(j.byBuilding.get('osm:9').map(r => r.id).sort(), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(rows), before, 'rows are not mutated (area membership stays the matched code)');
  assert.equal(joinRows([], rows).byRow.size, 0);
});
