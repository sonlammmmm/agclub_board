BEGIN;

INSERT INTO seasons(id, name, is_active)
VALUES ('10000000-0000-0000-0000-000000000001', 'Tournament integration', true);

INSERT INTO players(id, name, status)
VALUES
    ('20000000-0000-0000-0000-000000000001', 'Player One', 'active'),
    ('20000000-0000-0000-0000-000000000002', 'Player Two', 'active');

DO $$
DECLARE
    v_result JSONB;
    v_tournament_id UUID;
    v_session_id UUID;
    v_version BIGINT;
    v_levels JSONB := '[
      {"kind":"level","small_blind":25,"big_blind":50,"ante":0,"duration_seconds":60},
      {"kind":"break","duration_seconds":30},
      {"kind":"level","small_blind":50,"big_blind":100,"ante":10,"duration_seconds":60}
    ]'::jsonb;
    v_players UUID[] := ARRAY[
      '20000000-0000-0000-0000-000000000001'::uuid,
      '20000000-0000-0000-0000-000000000002'::uuid
    ];
BEGIN
    v_result := create_tournament(
        '10000000-0000-0000-0000-000000000001',
        'Integration Cup',
        v_players,
        10000,
        v_levels,
        '30000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'applied' THEN
        RAISE EXCEPTION 'create_tournament should apply: %', v_result;
    END IF;

    SELECT id, session_id, version INTO v_tournament_id, v_session_id, v_version
    FROM tournaments WHERE name = 'Integration Cup';
    IF v_version <> 0 OR (SELECT COUNT(*) FROM tournament_levels WHERE tournament_id = v_tournament_id) <> 3
       OR (SELECT COUNT(*) FROM tournament_players WHERE tournament_id = v_tournament_id) <> 2 THEN
        RAISE EXCEPTION 'Tournament graph was not created atomically.';
    END IF;

    v_result := create_tournament(
        '10000000-0000-0000-0000-000000000001',
        'Integration Cup',
        v_players,
        10000,
        v_levels,
        '30000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'duplicate' OR (SELECT COUNT(*) FROM tournaments) <> 1 THEN
        RAISE EXCEPTION 'create_tournament retry was not idempotent: %', v_result;
    END IF;

    v_result := create_tournament(
        '10000000-0000-0000-0000-000000000001',
        'Conflicting Cup',
        v_players,
        10000,
        v_levels,
        '30000000-0000-0000-0000-000000000002'
    );
    IF v_result->>'status' <> 'conflict' OR (SELECT COUNT(*) FROM tournaments) <> 1 THEN
        RAISE EXCEPTION 'A second active Tournament was not rejected: %', v_result;
    END IF;

    v_result := control_tournament_clock(
        v_tournament_id, 'start', 0,
        '40000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'applied' OR (v_result->'data'->>'version')::bigint <> 1 THEN
        RAISE EXCEPTION 'Clock start failed: %', v_result;
    END IF;

    v_result := control_tournament_clock(
        v_tournament_id, 'start', 0,
        '40000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'duplicate' OR (SELECT version FROM tournaments WHERE id = v_tournament_id) <> 1 THEN
        RAISE EXCEPTION 'Clock retry applied twice: %', v_result;
    END IF;

    v_result := control_tournament_clock(
        v_tournament_id, 'pause', 0,
        '40000000-0000-0000-0000-000000000002'
    );
    IF v_result->>'status' <> 'conflict' THEN
        RAISE EXCEPTION 'Stale expected_version was accepted: %', v_result;
    END IF;

    v_result := control_tournament_clock(
        v_tournament_id, 'pause', 1,
        '40000000-0000-0000-0000-000000000003'
    );
    IF v_result->>'status' <> 'applied' OR (v_result->'data'->>'version')::bigint <> 2 THEN
        RAISE EXCEPTION 'Clock pause failed: %', v_result;
    END IF;

    v_result := complete_tournament(
        v_tournament_id, 2,
        '50000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'applied'
       OR (SELECT clock_status FROM tournaments WHERE id = v_tournament_id) <> 'completed'
       OR (SELECT status FROM sessions WHERE id = v_session_id) <> 'completed' THEN
        RAISE EXCEPTION 'Tournament completion was not atomic: %', v_result;
    END IF;

    v_result := complete_tournament(
        v_tournament_id, 2,
        '50000000-0000-0000-0000-000000000001'
    );
    IF v_result->>'status' <> 'duplicate' THEN
        RAISE EXCEPTION 'Tournament completion retry was not idempotent: %', v_result;
    END IF;
END $$;

ROLLBACK;
