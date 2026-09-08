export type PlayerStatus = 'active' | 'inactive';
export type SessionStatus = 'active' | 'completed';
export type SessionGameType = 'cash' | 'tournament';
export type TournamentClockStatus = 'ready' | 'running' | 'paused' | 'completed';
export type TournamentLevelKind = 'level' | 'break';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  created_at?: string;
}

export interface Season {
  id: string;
  name: string;
  is_active: boolean;
  start_date?: string;
  end_date?: string | null;
  created_at?: string;
}

export interface Session {
  id: string;
  season_id: string;
  date: string;
  status: SessionStatus;
  created_at: string;
  game_type?: SessionGameType;
}

export interface Tournament {
  id: string;
  session_id: string;
  season_id: string;
  name: string;
  starting_stack: number;
  clock_status: TournamentClockStatus;
  current_level_index: number;
  remaining_seconds: number;
  anchor_started_at: string | null;
  version: number;
  created_at: string;
  completed_at: string | null;
}

export interface TournamentLevel {
  id: string;
  tournament_id: string;
  position: number;
  kind: TournamentLevelKind;
  small_blind: number | null;
  big_blind: number | null;
  ante: number;
  duration_seconds: number;
}

export interface TournamentPlayer {
  id: string;
  tournament_id: string;
  player_id: string;
  starting_stack: number;
  created_at: string;
  players?: Pick<Player, 'name'> | null;
}

export interface TournamentLevelInput {
  kind: TournamentLevelKind;
  durationSeconds: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
}

export interface CreateTournamentInput {
  seasonId: string;
  name: string;
  playerIds: string[];
  startingStack: number;
  levels: TournamentLevelInput[];
  requestId: string;
}

export type TournamentClockAction = 'start' | 'resume' | 'pause' | 'previous' | 'next' | 'reset';

export interface ControlTournamentClockInput {
  tournamentId: string;
  action: TournamentClockAction;
  expectedVersion: number;
  requestId: string;
}

export interface RebuyEntry {
  amount: number;
  time: string;
  type: string;
}

export interface SessionPlayer {
  id: string;
  session_id: string;
  player_id: string;
  buy_in: number;
  cash_out: number;
  profit: number;
  rebuy_history: RebuyEntry[];
  created_at?: string;
  players?: Pick<Player, 'name'> | null;
}

export interface CreateTableInput {
  seasonId: string;
  playerIds: string[];
  defaultBuyIn: number;
  requestId: string;
}

export interface CreateSeasonInput {
  name: string;
  requestId: string;
}

export interface AddPlayerInput {
  name: string;
  requestId: string;
}

export interface AddSessionPlayerInput {
  sessionId: string;
  playerId: string;
  buyIn: number;
  requestId: string;
}

export interface MutationApplied<T> {
  status: 'applied' | 'duplicate';
  data: T;
}

export interface MutationConflict {
  status: 'conflict';
  message: string;
}

export type MutationResult<T> = MutationApplied<T> | MutationConflict;
