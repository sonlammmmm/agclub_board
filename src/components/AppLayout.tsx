import { Layout } from 'antd';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { TrophyOutlined, PlaySquareOutlined, TeamOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;

export default function AppLayout() {
  const location = useLocation();

  const menuItems = [
    {
      key: '/',
      icon: <TrophyOutlined className="text-xl" />,
      label: 'Leaderboard',
    },
    {
      key: '/live-table',
      icon: <PlaySquareOutlined className="text-xl" />,
      label: 'Live Table',
    },
    {
      key: '/players',
      icon: <TeamOutlined className="text-xl" />,
      label: 'Players',
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
        <div className="hidden md:flex gap-6">
          {menuItems.map(item => {
            const isActive = location.pathname === item.key;
            return (
              <Link 
                key={item.key} 
                to={item.key}
                className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all ${isActive ? 'bg-white/10 text-yellow-400' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >
                {item.icon}
                <span className="font-semibold">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </Header>

      <Content className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        <Outlet />
      </Content>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#1a1d2e] border-t border-white/5 z-50 flex items-center justify-around px-2 pb-safe">
        {menuItems.map(item => {
          const isActive = location.pathname === item.key;
          return (
            <Link 
              key={item.key} 
              to={item.key}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${isActive ? 'text-yellow-400' : 'text-gray-500'}`}
            >
              <div className={`p-1 rounded-xl ${isActive ? 'bg-yellow-400/10' : ''}`}>
                {item.icon}
              </div>
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </Layout>
  );
}
