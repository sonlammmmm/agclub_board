import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  message,
} from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsyncMutation } from '../hooks/useAsyncMutation';
import {
  completeTournament,
  controlTournamentClock,
  createRequestId,
  createTournament,
} from '../lib/mutations';
import { supabase } from '../lib/supabase';
import {
  deriveTournamentClock,
  formatTournamentClock,
  shouldAnnounceTournamentClock,
  type DerivedTournamentClock,
} from '../lib/tournamentClock';
import {
  getTournamentPreset,
  tournamentPresets,
  type TournamentPresetId,
} from '../lib/tournamentPresets';
import type {
  Player,
  Season,
  Session,
  Tournament,
  TournamentClockAction,
  TournamentLevel,
  TournamentLevelKind,
  TournamentPlayer,
} from '../types/poker';

interface SetupValues {
  name: string;
  startingStack: number;
  playerIds: string[];
}

interface EditableLevel {
  key: string;
  kind: TournamentLevelKind;
  durationMinutes: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

const newLevel = (
  kind: TournamentLevelKind,
  smallBlind = 100,
  bigBlind = 200,
  durationMinutes = kind === 'break' ? 10 : 15,
): EditableLevel => ({
  key: createRequestId(),
  kind,
  durationMinutes,
  smallBlind: kind === 'level' ? smallBlind : 0,
  bigBlind: kind === 'level' ? bigBlind : 0,
  ante: kind === 'level' ? bigBlind : 0,
});

const toEditableSchedule = (presetId: TournamentPresetId): EditableLevel[] =>
  getTournamentPreset(presetId).levels.map(level => ({
    key: createRequestId(),
    kind: level.kind,
    durationMinutes: level.durationSeconds / 60,
    smallBlind: level.smallBlind ?? 0,
    bigBlind: level.bigBlind ?? 0,
    ante: level.ante ?? 0,
  }));

const defaultSchedule = () => toEditableSchedule('standard');

const formatScheduledDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} phút`;
  return remainingMinutes === 0 ? `${hours} giờ` : `${hours} giờ ${remainingMinutes} phút`;
};

const statusLabel: Record<Tournament['clock_status'], string> = {
  ready: 'Sẵn sàng',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  completed: 'Đã kết thúc',
};

function describeLevel(level: TournamentLevel | undefined) {
  if (!level) return 'Hết lịch blind';
  if (level.kind === 'break') return 'Giải lao';
  const ante = Number(level.ante) > 0 ? ` · Ante ${Number(level.ante).toLocaleString('vi-VN')}` : '';
  return `${Number(level.small_blind).toLocaleString('vi-VN')} / ${Number(level.big_blind).toLocaleString('vi-VN')}${ante}`;
}

export default function TournamentPage() {
  const [form] = Form.useForm<SetupValues>();
  const { run, isPending } = useAsyncMutation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [activeSession, setActiveSession] = useState<Pick<Session, 'id' | 'game_type'> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [levels, setLevels] = useState<TournamentLevel[]>([]);
  const [tournamentPlayers, setTournamentPlayers] = useState<TournamentPlayer[]>([]);
  const [schedule, setSchedule] = useState<EditableLevel[]>(defaultSchedule);
  const [selectedPreset, setSelectedPreset] = useState<TournamentPresetId | null>('standard');
  const [presetAnnouncement, setPresetAnnouncement] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [confirmation, setConfirmation] = useState<'reset' | 'complete' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const previousClock = useRef<DerivedTournamentClock | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (seasonError) throw seasonError;

      const activeSeason = seasonData as Season | null;
      setSeason(activeSeason);
      if (!activeSeason) {
        setPlayers([]);
        setActiveSession(null);
        setTournament(null);
        setLevels([]);
        setTournamentPlayers([]);
        return;
      }

      const [playersResponse, tournamentResponse, sessionResponse] = await Promise.all([
        supabase.from('players').select('*').eq('status', 'active').order('name'),
        supabase
          .from('tournaments')
          .select('*')
          .eq('season_id', activeSeason.id)
          .neq('clock_status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('sessions')
          .select('id, game_type')
          .eq('season_id', activeSeason.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle(),
      ]);
      if (playersResponse.error) throw playersResponse.error;
      if (tournamentResponse.error) throw tournamentResponse.error;
      if (sessionResponse.error) throw sessionResponse.error;

      const activeTournament = tournamentResponse.data as Tournament | null;
      setPlayers((playersResponse.data ?? []) as Player[]);
      setActiveSession(sessionResponse.data as Pick<Session, 'id' | 'game_type'> | null);
      setTournament(activeTournament);
      if (!activeTournament) {
        setLevels([]);
        setTournamentPlayers([]);
        return;
      }

      const [levelsResponse, entriesResponse] = await Promise.all([
        supabase
          .from('tournament_levels')
          .select('*')
          .eq('tournament_id', activeTournament.id)
          .order('position'),
        supabase
          .from('tournament_players')
          .select('*, players(name)')
          .eq('tournament_id', activeTournament.id)
          .order('created_at'),
      ]);
      if (levelsResponse.error) throw levelsResponse.error;
      if (entriesResponse.error) throw entriesResponse.error;

      setLevels((levelsResponse.data ?? []) as TournamentLevel[]);
      setTournamentPlayers((entriesResponse.data ?? []) as unknown as TournamentPlayer[]);
      setNow(Date.now());
    } catch (caught) {
      const text = caught instanceof Error
        ? caught.message
        : typeof caught === 'object' && caught !== null && 'message' in caught
          ? String(caught.message)
          : 'Không thể tải dữ liệu giải đấu.';
      setError(/tournament|game_type|schema cache/i.test(text)
        ? 'Cơ sở dữ liệu chưa được cập nhật chế độ Tournament. Hãy áp dụng migration mới rồi thử lại.'
        : text);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(timeout);
  }, [fetchData]);

  useEffect(() => {
    if (tournament?.clock_status !== 'running') return;
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tournament?.clock_status, tournament?.anchor_started_at]);

  const clock = useMemo(() => tournament
    ? deriveTournamentClock(tournament, levels, now)
    : null, [levels, now, tournament]);

  useEffect(() => {
    if (!clock) {
      previousClock.current = null;
      return;
    }
    if (previousClock.current && shouldAnnounceTournamentClock(previousClock.current, clock)) {
      const level = levels[clock.currentLevelIndex];
      setAnnouncement(clock.isScheduleComplete
        ? 'Lịch blind đã kết thúc.'
        : `${statusLabel[clock.clockStatus]}. ${describeLevel(level)}.`);
    }
    previousClock.current = clock;
  }, [clock, levels]);

  const updateLevel = (key: string, values: Partial<EditableLevel>) => {
    setSelectedPreset(null);
    setSchedule(current => current.map(level => level.key === key ? { ...level, ...values } : level));
  };

  const applyPreset = (presetId: TournamentPresetId) => {
    const preset = getTournamentPreset(presetId);
    setSchedule(toEditableSchedule(presetId));
    setSelectedPreset(presetId);
    form.setFieldsValue({ startingStack: preset.startingStack });
    setPresetAnnouncement(`Đã áp dụng cấu trúc ${preset.name}, stack ${preset.startingStack.toLocaleString('vi-VN')} chip.`);
  };

  const addScheduleLevel = (kind: TournamentLevelKind) => {
    setSelectedPreset(null);
    setSchedule(current => [...current, newLevel(kind)]);
  };

  const removeScheduleLevel = (key: string) => {
    setSelectedPreset(null);
    setSchedule(current => current.filter(item => item.key !== key));
  };

  const handleCreate = async (values: SetupValues) => {
    if (!season) return;
    const invalidLevel = schedule.some(level => level.durationMinutes <= 0
      || (level.kind === 'level' && (level.smallBlind <= 0 || level.bigBlind <= level.smallBlind)));
    if (invalidLevel) {
      message.warning('Kiểm tra thời lượng và mức blind: BB phải lớn hơn SB.');
      return;
    }

    try {
      const result = await run(`tournament:create:${season.id}`, () => createTournament({
        seasonId: season.id,
        name: values.name,
        playerIds: values.playerIds,
        startingStack: values.startingStack,
        levels: schedule.map(level => ({
          kind: level.kind,
          durationSeconds: Math.round(level.durationMinutes * 60),
          smallBlind: level.smallBlind,
          bigBlind: level.bigBlind,
          ante: level.ante,
        })),
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') {
        message.warning(result.message);
        await fetchData();
        return;
      }
      message.success('Đã tạo giải đấu. Đồng hồ đang ở trạng thái sẵn sàng.');
      form.resetFields();
      setSchedule(defaultSchedule());
      setSelectedPreset('standard');
      await fetchData();
    } catch {
      message.error('Không thể tạo giải đấu. Dữ liệu nhập vẫn được giữ để bạn thử lại.');
    }
  };

  const clockMutationKey = tournament ? `tournament:clock:${tournament.id}` : 'tournament:clock';

  const handleControl = async (action: TournamentClockAction) => {
    if (!tournament) return false;
    try {
      const result = await run(clockMutationKey, () => controlTournamentClock({
        tournamentId: tournament.id,
        action,
        expectedVersion: tournament.version,
        requestId: createRequestId(),
      }));
      if (!result) return false;
      if (result.status === 'conflict') {
        message.warning(result.message);
        await fetchData();
        return false;
      }
      setTournament(result.data);
      setNow(Date.now());
      return true;
    } catch {
      message.error('Điều khiển đồng hồ thất bại. Vui lòng thử lại.');
      return false;
    }
  };

  const handleConfirmation = async () => {
    if (!tournament || !confirmation) return;
    if (confirmation === 'reset') {
      if (await handleControl('reset')) {
        setConfirmation(null);
        message.success('Đã đặt lại đồng hồ về mức đầu tiên.');
      }
      return;
    }

    try {
      const result = await run(clockMutationKey, () => completeTournament({
        tournamentId: tournament.id,
        expectedVersion: tournament.version,
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') {
        message.warning(result.message);
        setConfirmation(null);
        await fetchData();
        return;
      }
      setConfirmation(null);
      message.success('Đã kết thúc giải đấu.');
      await fetchData();
    } catch {
      message.error('Không thể kết thúc giải đấu.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
        <Spin size="large" />
        <span className="text-sm text-gray-400">Đang tải phòng điều hành...</span>
      </div>
    );
  }

  if (!season) {
    return (
      <section className="animate-fade-in">
        {error && <Alert className="mb-5" type="error" showIcon message="Không thể tải dữ liệu" description={error} action={<Button onClick={() => void fetchData()}>Thử lại</Button>} />}
        <div className="rounded-3xl border border-white/10 bg-[#1a1d2e] px-6 py-12 text-center shadow-2xl">
          <TrophyOutlined className="text-5xl text-yellow-400" />
          <h2 className="mt-5 text-2xl font-black text-white">Cần một Season đang hoạt động</h2>
          <p className="mx-auto mt-2 max-w-md text-gray-400">Tournament được lưu trong Season để không trộn dữ liệu giữa các mùa.</p>
          <Link to="/live-table" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-yellow-400 px-5 font-bold text-black">Đi tới quản lý bàn</Link>
        </div>
      </section>
    );
  }

  if (!tournament || !clock) {
    const creating = isPending(`tournament:create:${season.id}`);
    const cashTableIsActive = activeSession?.game_type === 'cash';
    return (
      <section className="animate-fade-in pb-8">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-yellow-400"><ClockCircleOutlined /> Tournament control</div>
          <h2 className="m-0 text-2xl font-black tracking-tight text-white sm:text-3xl">Thiết lập giải đấu</h2>
          <p className="mt-2 text-sm text-gray-400">Season: <span className="font-semibold text-gray-200">{season.name}</span></p>
        </header>

        {error && <Alert className="mb-5" type="error" showIcon message="Chưa thể mở Tournament" description={error} action={<Button onClick={() => void fetchData()}>Thử lại</Button>} />}
        {cashTableIsActive && <Alert className="mb-5" type="warning" showIcon message="Season đang có bàn cash hoạt động" description="Hãy chốt hoặc hủy bàn cash trước khi tạo Tournament." action={<Link to="/live-table">Mở bàn chơi</Link>} />}

        <section className="mb-5 rounded-2xl border border-white/10 bg-[#1a1d2e] p-5 shadow-xl sm:p-6" aria-labelledby="tournament-presets-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="tournament-presets-title" className="m-0 text-lg font-bold text-white">Thiết lập nhanh</h3>
              <p className="m-0 mt-1 text-sm text-gray-400">Chọn nhịp thi đấu, hệ thống tự tạo stack, blind, Big Blind Ante và giờ nghỉ.</p>
            </div>
            {selectedPreset === null && <Tag color="gold" className="m-0">Lịch đang tùy chỉnh</Tag>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tournamentPresets.map(preset => {
              const selected = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={creating}
                  onClick={() => applyPreset(preset.id)}
                  className={`min-h-36 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-yellow-400 bg-yellow-400/10' : 'border-white/10 bg-[#111420] hover:border-white/25 hover:bg-white/[0.04]'}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-base font-black text-white">{preset.name}</span>
                    {selected && <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">Đã chọn</span>}
                  </span>
                  <span className="mt-1 block min-h-10 text-xs leading-5 text-gray-400">{preset.summary}</span>
                  <span className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-gray-300">
                    <span>{preset.startingStack.toLocaleString('vi-VN')} chip</span>
                    <span>{preset.levelMinutes} phút/mức</span>
                    <span>{preset.blindLevelCount} mức blind</span>
                    <span>Khoảng {formatScheduledDuration(preset.scheduledMinutes)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="sr-only" aria-live="polite" aria-atomic="true">{presetAnnouncement}</div>
        </section>

        <Form<SetupValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={creating}
          initialValues={{ startingStack: getTournamentPreset('standard').startingStack }}
          onFinish={handleCreate}
          className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]"
        >
          <div className="min-w-0 rounded-2xl border border-white/10 bg-[#1a1d2e] p-5 shadow-xl sm:p-6">
            <h3 className="m-0 mb-5 text-lg font-bold text-white">Thông tin chung</h3>
            <Form.Item name="name" label="Tên giải đấu" rules={[{ required: true, whitespace: true, message: 'Nhập tên giải đấu' }]}>
              <Input size="large" placeholder="Ví dụ: Friday Night Turbo" autoComplete="off" />
            </Form.Item>
            <Form.Item name="startingStack" label="Stack khởi điểm" rules={[{ required: true, message: 'Nhập stack khởi điểm' }]}>
              <InputNumber min={1} precision={0} size="large" className="w-full" />
            </Form.Item>
            <Form.Item name="playerIds" label="Người tham gia" rules={[{ required: true, type: 'array', min: 2, message: 'Chọn ít nhất 2 người chơi' }]}>
              <Select mode="multiple" size="large" placeholder="Chọn người chơi" optionFilterProp="label" options={players.map(player => ({ value: player.id, label: player.name }))} />
            </Form.Item>
            {players.length < 2 && <Alert type="warning" showIcon message="Cần ít nhất 2 người chơi đang hoạt động" />}
          </div>

          <div className="min-w-0 rounded-2xl border border-white/10 bg-[#1a1d2e] p-5 shadow-xl sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="m-0 text-lg font-bold text-white">Lịch blind</h3><p className="m-0 mt-1 text-xs text-gray-500">Thời lượng theo phút · BBA mặc định bằng Big Blind</p></div>
              <div className="flex gap-2">
                <Button className="min-h-11" icon={<PlusOutlined />} onClick={() => addScheduleLevel('level')}>Blind</Button>
                <Button className="min-h-11" icon={<CoffeeOutlined />} onClick={() => addScheduleLevel('break')}>Nghỉ</Button>
              </div>
            </div>

            <div className="space-y-3">
              {schedule.map((level, index) => (
                <fieldset key={level.key} className="rounded-xl border border-white/10 bg-[#111420] p-3 sm:p-4">
                  <legend className="px-2 text-xs font-bold uppercase tracking-wider text-gray-400">Mức {index + 1}</legend>
                  <div className="space-y-3">
                    <div className="flex min-w-0 gap-2">
                      <Select aria-label={`Loại mức ${index + 1}`} value={level.kind} className="w-28 shrink-0" onChange={(kind: TournamentLevelKind) => updateLevel(level.key, { kind })} options={[{ value: 'level', label: 'Blind' }, { value: 'break', label: 'Giải lao' }]} />
                      <InputNumber aria-label={`Thời lượng mức ${index + 1}`} min={1} precision={0} value={level.durationMinutes} onChange={value => updateLevel(level.key, { durationMinutes: Number(value) })} addonAfter="phút" className="min-w-0 flex-1" />
                      <Button danger aria-label={`Xóa mức ${index + 1}`} className="min-h-8 min-w-10 shrink-0" icon={<DeleteOutlined />} disabled={schedule.length === 1} onClick={() => removeScheduleLevel(level.key)} />
                    </div>
                    {level.kind === 'level' && <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                      <InputNumber aria-label={`Small blind mức ${index + 1}`} min={1} precision={0} value={level.smallBlind} onChange={value => updateLevel(level.key, { smallBlind: Number(value) })} addonBefore="SB" className="min-w-0 w-full" />
                      <InputNumber aria-label={`Big blind mức ${index + 1}`} min={1} precision={0} value={level.bigBlind} onChange={value => updateLevel(level.key, { bigBlind: Number(value) })} addonBefore="BB" className="min-w-0 w-full" />
                      <InputNumber aria-label={`Big blind ante mức ${index + 1}`} min={0} precision={0} value={level.ante} onChange={value => updateLevel(level.key, { ante: Number(value) })} addonBefore="BBA" className="min-w-0 w-full" />
                    </div>}
                  </div>
                </fieldset>
              ))}
            </div>

            <Button type="primary" htmlType="submit" size="large" icon={<PlayCircleOutlined />} loading={creating} disabled={creating || players.length < 2 || cashTableIsActive || Boolean(error)} className="mt-6 min-h-12 w-full bg-yellow-400 font-black text-black">
              Tạo phòng Tournament
            </Button>
          </div>
        </Form>
      </section>
    );
  }

  const currentLevel = levels[clock.currentLevelIndex];
  const nextLevel = levels[clock.currentLevelIndex + 1];
  const mutationPending = isPending(clockMutationKey);
  const primaryAction: TournamentClockAction = tournament.clock_status === 'running'
    ? 'pause'
    : tournament.clock_status === 'paused' ? 'resume' : 'start';
  const primaryLabel = tournament.clock_status === 'running' ? 'Tạm dừng' : tournament.clock_status === 'paused' ? 'Tiếp tục' : 'Bắt đầu';

  return (
    <section className="animate-fade-in pb-8">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {error && <Alert className="mb-5" type="error" showIcon message="Dữ liệu có thể chưa mới nhất" description={error} action={<Button onClick={() => void fetchData()}>Tải lại</Button>} />}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-yellow-400"><TrophyOutlined /> {season.name}</div>
          <h2 className="m-0 text-2xl font-black text-white sm:text-3xl">{tournament.name}</h2>
        </div>
        <Tag color={clock.clockStatus === 'running' ? 'success' : clock.clockStatus === 'paused' ? 'warning' : 'default'} className="px-3 py-1 text-sm font-bold">{clock.isScheduleComplete ? 'Hết lịch blind' : statusLabel[clock.clockStatus]}</Tag>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="overflow-hidden rounded-3xl border border-yellow-400/20 bg-[#171a29] shadow-2xl shadow-black/30">
          <div className={`px-5 py-8 text-center sm:px-8 sm:py-10 ${currentLevel?.kind === 'break' ? 'bg-blue-500/10' : 'bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.14),transparent_62%)]'}`}>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-gray-400">{currentLevel?.kind === 'break' ? 'Giải lao' : `Blind ${clock.currentLevelIndex + 1} / ${levels.length}`}</div>
            <div className="mt-4 font-mono text-[clamp(4rem,14vw,8.5rem)] font-black leading-none tabular-nums tracking-[-0.08em] text-white" aria-label={`Còn ${formatTournamentClock(clock.remainingSeconds)}`}>
              {formatTournamentClock(clock.remainingSeconds)}
            </div>
            <div className={`mt-5 text-[clamp(1.6rem,5vw,3rem)] font-black ${currentLevel?.kind === 'break' ? 'text-blue-300' : 'text-yellow-400'}`}>{describeLevel(currentLevel)}</div>
            {nextLevel && <div className="mt-4 text-sm text-gray-400">Tiếp theo: <span className="font-semibold text-gray-200">{describeLevel(nextLevel)}</span></div>}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/10 bg-[#111420] p-4 sm:grid-cols-4 sm:p-5">
            <Button className="min-h-12" icon={<StepBackwardOutlined />} disabled={mutationPending || clock.currentLevelIndex === 0} onClick={() => void handleControl('previous')}>Mức trước</Button>
            <Button type="primary" className="min-h-12 bg-yellow-400 font-black text-black" icon={primaryAction === 'pause' ? <PauseCircleOutlined /> : <PlayCircleOutlined />} loading={mutationPending} disabled={mutationPending || clock.isScheduleComplete} onClick={() => void handleControl(primaryAction)}>{primaryLabel}</Button>
            <Button className="min-h-12" icon={<StepForwardOutlined />} disabled={mutationPending || !nextLevel || clock.isScheduleComplete} onClick={() => void handleControl('next')}>Mức sau</Button>
            <Button className="min-h-12" icon={<ReloadOutlined />} disabled={mutationPending} onClick={() => setConfirmation('reset')}>Đặt lại</Button>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-[#1a1d2e] p-5 shadow-xl">
            <div className="flex items-center justify-between"><h3 className="m-0 text-base font-bold text-white">Người tham gia</h3><span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-bold text-gray-300">{tournamentPlayers.length}</span></div>
            <div className="mt-4 space-y-2">
              {tournamentPlayers.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có người chơi" /> : tournamentPlayers.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 rounded-xl bg-[#111420] px-3 py-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-400/10 text-yellow-400"><UserOutlined /></div>
                  <div className="min-w-0"><div className="truncate font-semibold text-white">{entry.players?.name ?? 'Người chơi'}</div><div className="text-xs text-gray-500">{Number(entry.starting_stack).toLocaleString('vi-VN')} chips</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#1a1d2e] p-5">
            <h3 className="m-0 text-base font-bold text-white">Điều hành</h3>
            <p className="mt-2 text-xs leading-5 text-gray-500">Đồng hồ dùng mốc giờ server. Mở lại trình duyệt hoặc đổi thiết bị vẫn khôi phục đúng thời gian.</p>
            <Button danger className="mt-4 min-h-11 w-full" icon={<CheckOutlined />} disabled={mutationPending} onClick={() => setConfirmation('complete')}>Kết thúc giải đấu</Button>
          </div>
        </aside>
      </div>

      <Modal
        open={confirmation !== null}
        title={confirmation === 'reset' ? 'Đặt lại đồng hồ?' : 'Kết thúc giải đấu?'}
        okText={confirmation === 'reset' ? 'Đặt lại' : 'Kết thúc'}
        cancelText="Quay lại"
        okButtonProps={{ danger: true, disabled: mutationPending }}
        confirmLoading={mutationPending}
        maskClosable={!mutationPending}
        closable={!mutationPending}
        onCancel={() => !mutationPending && setConfirmation(null)}
        onOk={() => void handleConfirmation()}
      >
        <p>{confirmation === 'reset' ? 'Đồng hồ trở về mức đầu tiên và dừng ở trạng thái sẵn sàng.' : 'Phiên Tournament sẽ được khóa và không thể tiếp tục điều khiển.'}</p>
      </Modal>
    </section>
  );
}
