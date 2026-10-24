# Cineaura-Web
# CineAura-Mobile
# Cineaura-Officiel-V3
# Cineaura-LastV

## Security migration (not deployed)

The verified Supabase Auth / P0 authorization repair is a **staging candidate**,
not an automatic production upgrade. Read
[the Arabic rollout and rollback guide](docs/security-auth-rollout-ar.md) before
applying any Auth SQL file or deploying this frontend. `auth_prepare.sql` alone
is not a complete upgrade. The required order is containment, preparation, then
final cutover after independent account and staff-roster review. The cutover deliberately denies unreviewed features;
do not restore open policies or rerun legacy installers afterward.

Local isolated checks (Node.js 22+):

```bash
npm ci
npm test
```

These tests do not contact live Supabase and do not verify real email delivery,
provider payments, production publishing or production JWT integration.
