import test from 'node:test';
import assert from 'node:assert/strict';
import { runDifferential } from './runner.js';

test('Archive A and Archive B agree through separate JSONL processes', async () => {
  const report = await runDifferential(3);
  assert.equal(report.ok, true);
  assert.equal(report.sszVectors, 6);
  assert.equal(report.randomDaTranscripts, 3);
  assert.equal(report.randomFsmTranscripts, 3);
});
