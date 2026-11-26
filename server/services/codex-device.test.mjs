import test from 'node:test';
import assert from 'node:assert/strict';
import {usageSnapshot} from './codex-device.mjs';

test('read the Codex-specific window, preserve real zero usage and Unix reset time',()=>{
  const snapshot=usageSnapshot({rateLimitsByLimitId:{codex:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:1900000000},secondary:{usedPercent:84},planType:'business'}},rateLimits:{primary:{usedPercent:100}}});
  assert.equal(snapshot.progress[0].usedPercent,0);
  assert.equal(snapshot.progress[0].resetsAt.getTime(),1900000000000);
  assert.equal(snapshot.progress[1].remainingPercent,16);
  assert.equal(snapshot.identity.plan,'business');
});
test('unavailable quota is never replaced by zero',()=>{
  assert.throws(()=>usageSnapshot({rateLimits:{primary:{usedPercent:null}}}));
  assert.throws(()=>usageSnapshot({}));
});
