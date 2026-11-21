const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SodvilleWorkability } = require('./scout-workability.js');

const now = Date.parse('2026-11-20T22:40:00Z');
const clay = [{ properties: { muname: 'Victoria clay' } }];
const sand = [{ properties: { muname: 'Sand' } }];
const mixed = [
  { properties: { muname: 'Victoria clay', area: 2 }, geometry: {} },
  { properties: { muname: 'Sand', area: 98 }, geometry: {} }
];
const areaOf = feature => feature.properties.area;
const dry = { rain24h: 0, rain48h: 0, rain72h: 0 };
const feed = (fields, timestamp = now) => ({
  observedUtc: new Date(timestamp).toISOString(),
  updatedUtc: new Date(timestamp).toISOString(),
  fields
});

test('wet-field recovery retains differences for rankings while keeping dry-looking fields marginal', () => {
  const source = feed({
    dry,
    olderRain: { ...dry, daysSince010: 5.9 },
    soaked: { rain24h: 2, rain48h: 2, rain72h: 2 }
  });
  const check = (id, soils) => SodvilleWorkability.assess(id, source, soils, now, areaOf);
  const sandy = check('dry', sand);
  const mostlySand = check('dry', mixed);
  const clayOnly = check('dry', clay);
  const previouslyWet = check('olderRain', clay);
  assert.ok(sandy.score >= mostlySand.score && mostlySand.score > clayOnly.score);
  assert.ok(clayOnly.score > previouslyWet.score);
  for (const row of [sandy, mostlySand, clayOnly, previouslyWet]) {
    assert.equal(row.status, 'MARGINAL');
    assert.match(row.reason, /Recheck ground/);
  }
  assert.equal(check('soaked', clay).status, 'TOO WET');
});

test('field-specific heavy rain keeps clay marginal after the field report expires', () => {
  const later = Date.parse('2026-11-22T22:00:00Z');
  const source = feed({ dry, oldStorm: { ...dry, daysSince010: 4, daysSince050: 4 } }, later);
  const normal = SodvilleWorkability.assess('dry', source, clay, later);
  const recovering = SodvilleWorkability.assess('oldStorm', source, clay, later);
  assert.equal(normal.status, 'WORKABLE');
  assert.equal(recovering.status, 'MARGINAL');
  assert.ok(normal.score > recovering.score);
  assert.doesNotMatch(normal.reason, /Nov\. 18/);
});

test('missing soil or stale rain does not receive a score during recovery', () => {
  assert.equal(SodvilleWorkability.assess('dry', feed({ dry }), [], now).score, null);
  assert.equal(SodvilleWorkability.assess('dry', feed({ dry }, now - 13 * 3600000), clay, now).score, null);
});
