import { supabase } from './supabase';
import type {
  AddPlayerInput,
  AddSessionPlayerInput,
  CreateSeasonInput,
  CreateTableInput,
  CreateTournamentInput,
  ControlTournamentClockInput,
  MutationResult,
  Player,
  Season,
  Session,
  SessionPlayer,
  Tournament,
} from '../types/poker';

export const createRequestId = () => crypto.randomUUID();

type RpcResponse = { data: unknown; error: Error & { code?: string } | null };

async function callMutation<T>(name: string, args: Record<string, unknown>): Promise<MutationResult<T>> {
  const response = await supabase.rpc(name, args) as unknown as RpcResponse;
  if (response.error) throw response.error;
  return response.data as MutationResult<T>;
}

export const createSeason = (input: CreateSeasonInput) =>
  callMutation<Season>('create_season', {
    p_name: input.name.trim(),
    p_request_id: input.requestId,
  });

export const createTable = (input: CreateTableInput) =>
  callMutation<Session>('create_table_with_players', {
    p_season_id: input.seasonId,
    p_player_ids: input.playerIds,
    p_default_buy_in: input.defaultBuyIn,
    p_request_id: input.requestId,
  });

export const addPlayer = (input: AddPlayerInput) =>
  callMutation<Player>('create_player', {
    p_name: input.name.trim(),
    p_request_id: input.requestId,
  });

export const addSessionPlayer = (input: AddSessionPlayerInput) =>
  callMutation<SessionPlayer>('add_session_player', {
    p_session_id: input.sessionId,
    p_player_id: input.playerId,
    p_buy_in: input.buyIn,
    p_request_id: input.requestId,
  });

export const applyRebuy = (input: { sessionPlayerId: string; amount: number; requestId: string; type?: string }) =>
  callMutation<SessionPlayer>('apply_rebuy', {
    p_session_player_id: input.sessionPlayerId,
    p_amount: input.amount,
    p_type: input.type ?? 'Rebuy',
    p_request_id: input.requestId,
  });

export const setCashout = (input: { sessionPlayerId: string; cashOut: number; requestId: string }) =>
  callMutation<SessionPlayer>('set_cashout', {
    p_session_player_id: input.sessionPlayerId,
    p_cash_out: input.cashOut,
    p_request_id: input.requestId,
  });

export const togglePlayerStatus = (input: { playerId: string; expectedStatus: Player['status']; requestId: string }) =>
  callMutation<Player>('toggle_player_status', {
    p_player_id: input.playerId,
    p_expected_status: input.expectedStatus,
    p_request_id: input.requestId,
  });

export const completeSession = (input: { sessionId: string; requestId: string }) =>
  callMutation<Session>('complete_session', {
    p_session_id: input.sessionId,
    p_request_id: input.requestId,
  });

export const cancelSession = (input: { sessionId: string; requestId: string }) =>
  callMutation<{ id: string }>('cancel_session', {
    p_session_id: input.sessionId,
    p_request_id: input.requestId,
  });

export const completeSeason = (input: { seasonId: string; requestId: string }) =>
  callMutation<Season>('complete_season', {
    p_season_id: input.seasonId,
    p_request_id: input.requestId,
  });

export const createTournament = (input: CreateTournamentInput) =>
  callMutation<Tournament>('create_tournament', {
    p_season_id: input.seasonId,
    p_name: input.name.trim(),
    p_player_ids: input.playerIds,
    p_starting_stack: input.startingStack,
    p_levels: input.levels.map((level, position) => ({
      position,
      kind: level.kind,
      duration_seconds: level.durationSeconds,
      small_blind: level.kind === 'level' ? level.smallBlind ?? 0 : null,
      big_blind: level.kind === 'level' ? level.bigBlind ?? 0 : null,
      ante: level.kind === 'level' ? level.ante ?? 0 : 0,
    })),
    p_request_id: input.requestId,
  });

export const controlTournamentClock = (input: ControlTournamentClockInput) =>
  callMutation<Tournament>('control_tournament_clock', {
    p_tournament_id: input.tournamentId,
    p_action: input.action,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

export const completeTournament = (input: { tournamentId: string; expectedVersion: number; requestId: string }) =>
  callMutation<Tournament>('complete_tournament', {
    p_tournament_id: input.tournamentId,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });
