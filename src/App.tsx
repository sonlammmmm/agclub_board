import { Component, lazy, Suspense, type ReactNode } from 'react';
import { ConfigProvider, Spin, theme } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const LiveTablePage = lazy(() => import('./pages/LiveTablePage'));
const PlayersPage = lazy(() => import('./pages/PlayersPage'));

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen flex items-center justify-center px-6 py-12">
          <section className="w-full max-w-md rounded-2xl border border-red-400/20 bg-[#1a1d2e] p-6 text-center shadow-xl" role="alert">
            <h1 className="text-xl font-black text-white">Có lỗi xảy ra</h1>
            <p className="mt-2 text-sm text-gray-400">Trang không thể hiển thị lúc này. Vui lòng tải lại để thử lại.</p>
            <button type="button" className="mt-6 min-h-11 rounded-xl bg-yellow-400 px-5 font-bold text-black" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function PageLoading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <Spin size="large" />
      <span className="text-sm text-gray-400">Đang tải dữ liệu...</span>
    </div>
  );
}

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
      <AppErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<LeaderboardPage />} />
                <Route path="live-table" element={<LiveTablePage />} />
                <Route path="players" element={<PlayersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AppErrorBoundary>
    </ConfigProvider>
  );
}

export default App;
