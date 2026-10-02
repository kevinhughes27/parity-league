# Moving from v2

Parity 3.0 (this repo) is already deployed in the dedicated Cloudflare account at `https://parity.kevinhughes27.workers.dev`, and the v2 database has been imported into its Durable Objects. Production is still v2 at `https://parity.ocua.ca` until the cutover below.

## Domain and hosting setup

Any time before cutover, v2 keeps running:

1. Use a domain in the Cloudflare account (the Cloudflare registrar is at cost) or an existing one.
2. Set the secrets that are still placeholders, if any:
   - `./dev wrangler secret put ZULURU_USER`
   - `./dev wrangler secret put ZULURU_PASSWORD`
   (`ADMIN_PASSWORD` is already set; `./dev seed` uses it.)
3. Set up hosting on the domain:
   - DNS: proxied `AAAA` records for `@` and `origin`, both pointing to `100::` (the Worker answers; the address is never used)
   - Uncomment `routes` in `wrangler.jsonc` with your domain and deploy again
   - SSL/TLS > Custom Hostnames: enable Cloudflare for SaaS, set the fallback origin to `origin.<domain>` and add the custom hostname `parity.ocua.ca`
4. Refresh the data right before cutover. Copy the latest v2 database (`scp parity-server:~/parity-server/server/db.sqlite v2.sqlite`), then:

   ```sh
   ADMIN_PASSWORD=... ./dev seed --all --from v2.sqlite --to https://<domain>
   ```

   Try the stat keeper on `https://<domain>` too.

## Cut over

Do this on a weekday, not game day, since no games can be recorded in between:

1. Copy the latest v2 database and seed again (step 4 above) so v3 has the latest games.
2. OCUA replaces the `parity.ocua.ca` A record (`3.98.197.218`) with `CNAME parity.ocua.ca -> origin.<domain>`.
3. Cloudflare validates the hostname and issues its certificate once the CNAME exists. OCUA's zone is on Cloudflare so this can't be done ahead of time and takes a few minutes. Watch the custom hostname status go to *Active*, then check `https://parity.ocua.ca/api/leagues`.

Stat keepers don't need to do anything. The site stays on the same address so games saved in their browsers stay put, and uploads from pages opened before the switch still work (`/submit_game` is kept for this).

## Rolling back

Put the A record back. v2 is untouched, but any games uploaded to v3 in between would need to be re-uploaded from the stat keepers' browsers.

## Afterwards

Once it has run for a few weeks: stop the EC2 instance, release its Elastic IP and archive parity-server. Then delete the v2 sqlite reader in `scripts/seed.ts`, the `/submit_game` route in `worker/index.ts`, and this file.

## Moving to OCUA's account

Workers can't be transferred between Cloudflare accounts but moving is just a redeploy: deploy this repo to OCUA's account, copy the data across with `./dev seed --all --from https://parity.ocua.ca --to https://parity.<ocua-subdomain>.workers.dev`, then serve `parity.ocua.ca` from the new Worker with a custom domain (`{ "pattern": "parity.ocua.ca", "custom_domain": true }` in `routes`) instead of the CNAME.