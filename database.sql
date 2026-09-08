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

-- Tạo RLS policies
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players ENABLE ROW LEVEL SECURITY;

-- Tạo policy cho phép tất cả các thao tác (cho public sử dụng nếu chưa có auth)
CREATE POLICY "Allow all operations for players" ON players FOR ALL USING (true);
CREATE POLICY "Allow all operations for seasons" ON seasons FOR ALL USING (true);
CREATE POLICY "Allow all operations for sessions" ON sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations for session_players" ON session_players FOR ALL USING (true);

-- Mutation hardening: idempotent writes, atomic table creation, and active-state invariants.
CREATE TABLE IF NOT EXISTS mutation_receipts (
    request_id UUID PRIMARY KEY,
    operation TEXT NOT NULL,
    result_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE session_players
    ADD COLUMN IF NOT EXISTS rebuy_history JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM seasons WHERE is_active GROUP BY is_active HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM sessions WHERE status = 'active' GROUP BY season_id HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate active seasons or sessions found. Resolve existing data before applying constraints.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active_idx
    ON seasons (is_active) WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_season_idx
    ON sessions (season_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION create_player(p_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row players; v_payload JSONB;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'create_player') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    INSERT INTO players(name) VALUES (trim(p_name)) RETURNING * INTO v_row;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION create_season(p_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row seasons; v_payload JSONB;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'create_season') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    INSERT INTO seasons(name, is_active) VALUES (trim(p_name), true) RETURNING * INTO v_row;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict', 'message', 'Đã có một Season đang hoạt động.');
END;
$$;

CREATE OR REPLACE FUNCTION create_table_with_players(
    p_season_id UUID,
    p_player_ids UUID[],
    p_default_buy_in NUMERIC,
    p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_session sessions; v_payload JSONB; v_count INTEGER;
BEGIN
    IF p_default_buy_in < 0 OR COALESCE(array_length(p_player_ids, 1), 0) = 0 THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Dữ liệu mở bàn không hợp lệ.');
    END IF;
    SELECT COUNT(*) INTO v_count FROM unnest(p_player_ids) AS ids(player_id);
    IF v_count <> (SELECT COUNT(DISTINCT player_id) FROM unnest(p_player_ids) AS ids(player_id)) THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Danh sách người chơi không được trùng.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND is_active) THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Season không còn hoạt động.');
    END IF;

    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'create_table_with_players') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;

    INSERT INTO sessions(season_id, status, date)
    VALUES (p_season_id, 'active', CURRENT_DATE)
    RETURNING * INTO v_session;

    INSERT INTO session_players(session_id, player_id, buy_in, cash_out, rebuy_history)
    SELECT v_session.id, ids.player_id, p_default_buy_in, 0,
           CASE WHEN p_default_buy_in > 0 THEN jsonb_build_array(jsonb_build_object(
               'amount', p_default_buy_in, 'time', to_char(NOW(), 'HH24:MI:SS'), 'type', 'Initial Buy-in'
           )) ELSE '[]'::jsonb END
    FROM unnest(p_player_ids) AS ids(player_id);

    v_payload := to_jsonb(v_session);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict', 'message', 'Đã có một bàn đang chơi trong Season này.');
END;
$$;

CREATE OR REPLACE FUNCTION add_session_player(
    p_session_id UUID, p_player_id UUID, p_buy_in NUMERIC, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row session_players; v_payload JSONB;
BEGIN
    IF p_buy_in < 0 THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Buy-in không hợp lệ.'); END IF;
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'add_session_player') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    INSERT INTO session_players(session_id, player_id, buy_in, cash_out, rebuy_history)
    VALUES (p_session_id, p_player_id, p_buy_in, 0,
            CASE WHEN p_buy_in > 0 THEN jsonb_build_array(jsonb_build_object('amount', p_buy_in, 'time', to_char(NOW(), 'HH24:MI:SS'), 'type', 'Initial Buy-in')) ELSE '[]'::jsonb END)
    RETURNING * INTO v_row;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict', 'message', 'Người chơi này đã có trong bàn.');
END;
$$;

CREATE OR REPLACE FUNCTION apply_rebuy(
    p_session_player_id UUID, p_amount NUMERIC, p_type TEXT, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row session_players; v_payload JSONB;
BEGIN
    IF p_amount <= 0 THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Số chip phải lớn hơn 0.'); END IF;
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'apply_rebuy') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    UPDATE session_players AS sp
    SET buy_in = sp.buy_in + p_amount,
        rebuy_history = COALESCE(sp.rebuy_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('amount', p_amount, 'time', to_char(NOW(), 'HH24:MI:SS'), 'type', p_type))
    FROM sessions AS s
    WHERE sp.id = p_session_player_id AND s.id = sp.session_id AND s.status = 'active'
    RETURNING sp.* INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Bàn đã đóng hoặc người chơi không tồn tại.'); END IF;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION set_cashout(
    p_session_player_id UUID, p_cash_out NUMERIC, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row session_players; v_payload JSONB;
BEGIN
    IF p_cash_out < 0 THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Cash-out không hợp lệ.'); END IF;
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'set_cashout') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    UPDATE session_players AS sp SET cash_out = p_cash_out
    FROM sessions AS s
    WHERE sp.id = p_session_player_id AND s.id = sp.session_id AND s.status = 'active'
    RETURNING sp.* INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Bàn đã đóng hoặc người chơi không tồn tại.'); END IF;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION toggle_player_status(
    p_player_id UUID, p_expected_status TEXT, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row players; v_payload JSONB;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'toggle_player_status') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;
    UPDATE players SET status = CASE WHEN p_expected_status = 'active' THEN 'inactive' ELSE 'active' END
    WHERE id = p_player_id AND status = p_expected_status
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Trạng thái người chơi đã thay đổi, vui lòng tải lại.'); END IF;
    v_payload := to_jsonb(v_row);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION complete_session(p_session_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row sessions; v_payload JSONB; v_checksum NUMERIC;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'complete_session') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id; RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload); END IF;
    SELECT COALESCE(SUM(profit), 0) INTO v_checksum FROM session_players WHERE session_id = p_session_id;
    IF v_checksum <> 0 THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Checksum của bàn chưa khớp 0.'); END IF;
    UPDATE sessions SET status = 'completed' WHERE id = p_session_id AND status = 'active' RETURNING * INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Bàn đã được chốt hoặc không tồn tại.'); END IF;
    v_payload := to_jsonb(v_row); UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_session(p_session_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID; v_payload JSONB;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'cancel_session') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id; RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload); END IF;
    DELETE FROM sessions WHERE id = p_session_id AND status = 'active' RETURNING id INTO v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Bàn đã được chốt hoặc không tồn tại.'); END IF;
    v_payload := jsonb_build_object('id', v_id); UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION complete_season(p_season_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row seasons; v_payload JSONB;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation) VALUES (p_request_id, 'complete_season') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN SELECT result_payload INTO v_payload FROM mutation_receipts WHERE request_id = p_request_id; RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload); END IF;
    IF EXISTS (SELECT 1 FROM sessions WHERE season_id = p_season_id AND status = 'active') THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Hãy chốt tất cả bàn đang chơi trước.'); END IF;
    UPDATE seasons SET is_active = false, end_date = NOW() WHERE id = p_season_id AND is_active RETURNING * INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'message', 'Season đã được tổng kết hoặc không tồn tại.'); END IF;
    v_payload := to_jsonb(v_row); UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;
