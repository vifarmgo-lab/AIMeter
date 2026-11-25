# AIMeter → Lark Base Usage

Compose starts the dashboard on the VPS loopback interface, port 3186. The optional worker reads AIMeter's subscription export every 60 seconds. Each provider controls its own upstream refresh interval. Configure accounts through AIMeter's private admin interface. Gemini web subscription limits require a separate verified data source. The Antigravity adapter reports a different quota.

## Server configuration

Keep credentials outside the repository. Create a private environment file for Compose with a random 32-character `AIMETER_ENDPOINT_SECRET` before the first start. From this directory run:

```sh
docker compose --env-file /etc/aiking-aimeter/service.env up -d --build aimeter
```

Complete the one-time dashboard setup over an SSH tunnel to port 3186. An existing instance must use the endpoint secret that AIMeter shows in Settings.

For the worker, store the following in `/etc/aiking-aimeter/wallet.env` with owner-only access. The Lark custom app needs read access to linked account records and write access to the Usage table.

| Setting | Value |
| --- | --- |
| LARK_APP_ID / LARK_APP_SECRET | Credentials for the authorized Lark custom app |
| LARK_BASE_TOKEN | Source Base token from the Base owner |
| LARK_USAGE_TABLE_ID | Source table ID for the Usage grid |
| WALLET_SYNC_SECONDS | Optional. Defaults to 60 |
| WALLET_BINDINGS_JSON | Optional per-provider account and window overrides |

Give each AIMeter provider the exact name of its linked Lark account's primary field. When the name is missing or shared, configure an explicit binding. A window override can update an existing Usage row with a localized title.

```json
{"provider-id":{"accountRecordId":"recExample","windows":{"Weekly":"Quota tuần"}}}
```

Run a comparison first, then enable syncing:

```sh
docker compose --env-file /etc/aiking-aimeter/service.env --profile sync run --rm wallet-sync --once --dry-run
docker compose --env-file /etc/aiking-aimeter/service.env --profile sync up -d wallet-sync
```

The worker normalizes usage to a limit of 100 and the unit %. The timestamp comes from the source sample. It matches on the linked account and window title, preserves formulas and notes, skips older samples, and fails closed on duplicate matches. It retries failed calls and reconciles unchanged data every 30 minutes. Logs show counts for matched windows, unmapped accounts, and unavailable providers.
