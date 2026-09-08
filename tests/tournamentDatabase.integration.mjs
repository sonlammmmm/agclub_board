import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const containerName = `poker-board-postgres-test-${process.pid}`;
const databaseSql = path.join(repoRoot, 'database.sql');
const migrationSql = path.join(repoRoot, 'supabase', 'migrations', '20260908173000_tournament_mode.sql');
const integrationSql = path.join(repoRoot, 'tests', 'tournamentDatabase.integration.sql');

const docker = (...args) => execFileSync('docker', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });

for (const file of [databaseSql, migrationSql, integrationSql]) {
  if (!existsSync(file)) throw new Error(`Missing database test input: ${file}`);
}

try {
  docker('info');
  docker('run', '--name', containerName, '-e', 'POSTGRES_PASSWORD=poker_test_only_2026', '-d', 'postgres:16-alpine');

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      docker('exec', containerName, 'pg_isready', '-U', 'postgres');
      ready = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error('Temporary PostgreSQL did not become ready.');

  docker('exec', containerName, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  docker('cp', databaseSql, `${containerName}:/tmp/database.sql`);
  docker('cp', migrationSql, `${containerName}:/tmp/tournament.sql`);
  docker('cp', integrationSql, `${containerName}:/tmp/tournament-integration.sql`);
  docker('exec', containerName, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/database.sql');
  docker('exec', containerName, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/tournament.sql');
  docker('exec', containerName, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/tournament.sql');
  docker('exec', containerName, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/tournament-integration.sql');
  process.stdout.write('Tournament database integration passed.\n');
} finally {
  try {
    docker('rm', '-f', containerName);
  } catch {
    // The container may not have been created if Docker was unavailable.
  }
}
