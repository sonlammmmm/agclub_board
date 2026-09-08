import type { TournamentLevelInput } from '../types/poker';

export type TournamentPresetId = 'turbo' | 'standard' | 'deepstack' | 'championship';

export interface TournamentPreset {
  id: TournamentPresetId;
  name: string;
  summary: string;
  startingStack: number;
  levelMinutes: number;
  breakMinutes: number;
  breakEvery: number;
  blindLevelCount: number;
  levels: TournamentLevelInput[];
  scheduledMinutes: number;
}

interface PresetDefinition {
  id: TournamentPresetId;
  name: string;
  summary: string;
  startingStack: number;
  levelMinutes: number;
  breakMinutes: number;
  breakEvery: number;
  blindLevelCount: number;
}

const blindProgression = [
  [100, 200],
  [200, 300],
  [200, 400],
  [300, 500],
  [300, 600],
  [400, 800],
  [500, 1_000],
  [600, 1_200],
  [800, 1_600],
  [1_000, 2_000],
  [1_000, 2_500],
  [1_500, 3_000],
  [2_000, 4_000],
  [3_000, 5_000],
  [3_000, 6_000],
  [4_000, 8_000],
  [5_000, 10_000],
  [6_000, 12_000],
  [8_000, 16_000],
  [10_000, 20_000],
  [15_000, 25_000],
  [15_000, 30_000],
] as const;

const definitions: PresetDefinition[] = [
  {
    id: 'turbo',
    name: 'Turbo',
    summary: 'Nhanh gọn cho buổi tối',
    startingStack: 20_000,
    levelMinutes: 10,
    breakMinutes: 10,
    breakEvery: 4,
    blindLevelCount: 12,
  },
  {
    id: 'standard',
    name: 'Standard',
    summary: 'Cân bằng, phù hợp đa số bàn',
    startingStack: 30_000,
    levelMinutes: 15,
    breakMinutes: 15,
    breakEvery: 4,
    blindLevelCount: 16,
  },
  {
    id: 'deepstack',
    name: 'Deepstack',
    summary: 'Nhiều không gian chơi hậu flop',
    startingStack: 50_000,
    levelMinutes: 25,
    breakMinutes: 15,
    breakEvery: 4,
    blindLevelCount: 18,
  },
  {
    id: 'championship',
    name: 'Championship',
    summary: 'Cấu trúc dài kiểu sự kiện lớn',
    startingStack: 40_000,
    levelMinutes: 40,
    breakMinutes: 15,
    breakEvery: 3,
    blindLevelCount: 15,
  },
];

function buildLevels(definition: PresetDefinition): TournamentLevelInput[] {
  const levels: TournamentLevelInput[] = [];
  blindProgression.slice(0, definition.blindLevelCount).forEach(([smallBlind, bigBlind], index) => {
    levels.push({
      kind: 'level',
      smallBlind,
      bigBlind,
      ante: bigBlind,
      durationSeconds: definition.levelMinutes * 60,
    });

    const isLastLevel = index === definition.blindLevelCount - 1;
    if (!isLastLevel && (index + 1) % definition.breakEvery === 0) {
      levels.push({
        kind: 'break',
        durationSeconds: definition.breakMinutes * 60,
      });
    }
  });
  return levels;
}

export const tournamentPresets: TournamentPreset[] = definitions.map(definition => {
  const levels = buildLevels(definition);
  return {
    ...definition,
    levels,
    scheduledMinutes: levels.reduce((total, level) => total + level.durationSeconds / 60, 0),
  };
});

export function getTournamentPreset(id: TournamentPresetId): TournamentPreset {
  const preset = tournamentPresets.find(candidate => candidate.id === id);
  if (!preset) throw new Error(`Unknown Tournament preset: ${id}`);
  return preset;
}
