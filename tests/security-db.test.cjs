"use strict";
// Real PostgreSQL 17, real repository schema/RPCs, synthetic members ONLY.
// This runner never accepts a production DB URL and never contacts Supabase.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const EmbeddedPostgres = require("embedded-postgres").default;
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cineaura-security-test-"));
  const database = new EmbeddedPostgres({
    databaseDir: path.join(temporary, "data"), port: await unusedPort(),
    user: "postgres", password: "isolated-fixture-only", persistent: false,
    initdbFlags: ["--locale=C", "--lc-messages=C", "--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1", "-k", temporary],
    onLog() {}, onError(message) { if (/fatal|error/i.test(String(message))) console.error(String(message)); },
  });
  let db;
  let passed = 0;
  async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  }
  async function as(role, id, sql, values = [], extraClaims = {}) {
    assert.ok(["anon", "authenticated", "service_role"].includes(role));
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role, ...(id ? { sub: uid(id) } : {}), ...extraClaims })]);
      const result = await db.query(sql, values);
      await db.query("commit");
      return result;
    } catch (error) { await db.query("rollback"); throw error; }
  }
  const denied = (operation) => assert.rejects(operation, (error) => error.code === "42501");
  const approveRoster = () => db.query("update cineaura_private.auth_rollout set staff_review_reference='isolated-test-independent-roster-review', staff_review_fingerprint=cineaura_private.staff_roster_fingerprint() where id");
  const bind = async (id) => (await as("authenticated", id, "select public.member_auth_bind() as data", [], {
    amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
  })).rows[0].data;
  try {
    await database.initialise();
    await database.start();
    db = database.getPgClient();
    await db.connect();
    await db.query(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on all functions in schema auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;
      create schema storage;
      grant usage on schema storage to anon, authenticated, service_role;
      create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'),1)-1] $$;
      create function storage.filename(text) returns text language sql immutable as $$ select (string_to_array($1, '/'))[array_length(string_to_array($1, '/'),1)] $$;
      create function storage.extension(text) returns text language sql immutable as $$ select reverse(split_part(reverse($1), '.', 1)) $$;
      grant all on all tables in schema storage to anon, authenticated, service_role;
      grant execute on all functions in schema storage to anon, authenticated, service_role;
      alter table storage.objects enable row level security;
      create policy fixture_open_storage on storage.objects for all to anon, authenticated using (true) with check (true);
    `);
    const sourceFiles = [
      "members", "codes", "dashboard", "profile", "links", "activation", "panel", "ban_system", "account_deadline", "country_lock",
      "comments", "post_reviews", "plain_posts", "post_analytics", "post_watch_points", "post_reports", "post_reach", "person_follows",
      "prize_center", "prize_modes", "prize_admin", "points", "prize_secure", "prize_claims", "point_levels", "code_devices",
      "iptv", "channels", "channel_views", "iptv_premium", "iptv_lists", "content", "content_portrait", "content_youtube_unique",
      "content_downloads_edit", "uploads", "apps", "reports", "staff_messages", "point_codes", "market",
      "market_review_votes", "plans", "plans_settings", "packages", "membership_points", "withdrawals", "panel_admin", "help",
      "help_upload", "customization", "themes", "community", "community_groups", "community_group_posts", "community_articles_editor",
      "community_documents", "community_documents_scan", "community_qa_attachments", "platforms", "patreon", "patreon_review", "search",
      "avatar_storage", "image_uploads",
    ];
    for (const name of sourceFiles) {
      try { await db.query(await read(`sql/${name}.sql`)); }
      catch (error) { throw new Error(`Fixture schema setup failed in sql/${name}.sql: ${error.message}`, { cause: error }); }
    }
    console.log(`# Installed ${sourceFiles.length} actual repository schema files in isolated PostgreSQL.`);
    // Also exercise guard generation for a set-returning function and a mutable
    // unknown RPC; no production function is invoked from this test fixture.
    await db.query(`
      alter table public.profiles add column fixture_private_note text default 'never public';
      create function public.fixture_unreviewed() returns void language plpgsql security definer as $$ begin update public.profiles set points_spent=0; end $$;
      create function public.fixture_unreviewed_member(p_member text) returns void language plpgsql security definer as $$ begin update public.profiles set points_spent=0 where member_id=p_member; end $$;
      create function public.fixture_unreviewed_staff(p_token text) returns void language plpgsql security definer as $$ begin update public.profiles set points_spent=0; end $$;
      create function public.member_auth_bind(p_member text) returns jsonb language sql security definer as $$ select jsonb_build_object('ok',true,'member_id',p_member) $$;
      create function public.withdraw_info(p_member text) returns jsonb language sql security definer as $$ select jsonb_build_object('unreviewed',true,'member_id',p_member) $$;
      grant execute on function public.fixture_unreviewed() to public, anon, authenticated;
      grant select(password, recovery_code), update(password, status) on public.members to anon, authenticated;
      create view public.fixture_unsafe_member_view as select * from public.members;
      grant select on public.fixture_unsafe_member_view to anon, authenticated;
    `);
    const names = ["alice", "bob", "eve", "owner", "moderator", "pending", "banned"];
    for (let i = 1; i <= names.length; i++) {
      await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)", [
        uid(i), `${names[i - 1]}@example.test`, i === 3 ? null : new Date(), { member_id: "ID102", role: "super", membership_type: "Diamond" },
      ]);
    }
    for (const [id, name, status] of [[101, "alice", "active"], [102, "bob", "active"], [100, "owner", "active"], [103, "moderator", "active"], [104, "pending", "active"], [105, "banned", "banned"]]) {
      await db.query(`insert into public.members(member_id,full_name,username,email,password,country,birth_date,status,membership_type,membership_expires_at)
        values($1,$2,$2,$3,$4,'Morocco','1990-01-01',$5,'Free',now()+interval '1 month')`, [
        `ID${id}`, name, `${name}@example.test`, "a".repeat(64), status,
      ]);
      await db.query("insert into public.profiles(member_id,username,country,watch_points,points_spent,bio,show_country,show_gender) values($1,$2,'Morocco',1000000,17,'fixture bio',false,false)", [`ID${id}`, name]);
    }
    await db.query("update public.staff set member_id='ID100', username='owner' where role='super'");
    await db.query("insert into public.staff(role,member_id,username,password,sections) values('moderator','ID103','moderator',extensions.crypt(repeat('b',64),extensions.gen_salt('bf')),'messages')");
    await db.query("insert into public.staff_sessions(token,staff_id,expires_at) select 'fixture-exposed-legacy-token',id,now()+interval '1 day' from public.staff where member_id='ID100'");
    await db.query("insert into public.posts(post_id,owner_id,owner_username,kind,title,visibility) values('FIXTUREPOST','ID102','bob','recommendation','Preserved content','private')");
    await db.query("insert into public.messages(sender_id,receiver_id,body) values('ID102','ID100','Private fixture conversation')");
    await db.query("insert into public.notifications(member_id,body) values('ID102','Private fixture notification')");
    await db.query("insert into storage.buckets(id,name,public) values('private-fixture','private-fixture',false) on conflict do nothing");
    await db.query("insert into storage.objects(bucket_id,name) values('private-fixture','secret-fixture.txt')");
    const before = (await db.query("select to_jsonb(m) as member, (select to_jsonb(p) from public.profiles p where p.member_id=m.member_id) as profile from public.members m where member_id='ID102'")).rows[0];
    await check("preparation refuses to capture trusted identities before containing legacy access", async () => {
      await assert.rejects(db.query(await read("sql/auth_prepare.sql")), /initial_containment_required_before_preparation/);
      await db.query("rollback");
    });
    await check("initial containment explicitly freezes legacy browser tables/RPCs and panel tokens", async () => {
      await assert.rejects(db.query(await read("sql/auth_contain.sql")), /containment_requires_explicit_maintenance_window/);
      await db.query("rollback");
      await db.query("set cineaura.allow_security_containment='on'");
      await db.query(await read("sql/auth_contain.sql"));
      for (const role of ["anon", "authenticated"]) {
        for (const sql of ["select * from public.members", "select password from public.members", "update public.staff set sections='all'", "select public.login_member('alice','anything')"])
          await denied(() => as(role, role === "authenticated" ? 1 : null, sql));
      }
      assert.equal((await db.query("select count(*) from public.staff_sessions")).rows[0].count, "0");
      assert.ok((await as("service_role", null, "select * from public.members")).rowCount > 0);
    });
    await db.query(await read("sql/auth_prepare.sql"));

    await check("unconfirmed users cannot claim an account, even with forged member/role metadata", async () => {
      assert.deepEqual(await bind(3), { ok: false, reason: "email_confirmation_required" });
    });
    await check("a verified email still needs an approved trusted legacy ledger", async () => {
      assert.deepEqual(await bind(6), { ok: false, reason: "legacy_claim_review_required" });
      assert.equal((await db.query("select count(*) from cineaura_private.member_identities")).rows[0].count, "0");
    });
    await check("legacy ledger approval requires an audit reference", async () => {
      await assert.rejects(db.query("update cineaura_private.legacy_member_claims set approved_at=now() where member_id='ID101'"), { code: "23514" });
    });
    await db.query("update cineaura_private.legacy_member_claims set approved_at=now(), approval_reference='isolated-test-trusted-backup' where member_id<>'ID104'");
    await check("password-only sessions cannot initially claim a legacy account verified before the migration", async () => {
      const result = (await as("authenticated", 1, "select public.member_auth_bind() as data", [], { amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] })).rows[0].data;
      assert.equal(result.reason, "email_ownership_refresh_required");
    });
    await check("a writable legacy email cannot redirect a captured identity claim", async () => {
      await db.query("update public.members set email='hijacker@example.test' where member_id='ID101'");
      await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'hijacker@example.test',now(),'{\"legacy_account\":true,\"member_id\":\"ID101\"}')", [uid(9)]);
      assert.deepEqual(await bind(9), { ok: false, reason: "legacy_claim_review_required" });
      const result = await bind(1);
      assert.equal(result.member.member_id, "ID101");
      assert.equal(result.member.email, "alice@example.test");
    });
    await check("legacy binding preserves member id, content, points and all other existing fields", async () => {
      assert.equal((await bind(2)).member.member_id, "ID102");
      const after = (await db.query("select to_jsonb(m) as member, (select to_jsonb(p) from public.profiles p where p.member_id=m.member_id) as profile from public.members m where member_id='ID102'")).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await db.query("select count(*) from public.posts where post_id='FIXTUREPOST' and owner_id='ID102'")).rows[0].count, "1");
      const again = await bind(2);
      assert.equal(again.member.member_id, "ID102");
      assert.ok(!Object.hasOwn(again.member, "password"));
      assert.ok(!Object.hasOwn(again.member, "recovery_code"));
    });
    await bind(4);
    await bind(5);
    await check("banned accounts cannot be revived by email verification", async () => {
      assert.deepEqual(await bind(7), { ok: false, reason: "banned" });
    });
    await check("preparation is repeatable and does not overwrite the private claim ledger", async () => {
      await db.query("update public.members set email='changed-after-capture@example.test' where member_id='ID104'");
      await db.query(await read("sql/auth_prepare.sql"));
      assert.equal((await db.query("select email from cineaura_private.legacy_member_claims where member_id='ID104'")).rows[0].email, "pending@example.test");
    });
    await check("cutover refuses execution without an explicit maintenance-window acknowledgement", async () => {
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /cutover_requires_explicit_maintenance_window/);
      await db.query("rollback");
    });
    await db.query("set cineaura.allow_security_cutover='on'");
    await check("cutover requires an independently reviewed unchanged legacy staff roster", async () => {
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /independent_staff_roster_review_required/);
      await db.query("rollback");
      await approveRoster();
      await db.query("update public.staff set sections='accounts,withdrawals' where member_id='ID103'");
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /independent_staff_roster_review_required/);
      await db.query("rollback");
      await db.query("update public.staff set sections='messages' where member_id='ID103'");
    });
    await check("cutover refuses a missing or banned Super Admin binding", async () => {
      await db.query("delete from cineaura_private.member_identities where auth_user_id=$1", [uid(4)]);
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /verified_super_admin_binding_required/);
      await db.query("rollback");
      assert.equal((await bind(4)).ok, true);
      await db.query("update public.members set status='banned' where member_id='ID100'");
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /verified_super_admin_binding_required/);
      await db.query("rollback");
      await db.query("update public.members set status='active' where member_id='ID100'");
    });
    await db.query(await read("sql/auth_cutover.sql"));
    assert.equal((await db.query("select count(*) from public.staff_sessions where token='fixture-exposed-legacy-token'")).rows[0].count, "0", "first cutover revokes old panel sessions");
    console.log(`# Cutover wrapped ${(await db.query("select count(*) from cineaura_private.rpc_manifest")).rows[0].count} existing RPC overloads.`);

    await check("anon cannot read members, credential columns, unsafe old views or private messages", async () => {
      for (const sql of ["select * from public.members", "select password,recovery_code from public.members", "select * from public.fixture_unsafe_member_view", "select * from public.messages", "select * from public.notifications", "select * from public.staff_sessions"]) {
        await denied(() => as("anon", null, sql));
      }
    });
    await check("authenticated users cannot read password/recovery columns or modify raw account privileges", async () => {
      for (const sql of ["select password,recovery_code from public.members", "update public.members set status='active' where member_id='ID102'", "update public.members set password='attacker' where member_id='ID102'", "update public.members set email='attacker@example.test' where member_id='ID102'"]) {
        await denied(() => as("authenticated", 1, sql));
      }
    });
    await check("directory views redact other members' email, birth date and hidden demographics", async () => {
      const other = (await as("authenticated", 1, "select * from public.member_directory where member_id='ID102'")).rows[0];
      for (const field of ["email", "birth_date", "country", "gender", "ban_reason"]) assert.equal(other[field], null);
      assert.ok(!Object.hasOwn(other, "password"));
      assert.ok(!Object.hasOwn(other, "recovery_code"));
      const own = (await as("authenticated", 1, "select * from public.member_directory where member_id='ID101'")).rows[0];
      assert.equal(own.email, "alice@example.test");
      assert.ok(own.birth_date);
      assert.equal((await as("anon", null, "select email from public.member_directory where member_id='ID102'")).rows[0].email, null);
    });
    await check("future unknown profile columns are excluded, even after preparing twice", async () => {
      const visible = (await as("anon", null, "select * from public.profile_directory where member_id='ID102'")).rows[0];
      assert.equal(Object.hasOwn(visible, "fixture_private_note"), false);
      assert.equal((await as("authenticated", 2, "select fixture_private_note from public.profiles where member_id='ID102'")).rows[0].fixture_private_note, "never public");
    });
    await check("members cannot read/insert/update the private UUID-to-member identity map", async () => {
      for (const sql of ["select * from cineaura_private.member_identities", `insert into cineaura_private.member_identities values('${uid(1)}','ID102',now())`, "update cineaura_private.legacy_member_claims set approved_at=now()"])
        await denied(() => as("authenticated", 1, sql));
    });
    await check("own profile text is writable; another profile and all balances/counters/roles are protected", async () => {
      assert.equal((await as("authenticated", 1, "update public.profiles set bio='changed safely' where member_id='ID101'")).rowCount, 1);
      assert.equal((await as("authenticated", 1, "update public.profiles set bio='not allowed' where member_id='ID102'")).rowCount, 0);
      for (const field of ["points_spent", "watch_points", "private_minutes", "public_minutes", "followers"]) await denied(() => as("authenticated", 1, `update public.profiles set ${field}=999999 where member_id='ID101'`));
      await denied(() => as("authenticated", 1, "insert into public.profiles(member_id,username,watch_points) values('ID9999','attacker',999999)"));
    });
    await check("private messages and notifications are isolated by actual participants/recipient", async () => {
      assert.equal((await as("authenticated", 1, "select * from public.messages")).rowCount, 0);
      assert.equal((await as("authenticated", 2, "select * from public.messages")).rowCount, 1);
      assert.equal((await as("authenticated", 1, "select * from public.notifications")).rowCount, 0);
      assert.equal((await as("authenticated", 2, "update public.notifications set read=true where member_id='ID102'")).rowCount, 1);
      assert.equal((await as("authenticated", 1, "update public.notifications set read=true where member_id='ID102'")).rowCount, 0);
      await denied(() => as("authenticated", 1, "insert into public.messages(sender_id,receiver_id,body) values('ID102','ID100','spoof')"));
      await denied(() => as("authenticated", 2, "update public.messages set body='altered'"));
      await denied(() => as("authenticated", 1, "insert into public.notifications(member_id,kind,body) values('ID102','announce','spoof')"));
      const sent = (await as("authenticated", 1, "insert into public.messages(sender_id,receiver_id,sender_username,receiver_username,body) values('ID101','ID102','Super Admin','somebody else','real sender') returning sender_username,receiver_username")).rows[0];
      assert.deepEqual(sent, { sender_username: "alice", receiver_username: "bob" });
    });
    await check("forged member ids cannot invoke another account's financial or private RPCs", async () => {
      for (const [sql, params] of [
        ["select public.membership_buy_with_points($1,'Silver')", ["ID102"]],
        ["select public.withdraw_cancel($1,'fake-withdrawal')", ["ID102"]],
        ["select public.withdraw_forget($1,'bank')", ["ID102"]],
        ["select public.withdraw_me($1)", ["ID102"]],
        ["select public.code_create($1,'123456')", ["ID102"]],
      ]) await denied(() => as("authenticated", 1, sql, params));
      await denied(() => as("anon", null, "select public.membership_buy_with_points('ID102','Silver')"));
    });
    await check("own membership purchase still uses the real atomic business rules and spend ledger", async () => {
      const result = (await as("authenticated", 1, "select public.membership_buy_with_points('ID101','Silver') as data")).rows[0].data;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.plan, "Silver");
      const ledger = await db.query("select * from public.membership_purchases where member_id='ID101'");
      assert.equal(ledger.rowCount, 1);
      assert.equal((await db.query("select points_spent from public.profiles where member_id='ID102'")).rows[0].points_spent, before.profile.points_spent);
    });
    await check("a recent native password session is required for withdrawals, not a leaked legacy hash", async () => {
      await denied(() => as("authenticated", 1, "select public.withdraw_request('ID101',$1,5000,'bank')", ["a".repeat(64)]));
      const old = Math.floor(Date.now() / 1000) - 600;
      await denied(() => as("authenticated", 1, "select public.withdraw_request('ID101','anything',5000,'bank')", [], { amr: [{ method: "password", timestamp: old }] }));
      const fresh = Math.floor(Date.now() / 1000);
      const result = (await as("authenticated", 1, "select public.withdraw_request('ID101','',5000,'bank') as data", [], { amr: [{ method: "password", timestamp: fresh }] })).rows[0].data;
      assert.notEqual(result.reason, "password", "legacy password has no authorization role anymore");
    });
    await check("RPC read defaults cannot be abused as another viewer; legitimate guest reads still work", async () => {
      await denied(() => as("authenticated", 1, "select public.content_get('not-a-real-post','ID102')"));
      const result = await as("anon", null, "select public.content_get('not-a-real-post') as data");
      assert.equal(result.rowCount, 1);
      const set = await as("authenticated", 1, "select * from public.posts_gate('ID101',array['FIXTUREPOST'])");
      assert.equal(set.rowCount, 1, "set-returning wrappers preserve output signatures");
      await denied(() => as("authenticated", 1, "select * from public.posts_gate('ID102',array['FIXTUREPOST'])"));
    });
    await check("old login/reset/bootstrap, internal helpers and unknown RPCs fail closed", async () => {
      for (const sql of ["select public.login_member('alice','anything')", "select public.reset_password_with_recovery('1234567890123456','x')", "select public._points('ID102')", "select public.fixture_unreviewed()", "select public.fixture_unreviewed_member('ID101')", "select public.fixture_unreviewed_staff('fixture-super-token')", "select public.member_auth_bind('ID101')", "select public.withdraw_info('ID101')", "select public.staff_setup_super('ID101','alice',repeat('a',64),'all')"])
        await denied(() => as("authenticated", 1, sql));
      await denied(() => as("authenticated", 1, "select cineaura_private.membership_buy_with_points('ID102','Silver')"));
    });
    await check("staff tokens cannot be reused under another member's Auth UUID", async () => {
      await db.query("insert into public.staff_sessions(token,staff_id,expires_at) select 'fixture-super-token',id,now()+interval '1 day' from public.staff where role='super'");
      await denied(() => as("authenticated", 1, "select public.panel_member_summary('fixture-super-token','ID102')"));
      const own = await as("authenticated", 4, "select public.panel_member_summary('fixture-super-token','ID102') as data");
      assert.equal(own.rows[0].data.ok, true);
      const logout = await as("authenticated", 4, "select public.staff_logout('fixture-super-token')");
      assert.equal(logout.rowCount, 1, "void-returning wrappers still work");
    });
    await check("moderator sections are not replaced by a blanket admin privilege", async () => {
      assert.equal((await as("authenticated", 5, "select cineaura_private.can_section('accounts') as allowed")).rows[0].allowed, false);
      assert.equal((await as("authenticated", 5, "select cineaura_private.can_section('messages') as allowed")).rows[0].allowed, true);
    });
    await check("account moderation requires owned staff credentials, Accounts permission and hierarchy", async () => {
      await db.query("insert into public.staff_sessions(token,staff_id,expires_at) select 'fixture-accounts-super',id,now()+interval '1 day' from public.staff where member_id='ID100'");
      await db.query("insert into public.staff_sessions(token,staff_id,expires_at) select 'fixture-accounts-mod',id,now()+interval '1 day' from public.staff where member_id='ID103'");
      const change = (id, token, target, status) => as("authenticated", id, "select public.member_admin_set_status($1,$2,$3) as data", [token, target, status]);
      await denied(() => change(1, "fixture-accounts-super", "ID102", "banned"));
      await denied(() => change(5, "fixture-accounts-mod", "ID102", "banned"));
      for (const invalid of [null, "super", "enabled"]) await denied(() => change(4, "fixture-accounts-super", "ID102", invalid));
      await denied(() => change(4, "fixture-accounts-super", "ID100", "disabled"));
      await db.query("update public.staff set sections='messages,accounts' where member_id='ID103'");
      await denied(() => change(5, "fixture-accounts-mod", "ID100", "banned"));
      await denied(() => change(5, "fixture-accounts-mod", "ID103", "banned"));
      await db.query("insert into public.staff(role,member_id,username,password,sections) values('admin','ID102','bob',extensions.crypt(repeat('c',64),extensions.gen_salt('bf')),'accounts')");
      await denied(() => change(5, "fixture-accounts-mod", "ID102", "banned"));
      await db.query("delete from public.staff where member_id='ID102'");
      assert.equal((await change(5, "fixture-accounts-mod", "ID102", "banned")).rows[0].data.ok, true);
      await denied(() => as("authenticated", 2, "select public.member_account_update('cannot change while banned')"));
      assert.ok((await db.query("select banned_at from public.members where member_id='ID102'")).rows[0].banned_at);
      assert.equal((await change(4, "fixture-accounts-super", "ID102", "active")).rows[0].data.ok, true);
      assert.equal((await db.query("select banned_at from public.members where member_id='ID102'")).rows[0].banned_at, null);
      assert.equal((await change(5, "fixture-accounts-mod", "ID102", "disabled")).rows[0].data.ok, true);
      assert.equal((await change(4, "fixture-accounts-super", "ID102", "active")).rows[0].data.ok, true);
    });
    await check("new verified registrations cannot choose an id, paid plan, status or initial balance", async () => {
      await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'new@example.test',now(),$2)", [uid(8), { full_name: "New Member", username: "new_member", birth_date: "1990-01-01", country: "Morocco", gender: "male", member_id: "ID102", membership_type: "Diamond", status: "active", points_spent: -999999, role: "super" }]);
      const result = await bind(8);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.notEqual(result.member.member_id, "ID102");
      assert.equal(result.member.membership_type, "Free");
      assert.equal(result.member.status, "disabled");
      const profile = (await db.query("select * from public.profiles where member_id=$1", [result.member.member_id])).rows[0];
      assert.equal(Number(profile.points_spent), 0);
      assert.equal(Number(profile.watch_points), 0);
      assert.equal((await db.query("select count(*) from public.staff where member_id=$1", [result.member.member_id])).rows[0].count, "0");
      const activation = (await as("authenticated", 8, "select public.member_activate_free() as data")).rows[0].data;
      assert.equal(activation.ok, true);
      const repeated = (await as("authenticated", 8, "select public.member_activate_free() as data")).rows[0].data;
      assert.equal(repeated.ok, false);
    });
    await check("verified email changes retain the UUID/member binding, never merge accounts", async () => {
      await db.query("update auth.users set email='new-alice@example.test' where id=$1", [uid(1)]);
      assert.equal((await bind(1)).member.member_id, "ID101");
      assert.equal((await bind(1)).member.email, "new-alice@example.test");
      await db.query("update auth.users set email='bob@example.test' where id=$1", [uid(1)]);
      assert.deepEqual(await bind(1), { ok: false, reason: "email_conflict" });
      await db.query("update auth.users set email='new-alice@example.test' where id=$1", [uid(1)]);
    });
    await check("storage legacy bucket policies cannot leave anonymous/private writes or reads open", async () => {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await as(role, role === "authenticated" ? 1 : null, "select * from storage.objects where bucket_id='private-fixture'")).rowCount, 0);
        await denied(() => as(role, role === "authenticated" ? 1 : null, "insert into storage.objects(bucket_id,name) values('private-fixture','attacker.txt')"));
        assert.equal((await as(role, role === "authenticated" ? 1 : null, "delete from storage.objects where bucket_id='private-fixture'")).rowCount, 0);
      }
    });
    await check("service_role/background maintenance retains access without trusting browser identities", async () => {
      assert.ok((await as("service_role", null, "select * from public.members")).rowCount > 0);
      assert.equal((await as("service_role", null, "select public.account_ban_overdue() as data")).rowCount, 1);
      assert.equal((await db.query("select public.account_ban_overdue() as data")).rowCount, 1);
      assert.equal((await as("anon", null, "select cineaura_private.is_service_request() as trusted")).rows[0].trusted, false);
    });
    await check("cutover is repeatable without duplicate wrappers or schema/data loss", async () => {
      const count = (await db.query("select count(*) from cineaura_private.rpc_manifest")).rows[0].count;
      // Moderation fixtures deliberately changed sections. The new roster needs
      // an explicit operator review, even on a repeated sealed cutover.
      await assert.rejects(db.query(await read("sql/auth_cutover.sql")), /independent_staff_roster_review_required/);
      await db.query("rollback");
      await approveRoster();
      await db.query(await read("sql/auth_cutover.sql"));
      await assert.rejects(db.query(await read("sql/auth_prepare.sql")), /preparation_after_seal_requires_reviewed_upgrade/);
      await db.query("rollback");
      await assert.rejects(db.query(await read("sql/auth_contain.sql")), /initial_containment_after_seal_requires_separate_incident_plan/);
      await db.query("rollback");
      assert.equal((await db.query("select count(*) from public.staff_sessions where token='fixture-accounts-super'")).rows[0].count, "1", "repeated sealed cutover preserves new staff sessions");
      assert.equal((await db.query("select count(*) from cineaura_private.rpc_manifest")).rows[0].count, count);
      await denied(() => as("authenticated", 1, "select public.membership_buy_with_points('ID102','Silver')"));
      assert.equal((await db.query("select count(*) from public.posts where post_id='FIXTUREPOST'")).rows[0].count, "1");
    });
    console.log(`\n${passed} PostgreSQL security groups passed (isolated fixtures; no live Supabase writes).`);
  } finally {
    if (db) await db.end();
    await database.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
