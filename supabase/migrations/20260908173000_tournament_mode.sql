-- Tournament mode: additive schema, persisted blind clock and idempotent controls.
-- Safe for existing cash-game sessions. Apply after the mutation_receipts migration.

CREATE TABLE IF NOT EXISTS mutation_receipts (
    request_id UUID PRIMARY KEY,
    operation TEXT NOT NULL,
    result_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'cash';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sessions_game_type_check' AND conrelid = 'sessions'::regclass
    ) THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_game_type_check
            CHECK (game_type IN ('cash', 'tournament')) NOT VALID;
        ALTER TABLE sessions VALIDATE CONSTRAINT sessions_game_type_check;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tournaments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    starting_stack NUMERIC NOT NULL CHECK (starting_stack > 0),
    clock_status TEXT NOT NULL DEFAULT 'ready'
        CHECK (clock_status IN ('ready', 'running', 'paused', 'completed')),
    current_level_index INTEGER NOT NULL DEFAULT 0 CHECK (current_level_index >= 0),
    remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds >= 0),
    anchor_started_at TIMESTAMP WITH TIME ZONE,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS tournament_levels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('level', 'break')),
    small_blind NUMERIC,
    big_blind NUMERIC,
    ante NUMERIC NOT NULL DEFAULT 0 CHECK (ante >= 0),
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    UNIQUE (tournament_id, position),
    CHECK (
        (kind = 'break' AND small_blind IS NULL AND big_blind IS NULL)
        OR
        (kind = 'level' AND small_blind > 0 AND big_blind > small_blind)
    )
);

