# Runbook — add a client site and who may edit it

Until there is an admin screen, sites and editors are added with SQL in the Cloudflare dashboard.
E-mail addresses are personal data: never put them in the repo, a migration or a commit.

## Steps (dev)
1. https://dash.cloudflare.com → *Storage & Databases* → *D1 SQL Database* → `inzenirji-editor-dev` → *Console*.
2. Add the site once (id = what the site's `/uredi` page has in `data-site`; origin = the site's address
   without a trailing slash):
   ```sql
   INSERT INTO sites (id, name, origin, created_at)
   VALUES ('hisa-denk', 'Hiša Denk', 'https://hisa-denk.si', unixepoch() * 1000);
   ```
3. Add the owner (lowercase e-mail):
   ```sql
   INSERT INTO site_users (site_id, email, role, created_at)
   VALUES ('hisa-denk', 'lastnik@example.com', 'owner', unixepoch() * 1000);
   ```
   Further people: same with `'editor'`.
4. Check: `SELECT * FROM site_users WHERE site_id = 'hisa-denk';`

## Remove access
```sql
DELETE FROM site_users WHERE site_id = 'hisa-denk' AND email = 'nekdo@example.com';
```
Takes effect immediately for open sessions too.

## Change the site's address
```sql
UPDATE sites SET origin = 'https://www.hisa-denk.si' WHERE id = 'hisa-denk';
```
Login links always point to `<origin>/uredi`.
