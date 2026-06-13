import { ConfigProvider, theme } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import LeaderboardPage from './pages/LeaderboardPage';
import LiveTablePage from './pages/LiveTablePage';
import PlayersPage from './pages/PlayersPage';

function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#facc15', // Yellow 400
          colorBgBase: '#0f111a',
          colorBgContainer: '#1a1d2e',
          colorBgElevated: '#23273d',
          colorTextBase: '#ffffff',
          colorBorder: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        },
        components: {
          Layout: {
            bodyBg: 'transparent',
            headerBg: 'transparent',
            footerBg: 'transparent',
          },
          Table: {
            headerBg: '#23273d',
            rowHoverBg: '#2a2e47',
          },
          Card: {
            colorBgContainer: '#1a1d2e',
          }
        }
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<LeaderboardPage />} />
            <Route path="live-table" element={<LiveTablePage />} />
            <Route path="players" element={<PlayersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
