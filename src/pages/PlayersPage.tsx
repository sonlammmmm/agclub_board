import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Table, message } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { useAsyncMutation } from '../hooks/useAsyncMutation';
import { addPlayer, createRequestId, togglePlayerStatus } from '../lib/mutations';
import { supabase } from '../lib/supabase';
import type { Player } from '../types/poker';

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { run, isPending } = useAsyncMutation();

  const fetchPlayers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.from('players').select('*').order('name');
      if (queryError) throw queryError;
      setPlayers((data || []) as Player[]);
    } catch (queryError) {
      console.error('Không thể tải danh sách người chơi', queryError);
      setError('Không thể tải danh sách người chơi. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPlayers(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchPlayers]);

  const handleAddPlayer = async (values: { name: string }) => {
    try {
      const result = await run('player:create', () => addPlayer({ name: values.name, requestId: createRequestId() }));
      if (!result) return;
      if (result.status === 'conflict') return message.warning(result.message);
      message.success('Đã thêm người chơi');
      setIsModalOpen(false);
      form.resetFields();
      await fetchPlayers();
    } catch {
      message.error('Thêm người chơi thất bại');
    }
  };

  const toggleStatus = async (player: Player) => {
    const newStatus = player.status === 'active' ? 'inactive' : 'active';
    try {
      const result = await run(`player:status:${player.id}`, () => togglePlayerStatus({
        playerId: player.id,
        expectedStatus: player.status,
        requestId: createRequestId(),
      }));
      if (!result) return;
      if (result.status === 'conflict') {
        message.warning(result.message);
        await fetchPlayers();
        return;
      }
      setPlayers(current => current.map(item => item.id === player.id ? { ...item, status: newStatus } : item));
      message.success('Cập nhật thành công');
    } catch {
      message.error('Cập nhật trạng thái thất bại');
    }
  };

  const columns = [
    {
      title: 'Tên người chơi',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong className="text-lg">{text}</strong>,
    },
    {
      title: 'Trạng thái',
      key: 'status',
      render: (_value: unknown, record: Player) => {
        const active = record.status === 'active';
        const pending = isPending(`player:status:${record.id}`);
        return (
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-busy={pending}
            aria-label={`${active ? 'Tắt' : 'Bật'} trạng thái người chơi ${record.name}`}
            className={`inline-flex min-h-11 min-w-[112px] items-center justify-between gap-2 rounded-full px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400 ${active ? 'bg-yellow-400 text-black' : 'bg-[#23273d] text-gray-300'} ${pending ? 'cursor-wait opacity-60' : 'hover:brightness-110'}`}
            disabled={pending}
            onClick={() => void toggleStatus(record)}
          >
            <span>{pending ? 'Đang lưu...' : active ? 'Đang chơi' : 'Nghỉ'}</span>
            <span className={`h-4 w-4 rounded-full bg-white shadow-sm ${active ? '' : 'opacity-50'}`} aria-hidden="true" />
          </button>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
        <h2 className="text-2xl font-bold text-yellow-500 m-0">Quản lý Người chơi</h2>
        <Button type="primary" icon={<UserAddOutlined />} size="large" className="min-h-11 w-full sm:w-auto" onClick={() => setIsModalOpen(true)}>Thêm thành viên</Button>
      </div>

      {error && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="Không thể tải dữ liệu"
          description={error}
          action={<Button type="link" onClick={() => void fetchPlayers()}>Thử lại</Button>}
        />
      )}
      <Table dataSource={players} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} locale={{ emptyText: 'Chưa có người chơi nào' }} />

      <Modal title="Thêm Người Chơi Mới" open={isModalOpen} onCancel={() => !isPending('player:create') && setIsModalOpen(false)} footer={null} mask={{ closable: !isPending('player:create') }}>
        <Form form={form} layout="vertical" onFinish={handleAddPlayer} className="mt-4">
          <Form.Item name="name" label="Tên / Biệt danh" rules={[{ required: true, message: 'Vui lòng nhập tên người chơi!' }]}><Input size="large" placeholder="Nhập tên..." /></Form.Item>
          <div className="flex justify-end gap-2 mt-6">
            <Button onClick={() => setIsModalOpen(false)} disabled={isPending('player:create')}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={isPending('player:create')}>Xác nhận</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
