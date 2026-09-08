import assert from 'node:assert/strict';
import test from 'node:test';

const loadClock = () => import('../src/lib/tournamentClock.ts');
const anchorTime = '2026-09-08T12:00:00.000Z';
const levels = [
  { kind: 'level', duration_seconds: 900 },
  { kind: 'break', duration_seconds: 600 },
  { kind: 'level', duration_seconds: 1200 },
];

const snapshot = (overrides = {}) => ({
  clock_status: 'running',
  current_level_index: 0,
  remaining_seconds: 900,
  anchor_started_at: anchorTime,
  ...overrides,
});

test('a paused tournament clock remains stable regardless of wall-clock time', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({
      clock_status: 'paused',
      current_level_index: 1,
      remaining_seconds: 321,
      anchor_started_at: null,
    }),
    levels,
    Date.parse('2026-09-09T12:00:00.000Z'),
  );

  assert.equal(result.currentLevelIndex, 1);
  assert.equal(result.remainingSeconds, 321);
  assert.equal(result.crossedLevels, 0);
  assert.equal(result.isScheduleComplete, false);
});

test('a running tournament clock derives remaining time from its persisted anchor', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({ remaining_seconds: 300 }),
    levels,
    Date.parse('2026-09-08T12:02:05.000Z'),
  );

  assert.equal(result.currentLevelIndex, 0);
  assert.equal(result.remainingSeconds, 175);
  assert.equal(result.crossedLevels, 0);
  assert.equal(result.isScheduleComplete, false);
});

test('an exact boundary advances to the next ordered schedule item at full duration', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({ remaining_seconds: 120 }),
    levels,
    Date.parse('2026-09-08T12:02:00.000Z'),
  );

  assert.equal(result.currentLevelIndex, 1);
  assert.equal(result.remainingSeconds, 600);
  assert.equal(result.crossedLevels, 1);
  assert.equal(result.isScheduleComplete, false);
});

test('reload after idle reconstructs across blind and break levels without client writes', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({ remaining_seconds: 120 }),
    levels,
    Date.parse('2026-09-08T12:12:30.000Z'),
  );

  assert.equal(result.currentLevelIndex, 2);
  assert.equal(result.remainingSeconds, 1170);
  assert.equal(result.crossedLevels, 2);
  assert.equal(result.isScheduleComplete, false);
});

test('elapsed time beyond the final level clamps at a completed schedule', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({ remaining_seconds: 120 }),
    levels,
    Date.parse('2026-09-08T12:32:01.000Z'),
  );

  assert.equal(result.currentLevelIndex, 2);
  assert.equal(result.remainingSeconds, 0);
  assert.equal(result.crossedLevels, 2);
  assert.equal(result.isScheduleComplete, true);
});

test('a future anchor caused by clock skew never adds time', async () => {
  const { deriveTournamentClock } = await loadClock();
  const result = deriveTournamentClock(
    snapshot({ remaining_seconds: 300, anchor_started_at: '2026-09-08T12:10:00.000Z' }),
    levels,
    Date.parse(anchorTime),
  );

  assert.equal(result.currentLevelIndex, 0);
  assert.equal(result.remainingSeconds, 300);
});

test('clock formatting is stable for zero, ordinary, and hour-long values', async () => {
  const { formatTournamentClock } = await loadClock();

  assert.equal(formatTournamentClock(-1), '00:00');
  assert.equal(formatTournamentClock(0), '00:00');
  assert.equal(formatTournamentClock(65), '01:05');
  assert.equal(formatTournamentClock(3600), '60:00');
});

test('per-second countdown changes are not announceable until status or level changes', async () => {
  const { shouldAnnounceTournamentClock } = await loadClock();
  const previous = {
    clockStatus: 'running',
    currentLevelIndex: 0,
    remainingSeconds: 175,
    isScheduleComplete: false,
  };

  assert.equal(shouldAnnounceTournamentClock(previous, { ...previous, remainingSeconds: 174 }), false);
  assert.equal(shouldAnnounceTournamentClock(previous, { ...previous, currentLevelIndex: 1, remainingSeconds: 600 }), true);
  assert.equal(shouldAnnounceTournamentClock(previous, { ...previous, clockStatus: 'paused' }), true);
  assert.equal(shouldAnnounceTournamentClock(previous, { ...previous, remainingSeconds: 0, isScheduleComplete: true }), true);
});
