import {test} from 'node:test';
import assert from 'node:assert/strict';
import {genderStats} from '../cloud/demographics.mjs';
test('porcentajes con lista vacía sin divisiones por cero',()=>{
  const stats=genderStats([]);assert.equal(stats.total,0);assert.ok(stats.categories.every(c=>c.count===0 && c.percentage===0));
});
