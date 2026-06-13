import { useState, useEffect } from 'react';
import { Button, Modal, Form, Input, InputNumber, message, Select, Spin, Tag, List, Typography } from 'antd';
import { PlusOutlined, SaveOutlined, DollarOutlined, PlaySquareOutlined, TrophyOutlined, LeftOutlined, HistoryOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase';

const { Text } = Typography;

export default function LiveTablePage() {
  const [activeSeason, setActiveSeason] = useState<any>(null);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any>(null); // Bàn đang được chọn để xem

  const [sessionPlayers, setSessionPlayers] = useState<any[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateSeasonModalOpen, setIsCreateSeasonModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRebuyModalOpen, setIsRebuyModalOpen] = useState(false);
  const [isCashoutModalOpen, setIsCashoutModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAddPlayerModalOpen, setIsAddPlayerModalOpen] = useState(false);

  const [selectedPlayerForAction, setSelectedPlayerForAction] = useState<any>(null);

  const [formCreateSeason] = Form.useForm();
  const [formCreate] = Form.useForm();
  const [formRebuy] = Form.useForm();
  const [formCashout] = Form.useForm();
  const [formAddPlayer] = Form.useForm();

  useEffect(() => {
    fetchActiveData();
    fetchAllPlayers();
  }, []);

  const fetchAllPlayers = async () => {
    const { data } = await supabase.from('players').select('*').eq('status', 'active');
    setAllPlayers(data || []);
  };

  const fetchActiveData = async () => {
    setLoading(true);
    const { data: season } = await supabase
      .from('seasons')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (season) {
      setActiveSeason(season);
      await fetchSessionsList(season.id);
    } else {
      setActiveSeason(null);
      setSessionsList([]);
    }
    setLoading(false);
  };

  const fetchSessionsList = async (seasonId: string) => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false });

    setSessionsList(data || []);

    // Nếu đang xem 1 bàn, cập nhật lại trạng thái bàn đó
    if (selectedSession) {
      const updatedSession = data?.find(s => s.id === selectedSession.id);
      setSelectedSession(updatedSession || null);
    }
  };

  const fetchSessionPlayers = async (sessionId: string) => {
    const { data } = await supabase
      .from('session_players')
      .select('*, players(name)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    setSessionPlayers(data || []);
  };

  // Chọn 1 bàn để xem chi tiết
  const openSessionDetail = async (session: any) => {
    setSelectedSession(session);
    setLoading(true);
    await fetchSessionPlayers(session.id);
    setLoading(false);
  };

  const closeSessionDetail = () => {
    setSelectedSession(null);
    setSessionPlayers([]);
  };

  const handleCreateSeason = async (values: any) => {
    const { error } = await supabase.from('seasons').insert([{ name: values.name, is_active: true }]);
    if (error) return message.error('Tạo Season thất bại');
    message.success('Đã tạo Season mới!');
    setIsCreateSeasonModalOpen(false);
    formCreateSeason.resetFields();
    fetchActiveData();
  };

  const handleCreateTable = async (values: any) => {
    // Check if there is an active session already
    const hasActiveSession = sessionsList.some(s => s.status === 'active');
    if (hasActiveSession) {
      return message.warning('Vui lòng chốt bàn đang chơi trước khi tạo bàn mới!');
    }

    const { data: newSession, error: sessionError } = await supabase
      .from('sessions')
      .insert([{ season_id: activeSeason.id, status: 'active', date: new Date().toISOString().split('T')[0] }])
      .select()
      .single();

    if (sessionError || !newSession) return message.error('Tạo bàn thất bại');

    const defaultBuyIn = values.default_buy_in || 0;
    const historyArray = defaultBuyIn > 0 ? [{ amount: defaultBuyIn, time: new Date().toLocaleTimeString(), type: 'Initial Buy-in' }] : [];

    const playerInserts = values.player_ids.map((pid: string) => ({
      session_id: newSession.id,
      player_id: pid,
      buy_in: defaultBuyIn,
      cash_out: 0,
      profit: -defaultBuyIn,
      rebuy_history: historyArray
    }));

    const { error: playersError } = await supabase.from('session_players').insert(playerInserts);
    if (playersError) return message.error('Thêm người chơi thất bại');

    message.success('Bàn chơi đã được tạo!');
    setIsCreateModalOpen(false);
    formCreate.resetFields();
    fetchSessionsList(activeSeason.id);
    openSessionDetail(newSession);
  };

  const handleRebuy = async (values: any) => {
    const newBuyIn = Number(selectedPlayerForAction.buy_in) + Number(values.amount);
    const newProfit = Number(selectedPlayerForAction.cash_out) - newBuyIn;

    const historyEntry = { amount: values.amount, time: new Date().toLocaleTimeString(), type: 'Rebuy' };
    const newHistory = [...(selectedPlayerForAction.rebuy_history || []), historyEntry];

    const { error } = await supabase
      .from('session_players')
      .update({ buy_in: newBuyIn, profit: newProfit, rebuy_history: newHistory })
      .eq('id', selectedPlayerForAction.id);

    if (error) {
      message.error('Lỗi khi thêm chip');
    } else {
      message.success('Đã thêm chip');
      setIsRebuyModalOpen(false);
      formRebuy.resetFields();
      fetchSessionPlayers(selectedSession.id);
    }
  };

  const handleCashout = async (values: any) => {
    const newCashOut = Number(values.cash_out);
    const newProfit = newCashOut - Number(selectedPlayerForAction.buy_in);

    const { error } = await supabase
      .from('session_players')
      .update({ cash_out: newCashOut, profit: newProfit })
      .eq('id', selectedPlayerForAction.id);

    if (error) {
      message.error('Cập nhật cash out thất bại');
    } else {
      message.success('Đã cập nhật chip còn lại');
      setIsCashoutModalOpen(false);
      formCashout.resetFields();
      fetchSessionPlayers(selectedSession.id);
    }
  };

  const handleAddPlayerToTable = async (values: any) => {
    const defaultBuyIn = values.buy_in || 0;
    const historyArray = defaultBuyIn > 0 ? [{ amount: defaultBuyIn, time: new Date().toLocaleTimeString(), type: 'Initial Buy-in' }] : [];

    const insertData = {
      session_id: selectedSession.id,
      player_id: values.player_id,
      buy_in: defaultBuyIn,
      cash_out: 0,
      profit: -defaultBuyIn,
      rebuy_history: historyArray
    };

    const { error } = await supabase.from('session_players').insert([insertData]);
    if (error) {
      if (error.code === '23505') {
        message.error('Người chơi này đã có trong bàn!');
      } else {
        message.error('Thêm người chơi thất bại');
      }
    } else {
      message.success('Đã thêm người chơi vào bàn!');
      setIsAddPlayerModalOpen(false);
      formAddPlayer.resetFields();
      fetchSessionPlayers(selectedSession.id);
    }
  };

  const handleQuickRebuy = async (player: any) => {
    const potSize = player.rebuy_history?.find((h: any) => h.type === 'Initial Buy-in')?.amount || 0;
    if (potSize <= 0) {
      return message.warning('Người này không có Buy-in khởi điểm (Hoặc bằng 0) để bơm nhanh!');
    }

    const newBuyIn = Number(player.buy_in) + Number(potSize);
    const newProfit = Number(player.cash_out) - newBuyIn;

    const historyEntry = { amount: potSize, time: new Date().toLocaleTimeString(), type: 'Quick Rebuy (+1 Pot)' };
    const newHistory = [...(player.rebuy_history || []), historyEntry];

    const { error } = await supabase
      .from('session_players')
      .update({ buy_in: newBuyIn, profit: newProfit, rebuy_history: newHistory })
      .eq('id', player.id);

    if (error) {
      message.error('Lỗi khi bơm chip');
    } else {
      message.success(`Đã bơm nhanh +1 Pot (${potSize.toLocaleString()}) cho ${player.players.name}`);
      fetchSessionPlayers(selectedSession.id);
    }
  };

  const confirmEndTable = () => {
    const totalProfit = sessionPlayers.reduce((sum, p) => sum + Number(p.profit), 0);
    if (totalProfit !== 0) {
      return message.error(`Lệch chip! Tổng lợi nhuận hiện tại là ${totalProfit}. Không thể chốt bàn.`);
    }
    Modal.confirm({
      title: 'Xác nhận Chốt Bàn',
      content: 'Sau khi chốt, dữ liệu sẽ được khóa và KHÔNG THỂ SỬA ĐỔI.',
      okText: 'Chốt & Khóa Bàn',
      cancelText: 'Hủy',
      onOk: async () => {
        const { error } = await supabase.from('sessions').update({ status: 'completed' }).eq('id', selectedSession.id);
        if (error) message.error('Đóng bàn thất bại');
        else {
          message.success('Bàn đã được đóng và khóa!');
          fetchSessionsList(activeSeason.id);
          // Update selected session status
          setSelectedSession({ ...selectedSession, status: 'completed' });
        }
      },
      okButtonProps: { danger: true }
    });
  };

  const confirmCancelTable = () => {
    Modal.confirm({
      title: 'Hủy bàn chơi này?',
      content: 'Bàn này sẽ bị xóa sạch khỏi lịch sử.',
      okText: 'Hủy Bàn',
      cancelText: 'Quay lại',
      onOk: async () => {
        const { error } = await supabase.from('sessions').delete().eq('id', selectedSession.id);
        if (error) message.error('Hủy bàn thất bại');
        else {
          message.success('Đã hủy bàn chơi!');
          closeSessionDetail();
          fetchSessionsList(activeSeason.id);
        }
      },
      okButtonProps: { danger: true }
    });
  };

  const confirmEndSeason = () => {
    const hasActiveSession = sessionsList.some(s => s.status === 'active');
    if (hasActiveSession) {
      return message.error('Bạn phải chốt tất cả các bàn đang chơi trước khi tổng kết Season!');
    }

    Modal.confirm({
      title: 'Tổng kết Mùa Giải',
      content: 'Chốt sổ Mùa giải (Season) này? Sau khi chốt, bạn sẽ phải tạo Season mới để chơi tiếp.',
      okText: 'Kết thúc Season',
      cancelText: 'Hủy',
      onOk: async () => {
        const { error } = await supabase.from('seasons').update({ is_active: false }).eq('id', activeSeason.id);
        if (error) message.error('Có lỗi xảy ra');
        else {
          message.success('Đã tổng kết Season!');
          fetchActiveData();
        }
      },
      okButtonProps: { danger: true }
    });
  };

  const openRebuy = (record: any) => {
    setSelectedPlayerForAction(record);
    setIsRebuyModalOpen(true);
  };

  const openCashout = (record: any) => {
    setSelectedPlayerForAction(record);
    formCashout.setFieldsValue({ cash_out: record.cash_out });
    setIsCashoutModalOpen(true);
  };

  const openHistory = (record: any) => {
    setSelectedPlayerForAction(record);
    setIsHistoryModalOpen(true);
  };

  if (loading) {
    return <div className="text-center py-20"><Spin size="large" /></div>;
  }

  // ============== VIEW 1: CHƯA CÓ SEASON ==============
  if (!activeSeason) {
    return (
      <div className="animate-fade-in">
        <h2 className="text-2xl font-black text-white tracking-wider uppercase m-0">Quản lý Bàn chơi</h2>
        <div className="bg-[#1a1d2e] border border-white/5 rounded-2xl p-8 text-center mt-10 shadow-lg">
          <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full mx-auto flex items-center justify-center mb-4 shadow-lg shadow-yellow-500/20">
            <TrophyOutlined className="text-3xl text-black" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Chưa có Season nào đang chạy</h3>
          <p className="text-gray-400 mb-6 text-sm">Bạn cần tạo một Mùa giải (Season) ví dụ "Tháng 6/2026" để bắt đầu ghi nhận thành tích.</p>
          <Button type="primary" size="large" className="bg-yellow-500 text-black border-none font-bold w-full sm:w-auto shadow-lg shadow-yellow-500/20" onClick={() => setIsCreateSeasonModalOpen(true)}>
            TẠO SEASON MỚI
          </Button>
        </div>
        <Modal title="Khởi Tạo Season Mới" open={isCreateSeasonModalOpen} onCancel={() => setIsCreateSeasonModalOpen(false)} footer={null}>
          <Form form={formCreateSeason} layout="vertical" onFinish={handleCreateSeason} className="mt-4">
            <Form.Item name="name" label="Tên Season (VD: Tháng 6/2026)" rules={[{ required: true, message: 'Vui lòng nhập tên' }]}>
              <Input size="large" placeholder="Nhập tên mùa giải..." className="bg-[#23273d] border-white/10 text-white" />
            </Form.Item>
            <Button type="primary" htmlType="submit" className="w-full mt-4 bg-yellow-500 text-black font-bold border-none" size="large">Bắt đầu Season</Button>
          </Form>
        </Modal>
      </div>
    );
  }

  // ============== VIEW 2: CHI TIẾT 1 BÀN CHƠI (LIVE HOẶC COMPLETED) ==============
  if (selectedSession) {
    const isCompleted = selectedSession.status === 'completed';
    const totalBuyIn = sessionPlayers.reduce((sum, p) => sum + Number(p.buy_in), 0);
    const checkSum = sessionPlayers.reduce((sum, p) => sum + Number(p.profit), 0);

    return (
      <div className="animate-fade-in pb-10">
        <div className="flex items-center gap-4 mb-6">
          <Button type="text" icon={<LeftOutlined />} className="text-gray-400 hover:text-white" onClick={closeSessionDetail} />
          <div>
            <h2 className="text-xl md:text-2xl font-black text-white tracking-wider uppercase m-0">
              {isCompleted ? 'Chi tiết bàn (Đã khóa)' : 'Live Table'}
            </h2>
            <p className="text-gray-400 text-xs md:text-sm mt-1">{new Date(selectedSession.date).toLocaleDateString('vi-VN')} {isCompleted && <Tag color="default" className="ml-2">Đã kết thúc</Tag>}</p>
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
              <div className={`text-xl font-black ${checkSum === 0 ? 'text-green-500' : 'text-red-500'}`}>
                {checkSum === 0 ? 'Khớp (0)' : checkSum.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-end mb-3 px-1">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-bold m-0">Thành viên trong bàn</h3>
          {!isCompleted && (
            <Button size="small" type="primary" className="bg-[#1a1d2e] text-green-400 border border-green-400/30 font-bold shadow-lg shadow-green-500/10" onClick={() => setIsAddPlayerModalOpen(true)}>
              + Thêm người
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {sessionPlayers.map(p => (
            <div key={p.id} className="bg-[#1a1d2e] rounded-2xl p-4 border border-white/5 shadow-lg flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <img
                    src={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.players.name)}&backgroundColor=23273d`}
                    alt={p.players.name}
                    className="w-10 h-10 rounded-full bg-[#23273d] border border-white/10 object-cover"
                  />
                  <span className="font-bold text-lg text-white">{p.players.name}</span>
                </div>
                <div className="text-right">
                  <div className={`text-xl font-black ${p.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {p.profit > 0 ? '+' : ''}{p.profit.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Profit</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-[#0f111a] p-2 rounded-xl text-sm cursor-pointer hover:bg-white/5 transition-colors" onClick={() => openHistory(p)}>
                <div className="flex justify-between items-center px-2">
                  <span className="text-gray-500">Buy-in <HistoryOutlined className="ml-1" /></span>
                  <span className="font-bold text-gray-300">{Number(p.buy_in).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center px-2 border-l border-white/10">
                  <span className="text-gray-500">Cash-out</span>
                  <span className="font-bold text-gray-300">{Number(p.cash_out).toLocaleString()}</span>
                </div>
              </div>

              {!isCompleted && (
                <div className="flex gap-2 mt-2">
                  <Button className="flex-1 h-10 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 hover:text-yellow-300 font-black text-xs px-0 rounded-xl" onClick={() => handleQuickRebuy(p)}>
                    +1 POT
                  </Button>
                  <Button className="flex-1 h-10 bg-[#23273d] border-none text-gray-300 hover:text-white font-semibold text-xs px-0 rounded-xl" onClick={() => openRebuy(p)}>
                    Rebuy
                  </Button>
                  <Button className="flex-1 h-10 bg-[#23273d] border-none text-blue-400 font-bold text-xs px-0 rounded-xl" onClick={() => openCashout(p)}>
                    Cash-out
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!isCompleted && (
          <div className="pt-6 pb-2 space-y-3">
            <Button type="primary" danger size="large" className="w-full h-14 text-lg font-black uppercase tracking-widest rounded-xl shadow-lg shadow-red-500/20" onClick={confirmEndTable}>
              CHỐT BÀN & KHÓA
            </Button>
            <Button type="text" size="large" className="w-full text-gray-500 hover:text-red-400 font-semibold uppercase tracking-widest" onClick={confirmCancelTable}>
              Hủy bỏ bàn này
            </Button>
          </div>
        )}

        {/* Modal Rebuy */}
        <Modal title={`+ Thêm chip (${selectedPlayerForAction?.players?.name})`} open={isRebuyModalOpen} onCancel={() => setIsRebuyModalOpen(false)} footer={null}>
          <Form form={formRebuy} layout="vertical" onFinish={handleRebuy} className="mt-4">
            <Form.Item name="amount" label="Số chip mua thêm" rules={[{ required: true }]}>
              <InputNumber autoFocus className="w-full" size="large" formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value?.replace(/\$\s?|(,*)/g, '') as unknown as number} />
            </Form.Item>
            <Button type="primary" htmlType="submit" className="w-full mt-4 bg-yellow-500 text-black font-bold border-none" size="large">Xác nhận Rebuy</Button>
          </Form>
        </Modal>

        {/* Modal Cashout */}
        <Modal title={`Chốt chip (${selectedPlayerForAction?.players?.name})`} open={isCashoutModalOpen} onCancel={() => setIsCashoutModalOpen(false)} footer={null}>
          <Form form={formCashout} layout="vertical" onFinish={handleCashout} className="mt-4">
            <Form.Item name="cash_out" label="Số chip CÒN LẠI (Mang về)" rules={[{ required: true }]}>
              <InputNumber autoFocus className="w-full" size="large" formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value?.replace(/\$\s?|(,*)/g, '') as unknown as number} />
            </Form.Item>
            <Button type="primary" htmlType="submit" className="w-full mt-4 bg-blue-500 text-white font-bold border-none" size="large">Lưu Cash-out</Button>
          </Form>
        </Modal>

        {/* Modal Lịch sử Buy-in */}
        <Modal title={`Lịch sử Buy-in của ${selectedPlayerForAction?.players?.name}`} open={isHistoryModalOpen} onCancel={() => setIsHistoryModalOpen(false)} footer={null}>
          {selectedPlayerForAction?.rebuy_history?.length > 0 ? (
            <List
              dataSource={selectedPlayerForAction.rebuy_history}
              renderItem={(item: any) => (
                <List.Item>
                  <div className="flex justify-between w-full">
                    <Text className="text-gray-400">{item.time}</Text>
                    <Text className="text-gray-300 font-semibold">{item.type}</Text>
                    <Text className="text-yellow-400 font-bold">{Number(item.amount).toLocaleString()}</Text>
                  </div>
                </List.Item>
              )}
            />
          ) : (
            <p className="text-gray-500 text-center my-4">Chưa có lịch sử</p>
          )}
        </Modal>

        {/* Modal Thêm người chơi giữa chừng */}
        <Modal title="Thêm Người Chơi Vào Bàn" open={isAddPlayerModalOpen} onCancel={() => setIsAddPlayerModalOpen(false)} footer={null}>
          <Form form={formAddPlayer} layout="vertical" onFinish={handleAddPlayerToTable} className="mt-4">
            <Form.Item name="player_id" label="Chọn người chơi" rules={[{ required: true, message: 'Vui lòng chọn người chơi' }]}>
              <Select placeholder="Chọn thành viên" size="large" className="bg-[#23273d]">
                {allPlayers.filter(p => !sessionPlayers.find(sp => sp.player_id === p.id)).map(p => (
                  <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="buy_in" label="Buy-in khởi điểm" rules={[{ required: true }]}>
              <InputNumber className="w-full" size="large" formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value?.replace(/\$\s?|(,*)/g, '') as unknown as number} />
            </Form.Item>
            <Button type="primary" htmlType="submit" className="w-full mt-4 bg-green-600 text-white font-bold border-none" size="large">Thêm vào bàn</Button>
          </Form>
        </Modal>

      </div>
    );
  }

  // ============== VIEW 3: DANH SÁCH BÀN CHƠI TRONG SEASON ==============
  const hasActiveSession = sessionsList.some(s => s.status === 'active');

  return (
    <div className="animate-fade-in pb-10">
      <div className="mb-6">
        <h2 className="text-2xl font-black text-white tracking-wider uppercase m-0">Quản lý Bàn chơi</h2>
      </div>

      <div className="space-y-6">
        {/* Season Header */}
        <div className="bg-gradient-to-r from-[#23273d] to-[#1a1d2e] p-4 rounded-2xl border border-yellow-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center">
              <TrophyOutlined className="text-yellow-500 text-xl" />
            </div>
            <div>
              <div className="text-xs text-yellow-500 uppercase tracking-widest font-bold">Mùa giải hiện tại</div>
              <div className="text-lg font-bold text-white">{activeSeason.name}</div>
            </div>
          </div>
          <Button type="primary" danger size="small" onClick={confirmEndSeason}>
            Tổng kết
          </Button>
        </div>

        {/* Button Create Table */}
        {!hasActiveSession && (
          <Button type="primary" size="large" className="bg-blue-500 text-white border-none font-bold w-full shadow-lg shadow-blue-500/20 h-12" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>
            MỞ BÀN MỚI HÔM NAY
          </Button>
        )}

        {/* List of Sessions */}
        <div>
          <h3 className="text-sm text-gray-400 uppercase tracking-wider font-bold mb-3">Danh sách Bàn chơi</h3>
          {sessionsList.length === 0 ? (
            <div className="text-center py-10 text-gray-500">Chưa có bàn nào trong mùa giải này</div>
          ) : (
            <div className="space-y-3">
              {sessionsList.map(session => (
                <div
                  key={session.id}
                  className={`bg-[#1a1d2e] p-4 rounded-2xl border ${session.status === 'active' ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/10 cursor-pointer' : 'border-white/5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity'}`}
                  onClick={() => openSessionDetail(session)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-white text-lg">Bàn ngày {new Date(session.date).toLocaleDateString('vi-VN')}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {session.status === 'active' ? <Tag color="warning">Đang chơi (Live)</Tag> : <Tag color="default">Đã kết thúc</Tag>}
                      </div>
                    </div>
                    <RightIcon />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Create Table */}
      <Modal title="Mở Bàn Chơi Mới" open={isCreateModalOpen} onCancel={() => setIsCreateModalOpen(false)} footer={null}>
        <Form form={formCreate} layout="vertical" onFinish={handleCreateTable} className="mt-4">
          <Form.Item name="player_ids" label="Chọn người chơi" rules={[{ required: true, message: 'Chọn ít nhất 1 người' }]}>
            <Select mode="multiple" placeholder="Chọn các thành viên tham gia" size="large" className="bg-[#23273d]">
              {allPlayers.map(p => (
                <Select.Option key={p.id} value={p.id} label={p.name}>{p.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="default_buy_in" label="Buy-in khởi điểm (Cho mỗi người)" rules={[{ required: true }]}>
            <InputNumber className="w-full" size="large" formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value?.replace(/\$\s?|(,*)/g, '') as unknown as number} />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="w-full mt-4 bg-blue-500 text-white font-bold border-none" size="large">Xác nhận mở bàn</Button>
        </Form>
      </Modal>
    </div>
  );
}

const RightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);
