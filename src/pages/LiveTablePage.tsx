import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, List, Modal, Select, Spin, Tag, Typography, message } from 'antd';
import { DollarOutlined, HistoryOutlined, LeftOutlined, PlusOutlined, TrophyOutlined } from '@ant-design/icons';
import { useAsyncMutation } from '../hooks/useAsyncMutation';
import {
  addSessionPlayer,
  applyRebuy,
  cancelSession,
  completeSeason,
  completeSession,
  createRequestId,
  createSeason,
  createTable,
  setCashout,
} from '../lib/mutations';
import { supabase } from '../lib/supabase';
import type { Player, RebuyEntry, Season, Session, SessionPlayer } from '../types/poker';

const { Text } = Typography;

type ConfirmationAction =
  | { kind: 'end-table'; sessionId: string; seasonId: string }
  | { kind: 'cancel-table'; sessionId: string; seasonId: string }
  | { kind: 'end-season'; seasonId: string };

const confirmationKey = (action: ConfirmationAction) => {
  if (action.kind === 'end-table') return `session:end:${action.sessionId}`;
  if (action.kind === 'cancel-table') return `session:cancel:${action.sessionId}`;
  return `season:end:${action.seasonId}`;
};

const getErrorCode = (error: unknown) =>
  error instanceof Error && 'code' in error ? String(error.code) : '';

