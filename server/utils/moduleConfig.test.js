const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getModuleCode } = require('./moduleConfig');

test('getModuleCode prefers acronymOverride when provided', () => {
  // Carl-supplied acronym wins, even if the map disagrees.
  assert.equal(getModuleCode('Heat and Energy', 'HEAT'), 'HEAT');
  assert.equal(getModuleCode('Reactions', 'XYZA'), 'XYZA');
});

test('getModuleCode falls back to MODULE_CODE_MAP when no override', () => {
  assert.equal(getModuleCode('Heat and Energy'), 'HEAT');
  assert.equal(getModuleCode('Reactions'), 'REAC');
  assert.equal(getModuleCode('Forces'), 'FORC');
});

test('getModuleCode falls back to substring for unknown module names', () => {
  assert.equal(getModuleCode('Photosynthesis'), 'PHOT');
  assert.equal(getModuleCode('Cells'), 'CELL');
});

test('getModuleCode treats empty override as absent', () => {
  // An empty string from a destructured-but-missing field shouldn't be
  // treated as an override.
  assert.equal(getModuleCode('Heat and Energy', ''), 'HEAT');
  assert.equal(getModuleCode('Heat and Energy', undefined), 'HEAT');
  assert.equal(getModuleCode('Heat and Energy', null), 'HEAT');
});
