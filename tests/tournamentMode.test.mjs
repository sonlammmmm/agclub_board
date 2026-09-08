import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readRepoFile = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const migrationPath = new URL('../supabase/migrations/20260908173000_tournament_mode.sql', import.meta.url);

test('Tournament is reachable from both the router and primary navigation', async () => {
  const [appSource, layoutSource] = await Promise.all([
    readRepoFile('src/App.tsx'),
    readRepoFile('src/components/AppLayout.tsx'),
  ]);

  assert.match(appSource, /import\(['"]\.\/pages\/TournamentPage['"]\)/);
  assert.match(appSource, /<Route\s+path=['"]tournament['"]/);
  assert.match(layoutSource, /key:\s*['"]\/tournament['"]/);
  assert.match(layoutSource, /label:\s*['"]Giải đấu['"]/);
});

test('an additive, rerunnable Supabase migration owns the tournament schema', async () => {
  assert.equal(existsSync(migrationPath), true, 'expected a standalone Supabase migration artifact');
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /ALTER\s+TABLE\s+sessions\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+game_type/is);
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tournaments/is);
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tournament_levels/is);
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tournament_players/is);
  assert.doesNotMatch(sql, /\b(?:DROP\s+TABLE|TRUNCATE)\b/i);
});

test('the tournament clock RPC contract is receipt-backed, server-timed, and concurrency-safe', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+create_tournament/is);
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+control_tournament_clock/is);
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+complete_tournament/is);
  assert.match(sql, /p_expected_version\s+BIGINT/i);
  assert.match(sql, /mutation_receipts/i);
  assert.match(sql, /FOR\s+UPDATE/i);
  assert.match(sql, /clock_timestamp\s*\(\s*\)/i);
  assert.match(sql, /SECURITY\s+DEFINER/is);
  assert.match(sql, /SET\s+search_path\s*=\s*public,\s*pg_temp/is);
  assert.match(sql, /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+tournaments/is);
  assert.match(sql, /tournaments_one_open_per_season_idx/is);
});

test('Tournament mutations use the typed service boundary', async () => {
  const [mutationsSource, typesSource] = await Promise.all([
    readRepoFile('src/lib/mutations.ts'),
    readRepoFile('src/types/poker.ts'),
  ]);

  assert.match(mutationsSource, /export\s+const\s+createTournament/);
  assert.match(mutationsSource, /export\s+const\s+controlTournamentClock/);
  assert.match(mutationsSource, /export\s+const\s+completeTournament/);
  assert.match(typesSource, /export\s+interface\s+ControlTournamentClockInput/);
  assert.match(typesSource, /expectedVersion:\s*number/);
});
