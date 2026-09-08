export type TournamentClockStatus = 'ready' | 'running' | 'paused' | 'completed';

export interface TournamentClockSnapshot {
  clock_status: TournamentClockStatus;
  current_level_index: number;
  remaining_seconds: number;
  anchor_started_at: string | null;
}

export interface TournamentClockLevel {
  kind: 'level' | 'break';
  duration_seconds: number;
}

export interface DerivedTournamentClock {
  clockStatus: TournamentClockStatus;
  currentLevelIndex: number;
  remainingSeconds: number;
  crossedLevels: number;
  isScheduleComplete: boolean;
}

const safeDuration = (value: number) => Math.max(1, Math.floor(Number(value) || 0));

export function deriveTournamentClock(
  snapshot: TournamentClockSnapshot,
  levels: TournamentClockLevel[],
  nowMs = Date.now(),
): DerivedTournamentClock {
  if (levels.length === 0) {
    return {
      clockStatus: 'completed',
      currentLevelIndex: 0,
      remainingSeconds: 0,
      crossedLevels: 0,
      isScheduleComplete: true,
    };
  }

  let currentLevelIndex = Math.min(Math.max(0, snapshot.current_level_index), levels.length - 1);
  let remainingSeconds = Math.max(0, Math.floor(Number(snapshot.remaining_seconds) || 0));

  if (snapshot.clock_status === 'completed') {
    return {
      clockStatus: 'completed',
      currentLevelIndex,
      remainingSeconds: 0,
      crossedLevels: 0,
      isScheduleComplete: true,
    };
  }

  if (snapshot.clock_status !== 'running' || !snapshot.anchor_started_at) {
    return {
      clockStatus: snapshot.clock_status,
      currentLevelIndex,
      remainingSeconds,
      crossedLevels: 0,
      isScheduleComplete: false,
    };
  }

  const anchorMs = Date.parse(snapshot.anchor_started_at);
  let elapsedSeconds = Number.isFinite(anchorMs)
    ? Math.max(0, Math.floor((nowMs - anchorMs) / 1000))
    : 0;
  let crossedLevels = 0;

  while (elapsedSeconds >= remainingSeconds) {
    elapsedSeconds -= remainingSeconds;

    if (currentLevelIndex >= levels.length - 1) {
      return {
        clockStatus: 'completed',
        currentLevelIndex,
        remainingSeconds: 0,
        crossedLevels,
        isScheduleComplete: true,
      };
    }

    currentLevelIndex += 1;
    crossedLevels += 1;
    remainingSeconds = safeDuration(levels[currentLevelIndex].duration_seconds);
  }

  return {
    clockStatus: 'running',
    currentLevelIndex,
    remainingSeconds: remainingSeconds - elapsedSeconds,
    crossedLevels,
    isScheduleComplete: false,
  };
}

export function formatTournamentClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function shouldAnnounceTournamentClock(
  previous: Pick<DerivedTournamentClock, 'clockStatus' | 'currentLevelIndex' | 'isScheduleComplete'>,
  current: Pick<DerivedTournamentClock, 'clockStatus' | 'currentLevelIndex' | 'isScheduleComplete'>,
): boolean {
  return previous.clockStatus !== current.clockStatus
    || previous.currentLevelIndex !== current.currentLevelIndex
    || previous.isScheduleComplete !== current.isScheduleComplete;
}
