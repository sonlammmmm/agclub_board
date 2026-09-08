import assert from 'node:assert/strict';
import test from 'node:test';
import { createAsyncMutationGuard } from '../src/lib/asyncMutation.ts';

test('duplicate calls with the same key execute only the first operation', async () => {
  const guard = createAsyncMutationGuard();
  let calls = 0;
  let release;

  const first = guard.run('session:create:season-1', async () => {
    calls += 1;
    await new Promise(resolve => { release = resolve; });
    return 'created';
  });
  const duplicate = guard.run('session:create:season-1', async () => {
    calls += 1;
    return 'duplicate';
  });

  assert.equal(await duplicate, undefined);
  assert.equal(guard.isActive('session:create:season-1'), true);
  release();
  assert.equal(await first, 'created');
  assert.equal(calls, 1);
  assert.equal(guard.isActive('session:create:season-1'), false);
});

test('different keys can run independently', async () => {
  const guard = createAsyncMutationGuard();
  const first = guard.run('player:status:1', async () => 'one');
  const second = guard.run('player:status:2', async () => 'two');

  assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
});

test('a failed operation releases its key for retry', async () => {
  const guard = createAsyncMutationGuard();
  await assert.rejects(guard.run('session:end:1', async () => { throw new Error('network'); }));
  assert.equal(guard.isActive('session:end:1'), false);
  assert.equal(await guard.run('session:end:1', async () => 'retry'), 'retry');
});