CREATE TABLE IF NOT EXISTS tournament_players (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    starting_stack NUMERIC NOT NULL CHECK (starting_stack > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (tournament_id, player_id)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM tournaments
        WHERE clock_status <> 'completed'
        GROUP BY season_id HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Multiple open tournaments exist in one Season. Resolve duplicates before applying the unique index.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_one_open_per_season_idx
    ON tournaments (season_id) WHERE clock_status <> 'completed';

CREATE INDEX IF NOT EXISTS tournament_levels_tournament_position_idx
    ON tournament_levels (tournament_id, position);

CREATE INDEX IF NOT EXISTS tournament_players_tournament_idx
    ON tournament_players (tournament_id);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tournaments' AND policyname = 'Allow read operations for tournaments') THEN
        CREATE POLICY "Allow read operations for tournaments" ON tournaments
            FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tournament_levels' AND policyname = 'Allow read operations for tournament_levels') THEN
        CREATE POLICY "Allow read operations for tournament_levels" ON tournament_levels
            FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tournament_players' AND policyname = 'Allow read operations for tournament_players') THEN
        CREATE POLICY "Allow read operations for tournament_players" ON tournament_players
            FOR SELECT USING (true);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION create_tournament(
    p_season_id UUID,
    p_name TEXT,
    p_player_ids UUID[],
    p_starting_stack NUMERIC,
    p_levels JSONB,
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session sessions;
    v_tournament tournaments;
    v_payload JSONB;
    v_existing_operation TEXT;
    v_player_count INTEGER;
BEGIN
    IF length(trim(COALESCE(p_name, ''))) = 0 THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Tên giải đấu không được để trống.');
    END IF;
    IF p_starting_stack IS NULL OR p_starting_stack <= 0 THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Stack khởi điểm phải lớn hơn 0.');
    END IF;
    IF COALESCE(array_length(p_player_ids, 1), 0) < 2 THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Cần ít nhất 2 người chơi.');
    END IF;
    IF jsonb_typeof(p_levels) <> 'array' OR jsonb_array_length(p_levels) = 0 THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Lịch blind không hợp lệ.');
    END IF;
    IF (SELECT COUNT(*) FROM unnest(p_player_ids) AS ids(player_id))
       <> (SELECT COUNT(DISTINCT player_id) FROM unnest(p_player_ids) AS ids(player_id)) THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Danh sách người chơi không được trùng.');
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_levels) level
        WHERE COALESCE(level->>'kind', '') NOT IN ('level', 'break')
           OR COALESCE((level->>'duration_seconds')::INTEGER, 0) <= 0
           OR (
               level->>'kind' = 'level'
               AND (
                   COALESCE((level->>'small_blind')::NUMERIC, 0) <= 0
                   OR COALESCE((level->>'big_blind')::NUMERIC, 0) <= COALESCE((level->>'small_blind')::NUMERIC, 0)
                   OR COALESCE((level->>'ante')::NUMERIC, 0) < 0
               )
           )
    ) THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Một hoặc nhiều mức blind không hợp lệ.');
    END IF;

    SELECT COUNT(*) INTO v_player_count FROM players WHERE id = ANY(p_player_ids) AND status = 'active';
    IF v_player_count <> array_length(p_player_ids, 1) THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Có người chơi không tồn tại hoặc đã ngừng hoạt động.');
    END IF;

    INSERT INTO mutation_receipts(request_id, operation)
    VALUES (p_request_id, 'create_tournament')
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT operation, result_payload INTO v_existing_operation, v_payload
        FROM mutation_receipts WHERE request_id = p_request_id;
        IF v_existing_operation <> 'create_tournament' THEN
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Request ID đã được dùng cho thao tác khác.');
        END IF;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;

    PERFORM 1 FROM seasons WHERE id = p_season_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Season không còn hoạt động.');
    END IF;
    IF EXISTS (SELECT 1 FROM sessions WHERE season_id = p_season_id AND status = 'active') THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Season đang có một bàn hoặc giải đấu hoạt động.');
    END IF;

    INSERT INTO sessions(season_id, status, date, game_type)
    VALUES (p_season_id, 'active', CURRENT_DATE, 'tournament')
    RETURNING * INTO v_session;

    INSERT INTO tournaments(
        session_id, season_id, name, starting_stack, clock_status,
        current_level_index, remaining_seconds
    )
    VALUES (
        v_session.id, p_season_id, trim(p_name), p_starting_stack, 'ready',
        0, (p_levels->0->>'duration_seconds')::INTEGER
    )
    RETURNING * INTO v_tournament;

    INSERT INTO tournament_levels(
        tournament_id, position, kind, small_blind, big_blind, ante, duration_seconds
    )
    SELECT
        v_tournament.id,
        ordinality::INTEGER - 1,
        level->>'kind',
        CASE WHEN level->>'kind' = 'level' THEN (level->>'small_blind')::NUMERIC ELSE NULL END,
        CASE WHEN level->>'kind' = 'level' THEN (level->>'big_blind')::NUMERIC ELSE NULL END,
        CASE WHEN level->>'kind' = 'level' THEN COALESCE((level->>'ante')::NUMERIC, 0) ELSE 0 END,
        (level->>'duration_seconds')::INTEGER
    FROM jsonb_array_elements(p_levels) WITH ORDINALITY AS entries(level, ordinality);

    INSERT INTO tournament_players(tournament_id, player_id, starting_stack)
    SELECT v_tournament.id, player_id, p_starting_stack
    FROM unnest(p_player_ids) AS ids(player_id);

    v_payload := to_jsonb(v_tournament);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict', 'message', 'Season đã có một bàn hoặc giải đấu hoạt động.');
END;
$$;

CREATE OR REPLACE FUNCTION control_tournament_clock(
    p_tournament_id UUID,
    p_action TEXT,
    p_expected_version BIGINT,
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tournament tournaments;
    v_payload JSONB;
    v_existing_operation TEXT;
    v_now TIMESTAMP WITH TIME ZONE := clock_timestamp();
    v_elapsed INTEGER := 0;
    v_duration INTEGER;
    v_last_index INTEGER;
    v_was_running BOOLEAN;
    v_schedule_complete BOOLEAN := false;
BEGIN
    IF p_action NOT IN ('start', 'resume', 'pause', 'previous', 'next', 'reset') THEN
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Lệnh điều khiển không hợp lệ.');
    END IF;

    INSERT INTO mutation_receipts(request_id, operation)
    VALUES (p_request_id, 'control_tournament_clock')
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT operation, result_payload INTO v_existing_operation, v_payload
        FROM mutation_receipts WHERE request_id = p_request_id;
        IF v_existing_operation <> 'control_tournament_clock' THEN
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Request ID đã được dùng cho thao tác khác.');
        END IF;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;

    SELECT * INTO v_tournament FROM tournaments
    WHERE id = p_tournament_id
    FOR UPDATE;
    IF NOT FOUND OR v_tournament.clock_status = 'completed' THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Giải đấu đã kết thúc hoặc không tồn tại.');
    END IF;
    IF v_tournament.version <> p_expected_version THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Đồng hồ đã được điều khiển ở tab khác. Dữ liệu đã được tải lại.');
    END IF;

    SELECT MAX(position) INTO v_last_index FROM tournament_levels
    WHERE tournament_id = p_tournament_id;
    IF v_last_index IS NULL THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Giải đấu chưa có lịch blind.');
    END IF;

    v_was_running := v_tournament.clock_status = 'running';
    IF v_was_running AND v_tournament.anchor_started_at IS NOT NULL THEN
        v_elapsed := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - v_tournament.anchor_started_at)))::INTEGER);
        WHILE v_elapsed >= v_tournament.remaining_seconds LOOP
            v_elapsed := v_elapsed - v_tournament.remaining_seconds;
            IF v_tournament.current_level_index >= v_last_index THEN
                v_tournament.remaining_seconds := 0;
                v_schedule_complete := true;
                EXIT;
            END IF;
            v_tournament.current_level_index := v_tournament.current_level_index + 1;
            SELECT duration_seconds INTO v_duration FROM tournament_levels
            WHERE tournament_id = p_tournament_id AND position = v_tournament.current_level_index;
            v_tournament.remaining_seconds := v_duration;
        END LOOP;
        IF NOT v_schedule_complete THEN
            v_tournament.remaining_seconds := v_tournament.remaining_seconds - v_elapsed;
        END IF;
    END IF;

    IF v_schedule_complete AND p_action <> 'reset' THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Lịch blind đã chạy hết. Hãy kết thúc hoặc đặt lại giải đấu.');
    END IF;

    IF p_action = 'start' THEN
        IF v_tournament.clock_status <> 'ready' THEN
            DELETE FROM mutation_receipts WHERE request_id = p_request_id;
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Đồng hồ không còn ở trạng thái sẵn sàng.');
        END IF;
        v_tournament.clock_status := 'running';
        v_tournament.anchor_started_at := v_now;
    ELSIF p_action = 'resume' THEN
        IF v_tournament.clock_status <> 'paused' THEN
            DELETE FROM mutation_receipts WHERE request_id = p_request_id;
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Đồng hồ không ở trạng thái tạm dừng.');
        END IF;
        v_tournament.clock_status := 'running';
        v_tournament.anchor_started_at := v_now;
    ELSIF p_action = 'pause' THEN
        IF NOT v_was_running THEN
            DELETE FROM mutation_receipts WHERE request_id = p_request_id;
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Đồng hồ không chạy.');
        END IF;
        v_tournament.clock_status := 'paused';
        v_tournament.anchor_started_at := NULL;
    ELSIF p_action = 'previous' THEN
        IF v_tournament.current_level_index = 0 THEN
            DELETE FROM mutation_receipts WHERE request_id = p_request_id;
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Đây đã là mức đầu tiên.');
        END IF;
        v_tournament.current_level_index := v_tournament.current_level_index - 1;
        SELECT duration_seconds INTO v_duration FROM tournament_levels
        WHERE tournament_id = p_tournament_id AND position = v_tournament.current_level_index;
        v_tournament.remaining_seconds := v_duration;
        v_tournament.anchor_started_at := CASE WHEN v_was_running THEN v_now ELSE NULL END;
    ELSIF p_action = 'next' THEN
        IF v_tournament.current_level_index >= v_last_index THEN
            DELETE FROM mutation_receipts WHERE request_id = p_request_id;
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Đây đã là mức cuối cùng.');
        END IF;
        v_tournament.current_level_index := v_tournament.current_level_index + 1;
        SELECT duration_seconds INTO v_duration FROM tournament_levels
        WHERE tournament_id = p_tournament_id AND position = v_tournament.current_level_index;
        v_tournament.remaining_seconds := v_duration;
        v_tournament.anchor_started_at := CASE WHEN v_was_running THEN v_now ELSE NULL END;
    ELSE
        v_tournament.current_level_index := 0;
        SELECT duration_seconds INTO v_duration FROM tournament_levels
        WHERE tournament_id = p_tournament_id AND position = 0;
        v_tournament.remaining_seconds := v_duration;
        v_tournament.clock_status := 'ready';
        v_tournament.anchor_started_at := NULL;
    END IF;

    UPDATE tournaments SET
        clock_status = v_tournament.clock_status,
        current_level_index = v_tournament.current_level_index,
        remaining_seconds = v_tournament.remaining_seconds,
        anchor_started_at = v_tournament.anchor_started_at,
        version = version + 1
    WHERE id = p_tournament_id
    RETURNING * INTO v_tournament;

    v_payload := to_jsonb(v_tournament);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION complete_tournament(
    p_tournament_id UUID,
    p_expected_version BIGINT,
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tournament tournaments;
    v_payload JSONB;
    v_existing_operation TEXT;
BEGIN
    INSERT INTO mutation_receipts(request_id, operation)
    VALUES (p_request_id, 'complete_tournament')
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        SELECT operation, result_payload INTO v_existing_operation, v_payload
        FROM mutation_receipts WHERE request_id = p_request_id;
        IF v_existing_operation <> 'complete_tournament' THEN
            RETURN jsonb_build_object('status', 'conflict', 'message', 'Request ID đã được dùng cho thao tác khác.');
        END IF;
        RETURN jsonb_build_object('status', 'duplicate', 'data', v_payload);
    END IF;

    SELECT * INTO v_tournament FROM tournaments
    WHERE id = p_tournament_id
    FOR UPDATE;
    IF NOT FOUND OR v_tournament.clock_status = 'completed' THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Giải đấu đã kết thúc hoặc không tồn tại.');
    END IF;
    IF v_tournament.version <> p_expected_version THEN
        DELETE FROM mutation_receipts WHERE request_id = p_request_id;
        RETURN jsonb_build_object('status', 'conflict', 'message', 'Giải đấu đã thay đổi ở tab khác. Dữ liệu đã được tải lại.');
    END IF;

    UPDATE tournaments SET
        clock_status = 'completed',
        remaining_seconds = 0,
        anchor_started_at = NULL,
        completed_at = clock_timestamp(),
        version = version + 1
    WHERE id = p_tournament_id
    RETURNING * INTO v_tournament;

    UPDATE sessions SET status = 'completed'
    WHERE id = v_tournament.session_id AND status = 'active';

    v_payload := to_jsonb(v_tournament);
    UPDATE mutation_receipts SET result_payload = v_payload WHERE request_id = p_request_id;
    RETURN jsonb_build_object('status', 'applied', 'data', v_payload);
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON tournaments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON tournament_levels FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON tournament_players FROM anon, authenticated;
GRANT SELECT ON tournaments TO anon, authenticated;
GRANT SELECT ON tournament_levels TO anon, authenticated;
GRANT SELECT ON tournament_players TO anon, authenticated;
REVOKE ALL ON FUNCTION create_tournament(UUID, TEXT, UUID[], NUMERIC, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION control_tournament_clock(UUID, TEXT, BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_tournament(UUID, BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_tournament(UUID, TEXT, UUID[], NUMERIC, JSONB, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION control_tournament_clock(UUID, TEXT, BIGINT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_tournament(UUID, BIGINT, UUID) TO anon, authenticated;
