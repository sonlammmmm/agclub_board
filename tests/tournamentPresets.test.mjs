import assert from 'node:assert/strict';
import test from 'node:test';

const loadPresets = () => import('../src/lib/tournamentPresets.ts');

test('Tournament presets generate a complete modern blind structure', async () => {
  const { tournamentPresets } = await loadPresets();

  assert.deepEqual(tournamentPresets.map(preset => preset.id), ['turbo', 'standard', 'deepstack', 'championship']);
  for (const preset of tournamentPresets) {
    const blindLevels = preset.levels.filter(level => level.kind === 'level');
    const breaks = preset.levels.filter(level => level.kind === 'break');
    assert.equal(blindLevels.length, preset.blindLevelCount);
    assert.ok(breaks.length > 0);
    assert.equal(preset.scheduledMinutes, preset.levels.reduce((total, level) => total + level.durationSeconds / 60, 0));
    blindLevels.forEach((level, index) => {
      assert.ok(level.bigBlind > level.smallBlind);
      assert.equal(level.ante, level.bigBlind, 'preset should use Big Blind Ante');
      if (index > 0) assert.ok(level.bigBlind >= blindLevels[index - 1].bigBlind);
    });
  }
});

test('Championship preset follows the long-form 40k and 40-minute profile', async () => {
  const { getTournamentPreset } = await loadPresets();
  const preset = getTournamentPreset('championship');

  assert.equal(preset.startingStack, 40_000);
  assert.equal(preset.levelMinutes, 40);
  assert.equal(preset.breakEvery, 3);
  assert.equal(preset.breakMinutes, 15);
});
