export type PlayerStatus = 'active' | 'inactive';
export type SessionStatus = 'active' | 'completed';

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

