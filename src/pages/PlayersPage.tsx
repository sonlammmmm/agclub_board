import { useState, useEffect } from 'react';
import { Button, Table, Modal, Form, Input, Switch, message } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase';

interface Player {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('players').select('*').order('name');
    if (error) {
      message.error('Lỗi khi tải danh sách người chơi');
    } else {
      setPlayers(data || []);
    }
    setLoading(false);
  };

  const handleAddPlayer = async (values: { name: string }) => {
    const { error } = await supabase.from('players').insert([{ name: values.name }]);
    if (error) {
      message.error('Thêm người chơi thất bại');
    } else {
      message.success('Đã thêm người chơi');
      setIsModalOpen(false);
      form.resetFields();
      fetchPlayers();
    }
  };

  const toggleStatus = async (player: Player) => {
    const newStatus = player.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase
      .from('players')
      .update({ status: newStatus })
      .eq('id', player.id);
    
    if (error) {
      message.error('Cập nhật trạng thái thất bại');
    } else {
      setPlayers(players.map(p => p.id === player.id ? { ...p, status: newStatus } : p));
      message.success('Cập nhật thành công');
    }
  };

  const columns = [
    { 
      title: 'Tên người chơi', 
      dataIndex: 'name', 
      key: 'name',
      render: (text: string) => <strong className="text-lg">{text}</strong>
    },
    { 
      title: 'Trạng thái', 
      key: 'status',
      render: (_: any, record: Player) => (
        <Switch 
          checked={record.status === 'active'} 
          onChange={() => toggleStatus(record)}
          checkedChildren="Đang chơi"
          unCheckedChildren="Nghỉ"
        />
      )
    }
  ];

  return (
    <div>
       <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-yellow-500 m-0">Quản lý Người chơi</h2>
        <Button 
          type="primary" 
          icon={<UserAddOutlined />} 
          size="large"
          onClick={() => setIsModalOpen(true)}
        >
          Thêm thành viên
        </Button>
      </div>

      <Table 
         dataSource={players} 
         columns={columns}
         rowKey="id"
         loading={loading}
         pagination={{ pageSize: 10 }}
         locale={{ emptyText: 'Chưa có người chơi nào' }}
      />

      <Modal
        title="Thêm Người Chơi Mới"
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleAddPlayer} className="mt-4">
          <Form.Item
            name="name"
            label="Tên / Biệt danh"
            rules={[{ required: true, message: 'Vui lòng nhập tên người chơi!' }]}
          >
            <Input size="large" placeholder="Nhập tên..." />
          </Form.Item>
          <div className="flex justify-end gap-2 mt-6">
            <Button onClick={() => setIsModalOpen(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit">Xác nhận</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
