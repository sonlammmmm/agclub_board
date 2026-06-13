-- Bảng người chơi
CREATE TABLE players (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bảng mùa giải (Season)
CREATE TABLE seasons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bảng buổi chơi (Session / Table)
CREATE TABLE sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
    date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bảng lịch sử chip của người chơi trong 1 buổi chơi
CREATE TABLE session_players (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    buy_in NUMERIC DEFAULT 0,
    cash_out NUMERIC DEFAULT 0,
    profit NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, player_id) -- Mỗi người chỉ có 1 record trong 1 session
);

-- Tạo 1 trigger để tính toán lại profit mỗi khi update buy_in hoặc cash_out
CREATE OR REPLACE FUNCTION calculate_profit()
RETURNS TRIGGER AS $$
BEGIN
    NEW.profit = NEW.cash_out - NEW.buy_in;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calculate_profit
BEFORE INSERT OR UPDATE ON session_players
FOR EACH ROW
EXECUTE FUNCTION calculate_profit();

-- Optional: Tạo RLS policies (nếu cần bảo mật public)
-- Tạm thời disable RLS cho test nội bộ
ALTER TABLE players DISABLE ROW LEVEL SECURITY;
ALTER TABLE seasons DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_players DISABLE ROW LEVEL SECURITY;
