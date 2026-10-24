// Guard the scheduled publisher: it must remain private even though the edge
// gateway JWT check is disabled so pg_cron can call it.
const { read, make } = require("./lib/harness");
const { has, ok, done } = make();

const edge = read("supabase/functions/platform-publish/index.ts");
const sql = read("sql/platform_publish_schedule.sql");
const docs = read("supabase/README.md");

has("publisher accepts only POST", edge, 'if (req.method !== "POST")');
has("publisher requires bucket header", edge, 'req.headers.get("x-cineaura-publish-bucket")');
has("publisher requires signature header", edge, 'req.headers.get("x-cineaura-publish-signature")');
has("publisher checks signature via private RPC", edge, 'rpc/platform_publish_authorize');
has("scheduler secret generated inside Vault", sql, "vault.create_secret(");
has("authorization RPC is security definer", sql, "security definer");
has("authorization is restricted to service role", sql, "to service_role;");
has("cron job is scheduled", sql, "cron.schedule('platform-publish-daily', '0 9 * * *'");
ok("scheduler does not embed a service-role key", !sql.includes("SUPABASE_SERVICE_ROLE_KEY"));
ok("docs no longer ask to copy a service-role key", !docs.includes("SUPABASE_SERVICE_ROLE_KEY=<service role key>"));
done();
