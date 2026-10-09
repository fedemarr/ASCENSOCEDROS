export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','security'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inviters (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, token TEXT UNIQUE NOT NULL,
    capacity INTEGER NOT NULL CHECK(capacity BETWEEN 0 AND 10000),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL REFERENCES inviters(id), first_name TEXT NOT NULL,
    last_name TEXT NOT NULL, dni TEXT UNIQUE NOT NULL, search_name TEXT NOT NULL, photo_path TEXT NOT NULL,
    created_at TEXT NOT NULL, entered_at TEXT, entered_by TEXT REFERENCES users(id),
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
  )`,
  `CREATE INDEX IF NOT EXISTS guests_inviter ON guests(inviter_id)`,
  `CREATE INDEX IF NOT EXISTS guests_search ON guests(search_name)`,
  `CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
    target_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `INSERT INTO settings(key,value) VALUES('_registration_capacity','10000'),('_registration_active','1') ON CONFLICT DO NOTHING`,
  `CREATE OR REPLACE FUNCTION update_shared_registration(p_capacity INTEGER,p_active BOOLEAN,p_user TEXT,p_time TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM value FROM settings WHERE key='_registration_capacity' FOR UPDATE;
      IF p_capacity<(SELECT COUNT(*) FROM guests) THEN RAISE EXCEPTION 'CAPACITY_TOO_SMALL'; END IF;
      UPDATE settings SET value=p_capacity::text WHERE key='_registration_capacity';
      UPDATE settings SET value=CASE WHEN p_active THEN '1' ELSE '0' END WHERE key='_registration_active';
      INSERT INTO audit(user_id,action,target_id,created_at) VALUES(p_user,'registration_updated','event',p_time);
      UPDATE changes SET version=version+1 WHERE id=1;
    END
  $$`,
  `CREATE OR REPLACE FUNCTION register_shared_guest(
    p_id TEXT,p_inviter TEXT,p_inviter_key TEXT,p_first TEXT,p_last TEXT,p_dni TEXT,p_search TEXT,p_created TEXT
  ) RETURNS TEXT LANGUAGE plpgsql AS $$
    DECLARE inv inviters%ROWTYPE; capacity INTEGER;
    BEGIN
      SELECT value::int INTO capacity FROM settings WHERE key='_registration_capacity' FOR UPDATE;
      IF (SELECT value FROM settings WHERE key='_registration_active')<>'1' THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
      IF EXISTS(SELECT 1 FROM guests WHERE dni=p_dni) THEN RAISE EXCEPTION 'DUPLICATE_DNI'; END IF;
      IF (SELECT COUNT(*) FROM guests)>=capacity THEN RAISE EXCEPTION 'FULL'; END IF;
      SELECT * INTO inv FROM inviters WHERE lower(trim(translate(name,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))=p_inviter_key ORDER BY created_at,id LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF inv.active=0 THEN RAISE EXCEPTION 'REVOKED'; END IF;
      ELSE
        INSERT INTO inviters(id,name,slug,token,capacity,active,created_at)
          VALUES(p_id,p_inviter,'shared-'||p_id,p_id,10000,1,p_created) RETURNING * INTO inv;
      END IF;
      INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo_path,created_at)
        VALUES(p_id,inv.id,p_first,p_last,p_dni,p_search,'',p_created);
      INSERT INTO audit(action,target_id,created_at) VALUES('registered',p_id,p_created);
      UPDATE changes SET version=version+1 WHERE id=1;
      RETURN inv.name;
    END
  $$`,
  `CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY CHECK(id=1), version BIGINT NOT NULL DEFAULT 0)`,
  `INSERT INTO changes(id,version) VALUES (1,0) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until BIGINT NOT NULL)`,
  `CREATE OR REPLACE FUNCTION register_guest(
    p_id TEXT, p_slug TEXT, p_token TEXT, p_first TEXT, p_last TEXT,
    p_dni TEXT, p_search TEXT, p_photo TEXT, p_created TEXT
  ) RETURNS TEXT LANGUAGE plpgsql AS $$
    DECLARE inv inviters%ROWTYPE;
    BEGIN
      SELECT * INTO inv FROM inviters WHERE slug=p_slug AND token=p_token FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_LINK'; END IF;
      IF inv.active=0 THEN RAISE EXCEPTION 'REVOKED'; END IF;
      IF EXISTS(SELECT 1 FROM guests WHERE dni=p_dni) THEN RAISE EXCEPTION 'DUPLICATE_DNI'; END IF;
      IF (SELECT COUNT(*) FROM guests WHERE inviter_id=inv.id)>=inv.capacity THEN RAISE EXCEPTION 'FULL'; END IF;
      INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo_path,created_at)
        VALUES(p_id,inv.id,p_first,p_last,p_dni,p_search,p_photo,p_created);
      INSERT INTO audit(action,target_id,created_at) VALUES('registered',p_id,p_created);
      UPDATE changes SET version=version+1 WHERE id=1;
      RETURN inv.name;
    END
  $$`,
  `CREATE OR REPLACE FUNCTION enter_guest(p_id TEXT,p_user TEXT,p_time TEXT)
    RETURNS TABLE(already_entered BOOLEAN,entered_at TEXT) LANGUAGE plpgsql AS $$
    DECLARE inv inviters%ROWTYPE; guest guests%ROWTYPE; inv_id TEXT;
    BEGIN
      SELECT inviter_id INTO inv_id FROM guests WHERE id=p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT * INTO inv FROM inviters WHERE id=inv_id FOR UPDATE;
      SELECT * INTO guest FROM guests WHERE id=p_id FOR UPDATE;
      IF guest.revoked=1 OR inv.active=0 THEN RAISE EXCEPTION 'REVOKED'; END IF;
      IF guest.entered_at IS NOT NULL THEN RETURN QUERY SELECT TRUE,guest.entered_at; RETURN; END IF;
      UPDATE guests SET entered_at=p_time,entered_by=p_user WHERE id=p_id;
      INSERT INTO audit(user_id,action,target_id,created_at) VALUES(p_user,'entered',p_id,p_time);
      UPDATE changes SET version=version+1 WHERE id=1;
      RETURN QUERY SELECT FALSE,p_time;
    END
  $$`,
  `CREATE OR REPLACE FUNCTION update_inviter(p_id TEXT,p_capacity INTEGER,p_active INTEGER,p_rotate BOOLEAN,p_user TEXT,p_token TEXT,p_time TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $$
    DECLARE inv inviters%ROWTYPE; new_capacity INTEGER;
    BEGIN
      SELECT * INTO inv FROM inviters WHERE id=p_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      new_capacity=COALESCE(p_capacity,inv.capacity);
      IF p_capacity IS NOT NULL AND new_capacity<(SELECT COUNT(*) FROM guests WHERE inviter_id=p_id) THEN RAISE EXCEPTION 'CAPACITY_TOO_SMALL'; END IF;
      UPDATE inviters SET capacity=new_capacity,active=COALESCE(p_active,inv.active),
        token=CASE WHEN p_rotate THEN p_token ELSE inv.token END WHERE id=p_id;
      INSERT INTO audit(user_id,action,target_id,created_at) VALUES(p_user,
        CASE WHEN p_rotate THEN 'link_rotated' WHEN p_active=0 THEN 'inviter_revoked' ELSE 'inviter_updated' END,p_id,p_time);
      UPDATE changes SET version=version+1 WHERE id=1;
    END
  $$`
];
