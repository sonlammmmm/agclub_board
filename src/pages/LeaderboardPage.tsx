import { useState, useEffect } from 'react';
import { Spin } from 'antd';
import { CrownFilled, CaretUpFilled, CaretDownFilled } from '@ant-design/icons';
import { supabase } from '../lib/supabase';

export default function LeaderboardPage() {
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionPlayers, setSessionPlayers] = useState<any[]>([]);
  const [activeSeason, setActiveSeason] = useState<any>(null);

  const [activeTab, setActiveTab] = useState('current-season');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: pData } = await supabase.from('players').select('*');
    const { data: sData } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
    const { data: spData } = await supabase.from('session_players').select('*');
    const { data: seasonData } = await supabase.from('seasons').select('*').eq('is_active', true).limit(1).maybeSingle();

    setPlayers(pData || []);
    setSessions(sData || []);
    setSessionPlayers(spData || []);
    setActiveSeason(seasonData || null);

    setLoading(false);
  };

  const getLeaderboardData = () => {
    let currentSessions: any[] = [];
    let subtitle = '';

    if (activeTab === 'recent-table') {
      const recentSession = sessions[0];
      if (!recentSession) return { stats: [], subtitle: 'Chưa có bàn chơi nào.' };
      currentSessions = [recentSession];
      
      const timeStr = new Date(recentSession.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(recentSession.created_at).toLocaleDateString('vi-VN');
      subtitle = `Bàn: ${timeStr} - ${dateStr}`;
    } else if (activeTab === 'current-season') {
      if (!activeSeason) return { stats: [], subtitle: 'Không có Season nào đang chạy.' };
      currentSessions = sessions.filter(s => s.season_id === activeSeason.id);
      subtitle = `Mùa giải: ${activeSeason.name}`;
    } else {
      currentSessions = [...sessions];
      subtitle = 'Toàn thời gian';
    }

    currentSessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const currentSessionIds = currentSessions.map(s => s.id);
    const currentSp = sessionPlayers.filter(sp => currentSessionIds.includes(sp.session_id));

    // Calculate previous state for comparison
    let previousSessionIds: string[] = [];
    if (activeTab === 'recent-table') {
      const previousSession = sessions[1];
      if (previousSession) previousSessionIds = [previousSession.id];
    } else {
      if (currentSessions.length > 1) {
        // Exclude the most recent session to get "previous state"
        previousSessionIds = currentSessions.slice(1).map(s => s.id);
      }
    }
    const previousSp = sessionPlayers.filter(sp => previousSessionIds.includes(sp.session_id));

    const calcStats = (spList: any[]) => {
      const stats = players.map(p => {
        const pSessions = spList.filter(sp => sp.player_id === p.id);
        if (pSessions.length === 0) return null;
        const totalProfit = pSessions.reduce((sum, sp) => sum + Number(sp.profit), 0);
        return {
          id: p.id,
          name: p.name,
          totalProfit,
          gamesPlayed: pSessions.length
        };
      }).filter(Boolean) as any[];
      stats.sort((a, b) => b.totalProfit - a.totalProfit);
      stats.forEach((s, index) => s.rank = index + 1);
      return stats;
    };

    const currentStats = calcStats(currentSp);
    const previousStats = calcStats(previousSp);

    const finalStats = currentStats.map(cs => {
      const ps = previousStats.find(p => p.id === cs.id);
      let rankChange = 0;
      let profitPercent = 0;
      let hasPrevious = false;

      if (ps) {
        hasPrevious = true;
        rankChange = ps.rank - cs.rank; // >0 is UP, <0 is DOWN
        const profitChange = cs.totalProfit - ps.totalProfit;
        if (ps.totalProfit !== 0) {
          profitPercent = (profitChange / Math.abs(ps.totalProfit)) * 100;
        } else if (profitChange > 0) {
          profitPercent = 100;
        } else if (profitChange < 0) {
          profitPercent = -100;
        }
      }

      return {
        ...cs,
        rankChange,
        profitPercent,
        hasPrevious
      };
    });

    return { stats: finalStats, subtitle };
  };

  const getAvatarUrl = (name: string, bg: string) => {
    // using 'micah' style for cleaner, more 3D-like modern avatars
    return `https://api.dicebear.com/7.x/micah/svg?seed=${encodeURIComponent(name)}&backgroundColor=${bg}&radius=50`;
  };

  const PodiumItem = ({ player, rank }: { player: any, rank: number }) => {
    if (!player) return <div className="flex-1" />;

    const isFirst = rank === 1;
    const height = isFirst ? 'h-48' : rank === 2 ? 'h-36' : 'h-32';
    // Colors matching the design
    const colorFrom = isFirst ? 'from-[#ff8c42]' : rank === 2 ? 'from-[#648eff]' : 'from-[#ffc837]';
    const colorTo = isFirst ? 'to-[#ff8c42]/0' : rank === 2 ? 'to-[#648eff]/0' : 'to-[#ffc837]/0';
    const ringColor = isFirst ? 'ring-[#ff8c42]' : rank === 2 ? 'ring-[#648eff]' : 'ring-[#ffc837]';
    const bgAvatar = isFirst ? 'ffd8b1' : rank === 2 ? 'b1c8ff' : 'ffebb1';

    const isUp = player.rankChange > 0;
    const isDown = player.rankChange < 0;
    const isNew = !player.hasPrevious;
    const rankStr = Math.abs(player.rankChange).toString();

    return (
      <div className={`flex flex-col items-center justify-end flex-1 px-1 relative ${isFirst ? '-mt-10 z-10' : 'z-0'}`}>
        <div className="flex flex-col items-center mb-2">
          {isFirst && <CrownFilled className="text-[#ffc837] text-3xl mb-[-10px] z-20 drop-shadow-md" />}
          <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full bg-white ring-4 ${ringColor} p-0.5 shadow-lg mb-2 z-10 relative`}>
            <img
              src={getAvatarUrl(player.name, bgAvatar)}
              alt={player.name}
              className="w-full h-full rounded-full object-cover"
            />
          </div>
          <div className="text-center z-10">
            <div className="font-bold text-white text-[13px] md:text-sm truncate max-w-[90px]">{player.name}</div>
            <div className="inline-flex items-center justify-center bg-white/10 backdrop-blur-md px-2 py-1 rounded-full mt-1 border border-white/5">
              <span className={`font-bold text-[10px] leading-none ${player.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {player.totalProfit > 0 ? '+' : ''}{player.totalProfit.toLocaleString()}
              </span>
            </div>
            {activeTab !== 'recent-table' && (
              <div className={`mt-1.5 mx-auto flex items-center justify-center gap-0.5 px-1.5 py-0.5 w-max rounded-md font-bold text-[9px] ${
                isNew ? 'bg-blue-500/20 text-blue-400' :
                isUp ? 'bg-green-500/20 text-green-400' : 
                isDown ? 'bg-red-500/20 text-red-400' : 
                'bg-gray-500/20 text-gray-400'
              }`}>
                {isNew ? 'NEW' : isUp ? `${rankStr} ` : isDown ? `${rankStr} ` : '-'}
                {isUp && <CaretUpFilled className="text-[8px]" />}
                {isDown && <CaretDownFilled className="text-[8px]" />}
              </div>
            )}
          </div>
        </div>

        {/* The 3D Block */}
        <div className={`w-full ${height} rounded-t-xl bg-gradient-to-b ${colorFrom} ${colorTo} flex items-start justify-center pt-4 relative shadow-2xl`}>

          <div className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
            <span className="font-black text-white text-lg">{rank}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderLeaderboard = () => {
    if (loading) return <div className="py-20 text-center"><Spin size="large" /></div>;

    const { stats: leaderboard, subtitle } = getLeaderboardData();

    return (
      <div className="mt-2">
        <div className="text-center mb-10 z-10 relative">
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest">{subtitle}</div>
        </div>

        {leaderboard.length === 0 ? (
          <div className="text-center py-10 text-gray-500">Chưa có dữ liệu thành tích.</div>
        ) : (
          <div className="relative">
            {/* Podium Area */}
            <div className="flex items-end justify-center w-full max-w-md mx-auto px-4 z-0">
              <PodiumItem player={leaderboard[1]} rank={2} />
              <PodiumItem player={leaderboard[0]} rank={1} />
              <PodiumItem player={leaderboard[2]} rank={3} />
            </div>

            {/* List Area overlapping the podium bottom slightly */}
            <div className="bg-[#23273d] rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.3)] mt-[-20px] pt-8 px-4 pb-32 z-20 relative min-h-[70vh]">

              {/* Little notch handle */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/10 rounded-full"></div>

              <div className="space-y-3 max-w-md mx-auto">
                {leaderboard.slice(3).map((player, index) => {
                  const actualRank = index + 4;
                  const bgAvatar = 'e2e8f0'; // Grayish bg for list avatars

                  // Determine rank pill styling based on rankChange
                  const isUp = player.rankChange > 0;
                  const isDown = player.rankChange < 0;
                  const isNew = !player.hasPrevious;
                  const rankStr = Math.abs(player.rankChange).toString();

                  return (
                    <div key={player.id} className="flex items-center p-3 bg-[#1a1d2e] rounded-2xl border border-white/5 shadow-md">

                      <div className="w-6 text-center font-black text-gray-500 text-sm mr-2">
                        {actualRank}
                      </div>

                      <div className="w-12 h-12 rounded-full bg-white p-0.5 shadow-sm mr-3">
                        <img
                          src={getAvatarUrl(player.name, bgAvatar)}
                          alt={player.name}
                          className="w-full h-full rounded-full object-cover bg-gray-100"
                        />
                      </div>

                      <div className="flex-1">
                        <div className="font-bold text-white text-base">{player.name}</div>
                        <div className={`text-xs mt-0.5 font-bold ${player.totalProfit > 0 ? 'text-green-400' : player.totalProfit < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                          {player.totalProfit > 0 ? '+' : ''}{player.totalProfit.toLocaleString()} chips
                        </div>
                      </div>

                      <div className="ml-2 flex items-center justify-end">
                        {/* Rank Change Pill */}
                        {activeTab !== 'recent-table' && (
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg font-bold text-xs ${isNew ? 'bg-blue-500/10 text-blue-400' :
                            isUp ? 'bg-green-500/10 text-green-400' :
                              isDown ? 'bg-red-500/10 text-red-400' :
                                'bg-gray-500/10 text-gray-400'
                            }`}>
                            {isNew ? 'NEW' : isUp ? `${rankStr} ` : isDown ? `${rankStr} ` : '-'}
                            {isUp && <CaretUpFilled className="text-[10px]" />}
                            {isDown && <CaretDownFilled className="text-[10px]" />}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {leaderboard.length <= 3 && (
                  <div className="text-center text-gray-500 py-6 text-sm">
                    Không còn người chơi nào khác.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const tabItems = [
    { key: 'recent-table', label: 'Gần Nhất' },
    { key: 'current-season', label: 'Season' },
    { key: 'all-time', label: 'All-time' }
  ];

  return (
    <div className="animate-fade-in pb-10">
      <div className="sticky top-16 z-30 py-2 -mx-4 px-4 mb-[12px]" style={{ background: 'radial-gradient(circle at top, #1a1d2e 0%, #0f111a 100%) fixed' }}>
        <div className="flex bg-black/20 rounded-full p-1 border border-white/5 shadow-lg max-w-sm mx-auto">
          {tabItems.map(tab => (
            <div
              key={tab.key}
              className={`flex-1 text-center py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all duration-300 ${activeTab === tab.key ? 'bg-white text-black shadow-md' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {renderLeaderboard()}
      </div>
    </div>
  );
}
