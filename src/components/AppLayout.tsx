import { Layout } from 'antd';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ClockCircleOutlined, TrophyOutlined, PlaySquareOutlined, TeamOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;

export default function AppLayout() {
  const location = useLocation();

  const menuItems = [
    {
      key: '/',
      icon: <TrophyOutlined className="text-xl" />,
      label: 'Xếp hạng',
    },
    {
      key: '/live-table',
      icon: <PlaySquareOutlined className="text-xl" />,
      label: 'Bàn chơi',
    },
    {
      key: '/tournament',
      icon: <ClockCircleOutlined className="text-xl" />,
      label: 'Giải đấu',
    },
    {
      key: '/players',
      icon: <TeamOutlined className="text-xl" />,
      label: 'Người chơi',
    },
  ];

  return (
    <Layout className="min-h-screen pb-20 md:pb-0 relative">
      {/* Top Header - Desktop & Mobile */}
      <Header className="sticky top-0 z-50 flex items-center justify-between px-4 h-16 border-b border-white/5 bg-[#1a1d2e]/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center font-black text-black shadow-lg shadow-yellow-500/20">
            ♠
          </div>
          <h1 className="text-lg font-bold text-white m-0 tracking-wide uppercase">Poker Board</h1>
        </div>
        
        {/* Desktop Menu */}
        <nav className="hidden md:flex gap-1" aria-label="Điều hướng chính">
          {menuItems.map(item => {
            const isActive = location.pathname === item.key;
            return (
                <Link
                  key={item.key}
                  to={item.key}
                  aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-full px-2 py-1 text-sm transition-all ${isActive ? 'bg-white/10 text-yellow-400' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >
                {item.icon}
                <span className="font-semibold">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </Header>

      <Content className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        <Outlet />
      </Content>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#1a1d2e] border-t border-white/5 z-50 flex items-center justify-around px-1 pb-safe" aria-label="Điều hướng chính">
        {menuItems.map(item => {
          const isActive = location.pathname === item.key;
          return (
            <Link
              key={item.key} 
              to={item.key}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${isActive ? 'text-yellow-400' : 'text-gray-500'}`}
            >
              <div className={`p-1 rounded-xl ${isActive ? 'bg-yellow-400/10' : ''}`}>
                {item.icon}
              </div>
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </Layout>
  );
}