export default function LiveTablePage() {
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [sessionsList, setSessionsList] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sessionPlayers, setSessionPlayers] = useState<SessionPlayer[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const { run, isPending } = useAsyncMutation();

  const [isCreateSeasonModalOpen, setIsCreateSeasonModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRebuyModalOpen, setIsRebuyModalOpen] = useState(false);
  const [isCashoutModalOpen, setIsCashoutModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAddPlayerModalOpen, setIsAddPlayerModalOpen] = useState(false);
  const [selectedPlayerForAction, setSelectedPlayerForAction] = useState<SessionPlayer | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(null);

  const [formCreateSeason] = Form.useForm();
  const [formCreate] = Form.useForm();
  const [formRebuy] = Form.useForm();
  const [formCashout] = Form.useForm();
  const [formAddPlayer] = Form.useForm();

  const fetchAllPlayers = useCallback(async () => {
    const { data, error } = await supabase.from('players').select('*').eq('status', 'active');
    if (error) {
      setDataError('Không thể tải danh sách người chơi. Vui lòng thử lại.');
      return;
    }
    setAllPlayers((data || []) as Player[]);
  }, []);

  const fetchSessionsList = useCallback(async (seasonId: string) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false });

    if (error) {
      setDataError('Không thể tải danh sách bàn chơi. Vui lòng thử lại.');
      return;
    }

    const typedSessions = (data || []) as Session[];
    setSessionsList(typedSessions);
    setSelectedSession(current => current ? typedSessions.find(session => session.id === current.id) || null : current);
  }, []);

  const fetchActiveData = useCallback(async () => {
    const { data: season, error } = await supabase
      .from('seasons')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      setDataError('Không thể tải Season hiện tại. Vui lòng thử lại.');
      setLoading(false);
      return;
    }

    if (season) {
      setActiveSeason(season as Season);
      await fetchSessionsList(season.id);
    } else {
      setActiveSeason(null);
      setSessionsList([]);
    }
    setLoading(false);
  }, [fetchSessionsList]);

  const fetchSessionPlayers = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from('session_players')
      .select('*, players(name)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) {
      setDataError('Không thể tải người chơi trong bàn. Vui lòng thử lại.');
      return;
    }
    setSessionPlayers((data || []) as SessionPlayer[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchActiveData();
      void fetchAllPlayers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchActiveData, fetchAllPlayers]);

  const retryData = useCallback(async () => {
    setDataError(null);
    setLoading(true);
    await Promise.all([fetchActiveData(), fetchAllPlayers()]);
  }, [fetchActiveData, fetchAllPlayers]);

  const openSessionDetail = async (session: Session) => {
    setSelectedSession(session);
    setLoading(true);
    await fetchSessionPlayers(session.id);
    setLoading(false);
  };

  const closeSessionDetail = () => {
    setSelectedSession(null);
    setSessionPlayers([]);
  };

  const handleCreateSeason = async (values: { name: string }) => {
    try {
      const result = await run('season:create', () => createSeason({ name: values.name, requestId: createRequestId() }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success('Đã tạo Season mới!');
      setIsCreateSeasonModalOpen(false);
      formCreateSeason.resetFields();
      await fetchActiveData();
    } catch {
      message.error('Tạo Season thất bại');
    }
  };

  const handleCreateTable = async (values: { player_ids: string[]; default_buy_in?: number }) => {
    if (!activeSeason) return;
    if (sessionsList.some(session => session.status === 'active')) {
      message.warning('Vui lòng chốt bàn đang chơi trước khi tạo bàn mới!');
      return;
    }

    try {
      const result = await run(`session:create:${activeSeason.id}`, () => createTable({
        seasonId: activeSeason.id,
        playerIds: values.player_ids,
        defaultBuyIn: Number(values.default_buy_in ?? 0),
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') {
        message.warning(result.message);
        await fetchSessionsList(activeSeason.id);
        return;
      }
      message.success(result.status === 'duplicate' ? 'Bàn đã tồn tại, đang mở lại bàn.' : 'Bàn chơi đã được tạo!');
      setIsCreateModalOpen(false);
      formCreate.resetFields();
      await fetchSessionsList(activeSeason.id);
      await openSessionDetail(result.data);
    } catch (error) {
      if (getErrorCode(error) === '23505') {
        message.warning('Đã có một bàn đang chơi trong Season này.');
        await fetchSessionsList(activeSeason.id);
      } else {
        message.error('Tạo bàn thất bại');
      }
    }
  };

  const handleRebuy = async (values: { amount: number }) => {
    if (!selectedPlayerForAction || !selectedSession) return;
    try {
      const result = await run(`session-player:rebuy:${selectedPlayerForAction.id}`, () => applyRebuy({
        sessionPlayerId: selectedPlayerForAction.id,
        amount: Number(values.amount),
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success('Đã thêm chip');
      setIsRebuyModalOpen(false);
      formRebuy.resetFields();
      await fetchSessionPlayers(selectedSession.id);
    } catch {
      message.error('Lỗi khi thêm chip');
    }
  };

  const handleCashout = async (values: { cash_out: number }) => {
    if (!selectedPlayerForAction || !selectedSession) return;
    try {
      const result = await run(`session-player:cashout:${selectedPlayerForAction.id}`, () => setCashout({
        sessionPlayerId: selectedPlayerForAction.id,
        cashOut: Number(values.cash_out),
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success('Đã cập nhật chip còn lại');
      setIsCashoutModalOpen(false);
      formCashout.resetFields();
      await fetchSessionPlayers(selectedSession.id);
    } catch {
      message.error('Cập nhật cash out thất bại');
    }
  };

  const handleAddPlayerToTable = async (values: { player_id: string; buy_in: number }) => {
    if (!selectedSession) return;
    try {
      const result = await run(`session-player:add:${selectedSession.id}:${values.player_id}`, () => addSessionPlayer({
        sessionId: selectedSession.id,
        playerId: values.player_id,
        buyIn: Number(values.buy_in ?? 0),
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success('Đã thêm người chơi vào bàn!');
      setIsAddPlayerModalOpen(false);
      formAddPlayer.resetFields();
      await fetchSessionPlayers(selectedSession.id);
    } catch (error) {
      message.error(getErrorCode(error) === '23505' ? 'Người chơi này đã có trong bàn!' : 'Thêm người chơi thất bại');
    }
  };

  const handleQuickRebuy = async (player: SessionPlayer) => {
    const potSize = player.rebuy_history?.find((entry: RebuyEntry) => entry.type === 'Initial Buy-in')?.amount || 0;
    if (potSize <= 0) {
      message.warning('Người này không có Buy-in khởi điểm để bơm nhanh!');
      return;
    }
    if (!selectedSession) return;

    try {
      const result = await run(`session-player:rebuy:${player.id}`, () => applyRebuy({
        sessionPlayerId: player.id,
        amount: Number(potSize),
        type: 'Quick Rebuy (+1 Pot)',
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success(`Đã bơm nhanh +1 Pot (${potSize.toLocaleString()}) cho ${player.players?.name ?? 'người chơi'}`);
      await fetchSessionPlayers(selectedSession.id);
    } catch {
      message.error('Lỗi khi bơm chip');
    }
  };

  const confirmEndTable = () => {
    const totalProfit = sessionPlayers.reduce((sum, player) => sum + Number(player.profit), 0);
    if (totalProfit !== 0) {
      message.error(`Lệch chip! Tổng lợi nhuận hiện tại là ${totalProfit}. Không thể chốt bàn.`);
      return;
    }
    if (selectedSession && activeSeason) {
      setConfirmation({ kind: 'end-table', sessionId: selectedSession.id, seasonId: activeSeason.id });
    }
  };

  const confirmCancelTable = () => {
    if (selectedSession && activeSeason) {
      setConfirmation({ kind: 'cancel-table', sessionId: selectedSession.id, seasonId: activeSeason.id });
    }
  };

  const confirmEndSeason = () => {
    if (sessionsList.some(session => session.status === 'active')) {
      message.error('Bạn phải chốt tất cả các bàn đang chơi trước khi tổng kết Season!');
      return;
    }
    if (activeSeason) setConfirmation({ kind: 'end-season', seasonId: activeSeason.id });
  };

  const handleConfirmation = async () => {
    if (!confirmation) return;
    const action = confirmation;
    try {
      if (action.kind === 'end-table') {
        const result = await run(confirmationKey(action), () => completeSession({ sessionId: action.sessionId, requestId: createRequestId() }));
        if (!result) return;
        if (result.status === 'conflict') return message.warning(result.message);
        setSelectedSession(current => current ? { ...current, status: 'completed' } : current);
        await fetchSessionsList(action.seasonId);
        message.success('Bàn đã được đóng và khóa!');
      } else if (action.kind === 'cancel-table') {
        const result = await run(confirmationKey(action), () => cancelSession({ sessionId: action.sessionId, requestId: createRequestId() }));
        if (!result) return;
        if (result.status === 'conflict') return message.warning(result.message);
        closeSessionDetail();
        await fetchSessionsList(action.seasonId);
        message.success('Đã hủy bàn chơi!');
      } else {
        const result = await run(confirmationKey(action), () => completeSeason({ seasonId: action.seasonId, requestId: createRequestId() }));
        if (!result) return;
        if (result.status === 'conflict') return message.warning(result.message);
        await fetchActiveData();
        message.success('Đã tổng kết Season!');
      }
      setConfirmation(null);
    } catch {
      message.error('Thao tác thất bại, dữ liệu chưa bị thay đổi');
    }
  };

  const openRebuy = (record: SessionPlayer) => {
    setSelectedPlayerForAction(record);
    setIsRebuyModalOpen(true);
  };

  const openCashout = (record: SessionPlayer) => {
    setSelectedPlayerForAction(record);
    formCashout.setFieldsValue({ cash_out: record.cash_out });
    setIsCashoutModalOpen(true);
  };

  const openHistory = (record: SessionPlayer) => {
    setSelectedPlayerForAction(record);
    setIsHistoryModalOpen(true);
  };

  const confirmationPending = confirmation ? isPending(confirmationKey(confirmation)) : false;
  const confirmationModal = confirmation ? (
    <Modal
      open
      title={confirmation.kind === 'end-table' ? 'Xác nhận Chốt Bàn' : confirmation.kind === 'cancel-table' ? 'Hủy bàn chơi này?' : 'Tổng kết Mùa Giải'}
      onCancel={() => !confirmationPending && setConfirmation(null)}
      onOk={() => void handleConfirmation()}
      confirmLoading={confirmationPending}
      okButtonProps={{ danger: true, disabled: confirmationPending }}
      okText={confirmation.kind === 'end-table' ? 'Chốt & Khóa Bàn' : confirmation.kind === 'cancel-table' ? 'Hủy Bàn' : 'Kết thúc Season'}
      cancelText="Quay lại"
    >
      <p>{confirmation.kind === 'end-table' ? 'Sau khi chốt, dữ liệu sẽ được khóa và không thể sửa đổi.' : confirmation.kind === 'cancel-table' ? 'Bàn này sẽ bị xóa sạch khỏi lịch sử.' : 'Chốt sổ Season này? Sau khi chốt, bạn sẽ phải tạo Season mới để chơi tiếp.'}</p>
    </Modal>
  ) : null;

  const dataErrorNotice = dataError ? (
    <Alert
      className="mb-4"
      type="error"
      showIcon
      message="Dữ liệu chưa được tải đầy đủ"
      description={dataError}
      action={<Button type="link" onClick={() => void retryData()}>Thử lại</Button>}
    />
  ) : null;

  if (loading) return <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite"><Spin size="large" /><span className="text-sm text-gray-400">Đang tải bàn chơi...</span></div>;

  if (!activeSeason) {
    return (
      <div className="animate-fade-in">
        {dataErrorNotice}
        <h2 className="text-2xl font-black text-white tracking-wider uppercase m-0">Quản lý Bàn chơi</h2>
        <div className="bg-[#1a1d2e] border border-white/5 rounded-2xl p-8 text-center mt-10 shadow-lg">
          <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full mx-auto flex items-center justify-center mb-4 shadow-lg shadow-yellow-500/20">
            <TrophyOutlined className="text-3xl text-black" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Chưa có Season nào đang chạy</h3>
          <p className="text-gray-400 mb-6 text-sm">Bạn cần tạo một Mùa giải để bắt đầu ghi nhận thành tích.</p>
          <Button type="primary" size="large" className="bg-yellow-500 text-black border-none font-bold w-full sm:w-auto" onClick={() => setIsCreateSeasonModalOpen(true)}>
            TẠO SEASON MỚI
          </Button>
        </div>
        <Modal title="Khởi Tạo Season Mới" open={isCreateSeasonModalOpen} onCancel={() => !isPending('season:create') && setIsCreateSeasonModalOpen(false)} footer={null} mask={{ closable: !isPending('season:create') }}>
          <Form form={formCreateSeason} layout="vertical" onFinish={handleCreateSeason} className="mt-4">
            <Form.Item name="name" label="Tên Season" rules={[{ required: true, message: 'Vui lòng nhập tên' }]}>
              <Input size="large" placeholder="Nhập tên mùa giải..." />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={isPending('season:create')} disabled={isPending('season:create')} className="w-full mt-4 bg-yellow-500 text-black font-bold border-none" size="large">
              Bắt đầu Season
            </Button>
          </Form>
        </Modal>
      </div>
    );
  }

  if (selectedSession) {
    const isCompleted = selectedSession.status === 'completed';
    const totalBuyIn = sessionPlayers.reduce((sum, player) => sum + Number(player.buy_in), 0);
    const checkSum = sessionPlayers.reduce((sum, player) => sum + Number(player.profit), 0);
    return (
      <div className="animate-fade-in pb-10">
        {dataErrorNotice}
        <div className="flex items-center gap-4 mb-6">
          <Button type="text" aria-label="Quay lại danh sách bàn" icon={<LeftOutlined />} className="min-h-11 min-w-11 text-gray-400 hover:text-white" onClick={closeSessionDetail} />
          <div>
            <h2 className="text-xl md:text-2xl font-black text-white tracking-wider uppercase m-0">{isCompleted ? 'Chi tiết bàn (Đã khóa)' : 'Live Table'}</h2>
            <p className="text-gray-400 text-xs md:text-sm mt-1">{new Date(selectedSession.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(selectedSession.created_at).toLocaleDateString('vi-VN')}</p>
          </div>
        </div>

        <div className="sticky top-16 z-30 bg-[#0f111a]/95 backdrop-blur-md pt-4 pb-4 -mx-4 px-4 border-b border-white/5 shadow-xl mb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1a1d2e] p-3 rounded-2xl border border-white/5 relative overflow-hidden shadow-inner">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Tổng Buy-in</div>
              <div className="text-xl font-black text-yellow-400">{totalBuyIn.toLocaleString()}</div>
              <DollarOutlined className="absolute right-[-10px] bottom-[-10px] text-4xl text-white/5" />
            </div>
            <div className={`p-3 rounded-2xl border shadow-inner ${checkSum === 0 ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Lệch (Checksum)</div>
              <div className={`text-xl font-black ${checkSum === 0 ? 'text-green-500' : 'text-red-500'}`}>{checkSum === 0 ? 'Khớp (0)' : checkSum.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-end mb-3 px-1">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-bold m-0">Thành viên trong bàn</h3>
          {!isCompleted && <Button size="middle" type="primary" className="min-h-11 bg-[#1a1d2e] text-green-400 border border-green-400/30 font-bold" onClick={() => setIsAddPlayerModalOpen(true)}>+ Thêm người</Button>}
        </div>

        <div className="space-y-3">
          {sessionPlayers.map(player => {
            const rebuyKey = `session-player:rebuy:${player.id}`;
            const cashoutKey = `session-player:cashout:${player.id}`;
            return (
              <div key={player.id} className="bg-[#1a1d2e] rounded-2xl p-4 border border-white/5 shadow-lg flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(player.players?.name ?? player.player_id)}&backgroundColor=23273d`} alt={player.players?.name ?? 'Người chơi'} className="w-10 h-10 rounded-full bg-[#23273d] border border-white/10 object-cover" />
                    <span className="font-bold text-lg text-white">{player.players?.name ?? 'Người chơi'}</span>
                  </div>
                  <div className="text-right"><div className={`text-xl font-black ${player.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{player.profit > 0 ? '+' : ''}{Number(player.profit).toLocaleString()}</div><div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Profit</div></div>
                </div>
                <button type="button" className="grid grid-cols-2 gap-2 bg-[#0f111a] p-2 rounded-xl text-sm text-left cursor-pointer hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400" onClick={() => openHistory(player)} aria-label={`Xem lịch sử chip của ${player.players?.name ?? 'người chơi'}`}>
                  <span className="flex justify-between items-center px-2"><span className="text-gray-500">Buy-in <HistoryOutlined className="ml-1" /></span><span className="font-bold text-gray-300">{Number(player.buy_in).toLocaleString()}</span></span>
                  <span className="flex justify-between items-center px-2 border-l border-white/10"><span className="text-gray-500">Cash-out</span><span className="font-bold text-gray-300">{Number(player.cash_out).toLocaleString()}</span></span>
                </button>
                {!isCompleted && <div className="flex gap-2 mt-2">
                  <Button className="min-h-11 flex-1 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 font-black text-xs px-0 rounded-xl" loading={isPending(rebuyKey)} disabled={isPending(rebuyKey) || isPending(cashoutKey)} onClick={() => void handleQuickRebuy(player)}>+1 POT</Button>
                  <Button className="min-h-11 flex-1 bg-[#23273d] border-none text-gray-300 font-semibold text-xs px-0 rounded-xl" disabled={isPending(rebuyKey) || isPending(cashoutKey)} onClick={() => openRebuy(player)}>Rebuy</Button>
                  <Button className="min-h-11 flex-1 bg-[#23273d] border-none text-blue-400 font-bold text-xs px-0 rounded-xl" loading={isPending(cashoutKey)} disabled={isPending(rebuyKey) || isPending(cashoutKey)} onClick={() => openCashout(player)}>Cash-out</Button>
                </div>}
              </div>
            );
          })}
        </div>

        {!isCompleted && <div className="pt-6 pb-2 space-y-3">
          <Button type="primary" danger size="large" className="w-full h-14 text-lg font-black uppercase tracking-widest rounded-xl" disabled={Boolean(confirmation)} onClick={confirmEndTable}>CHỐT BÀN & KHÓA</Button>
          <Button type="text" size="large" className="w-full text-gray-500 hover:text-red-400 font-semibold uppercase tracking-widest" disabled={Boolean(confirmation)} onClick={confirmCancelTable}>Hủy bỏ bàn này</Button>
        </div>}

        <Modal title={`+ Thêm chip (${selectedPlayerForAction?.players?.name ?? ''})`} open={isRebuyModalOpen} onCancel={() => !isPending(`session-player:rebuy:${selectedPlayerForAction?.id ?? ''}`) && setIsRebuyModalOpen(false)} footer={null} mask={{ closable: !isPending(`session-player:rebuy:${selectedPlayerForAction?.id ?? ''}`) }}>
          <Form form={formRebuy} layout="vertical" onFinish={handleRebuy} className="mt-4">
            <Form.Item name="amount" label="Số chip mua thêm" rules={[{ required: true, message: 'Vui lòng nhập số chip' }]}><InputNumber min={1} autoFocus className="w-full" size="large" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={isPending(`session-player:rebuy:${selectedPlayerForAction?.id ?? ''}`)} className="w-full mt-4 bg-yellow-500 text-black font-bold border-none" size="large">Xác nhận Rebuy</Button>
          </Form>
        </Modal>

        <Modal title={`Chốt chip (${selectedPlayerForAction?.players?.name ?? ''})`} open={isCashoutModalOpen} onCancel={() => !isPending(`session-player:cashout:${selectedPlayerForAction?.id ?? ''}`) && setIsCashoutModalOpen(false)} footer={null} mask={{ closable: !isPending(`session-player:cashout:${selectedPlayerForAction?.id ?? ''}`) }}>
          <Form form={formCashout} layout="vertical" onFinish={handleCashout} className="mt-4">
            <Form.Item name="cash_out" label="Số chip CÒN LẠI (Mang về)" rules={[{ required: true, message: 'Vui lòng nhập số chip' }]}><InputNumber min={0} autoFocus className="w-full" size="large" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={isPending(`session-player:cashout:${selectedPlayerForAction?.id ?? ''}`)} className="w-full mt-4 bg-blue-500 text-white font-bold border-none" size="large">Lưu Cash-out</Button>
          </Form>
        </Modal>

        <Modal title={`Lịch sử Buy-in của ${selectedPlayerForAction?.players?.name ?? ''}`} open={isHistoryModalOpen} onCancel={() => setIsHistoryModalOpen(false)} footer={null}>
          {selectedPlayerForAction?.rebuy_history?.length ? <List dataSource={selectedPlayerForAction.rebuy_history} renderItem={(item: RebuyEntry) => <List.Item><div className="flex justify-between w-full"><Text className="text-gray-400">{item.time}</Text><Text className="text-gray-300 font-semibold">{item.type}</Text><Text className="text-yellow-400 font-bold">{Number(item.amount).toLocaleString()}</Text></div></List.Item>} /> : <p className="text-gray-500 text-center my-4">Chưa có lịch sử</p>}
        </Modal>

        <Modal title="Thêm Người Chơi Vào Bàn" open={isAddPlayerModalOpen} onCancel={() => !isPending(`session-player:add:${selectedSession.id}:${formAddPlayer.getFieldValue('player_id') ?? ''}`) && setIsAddPlayerModalOpen(false)} footer={null}>
          <Form form={formAddPlayer} layout="vertical" onFinish={handleAddPlayerToTable} className="mt-4">
            <Form.Item name="player_id" label="Chọn người chơi" rules={[{ required: true, message: 'Vui lòng chọn người chơi' }]}><Select placeholder="Chọn thành viên" size="large">{allPlayers.filter(player => !sessionPlayers.some(current => current.player_id === player.id)).map(player => <Select.Option key={player.id} value={player.id}>{player.name}</Select.Option>)}</Select></Form.Item>
            <Form.Item name="buy_in" label="Buy-in khởi điểm" rules={[{ required: true, message: 'Vui lòng nhập buy-in' }]}><InputNumber min={0} className="w-full" size="large" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={isPending(`session-player:add:${selectedSession.id}:${formAddPlayer.getFieldValue('player_id') ?? ''}`)} className="w-full mt-4 bg-green-600 text-white font-bold border-none" size="large">Thêm vào bàn</Button>
          </Form>
        </Modal>

        {confirmationModal}
      </div>
    );
  }

  const hasActiveSession = sessionsList.some(session => session.status === 'active');
  return (
    <div className="animate-fade-in pb-10">
      {dataErrorNotice}
      <div className="mb-6"><h2 className="text-2xl font-black text-white tracking-wider uppercase m-0">Quản lý Bàn chơi</h2></div>
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-[#23273d] to-[#1a1d2e] p-4 rounded-2xl border border-yellow-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center"><TrophyOutlined className="text-yellow-500 text-xl" /></div><div><div className="text-xs text-yellow-500 uppercase tracking-widest font-bold">Mùa giải hiện tại</div><div className="text-lg font-bold text-white">{activeSeason.name}</div></div></div>
          <Button type="primary" danger size="small" disabled={isPending(`season:end:${activeSeason.id}`)} onClick={confirmEndSeason}>Tổng kết</Button>
        </div>
        {!hasActiveSession && <Button type="primary" size="large" loading={isPending(`session:create:${activeSeason.id}`)} className="bg-blue-500 text-white border-none font-bold w-full shadow-lg shadow-blue-500/20 h-12" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>MỞ BÀN MỚI HÔM NAY</Button>}
        <div><h3 className="text-sm text-gray-400 uppercase tracking-wider font-bold mb-3">Danh sách Bàn chơi</h3>{sessionsList.length === 0 ? <div className="text-center py-10 text-gray-500">Chưa có bàn nào trong mùa giải này</div> : <div className="space-y-3">{sessionsList.map(session => <button type="button" key={session.id} className={`w-full text-left bg-[#1a1d2e] p-4 rounded-2xl border focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400 ${session.status === 'active' ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/10' : 'border-white/5 opacity-80 hover:opacity-100 transition-opacity'}`} onClick={() => void openSessionDetail(session)} aria-label={`Mở chi tiết bàn ${new Date(session.created_at).toLocaleString('vi-VN')}`}><div className="flex justify-between items-center"><div><div className="font-bold text-white text-lg">Bàn: {new Date(session.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(session.created_at).toLocaleDateString('vi-VN')}</div><div className="text-xs text-gray-400 mt-1">{session.status === 'active' ? <Tag color="warning">Đang chơi (Live)</Tag> : <Tag color="default">Đã kết thúc</Tag>}</div></div><RightIcon /></div></button>)}</div>}</div>
      </div>

      <Modal title="Mở Bàn Chơi Mới" open={isCreateModalOpen} onCancel={() => !isPending(`session:create:${activeSeason.id}`) && setIsCreateModalOpen(false)} footer={null} mask={{ closable: !isPending(`session:create:${activeSeason.id}`) }}>
        <Form form={formCreate} layout="vertical" onFinish={handleCreateTable} className="mt-4">
          <Form.Item name="player_ids" label="Chọn người chơi" rules={[{ required: true, message: 'Chọn ít nhất 1 người' }]}><Select mode="multiple" placeholder="Chọn các thành viên tham gia" size="large">{allPlayers.map(player => <Select.Option key={player.id} value={player.id}>{player.name}</Select.Option>)}</Select></Form.Item>
          <Form.Item name="default_buy_in" label="Buy-in khởi điểm (Cho mỗi người)" rules={[{ required: true, message: 'Vui lòng nhập buy-in' }]}><InputNumber min={0} className="w-full" size="large" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={isPending(`session:create:${activeSeason.id}`)} className="w-full mt-4 bg-blue-500 text-white border-none font-bold" size="large">Xác nhận mở bàn</Button>
        </Form>
      </Modal>
      {confirmationModal}
    </div>
  );
}

const RightIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>;
