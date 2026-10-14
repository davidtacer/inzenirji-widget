# Cheat sheet (owner)

Never values here — only names and where they live.

## Repo
- GitHub: https://github.com/davidtacer/inzenirji-widget (public)
- Branches: `dev` (work), `main` (production releases, owner promotes)

## Local commands
| What | Command |
|---|---|
| Install | `pnpm install` |
| Run everything locally | `pnpm dev` |
| All checks | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` |

## URLs
| Env | URL | Status |
|---|---|---|
| dev | https://uredi-dev.inzenirji.si (health: `/api/health`) | Live (2026-10-13) |
| prod | `uredi.inzenirji.si` | Planned |

## GitHub Actions secrets
| Name | Used by | Status |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy-dev workflow | Set by owner 2026-10-13 |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-dev workflow | Set by owner 2026-10-13 |

## Worker secrets (Cloudflare dashboard → Workers & Pages → `inzenirji-editor-dev` → Settings → Variables and Secrets)
| Name | Used by | Status |
|---|---|---|
| `SMTP_PASSWORD` | login e-mails (`hello@inzenirji.si`) | Set by owner 2026-10-13 |
| `GITHUB_TOKEN` | fallback for repos without the GitHub App (fine-grained, this repo, Contents RW) | set 2026-10-14; delete after the app works |
| `GITHUB_APP_ID` | GitHub App ID (TASK-014, `docs/runbooks/github-app.md`) | **to set** |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (.pem contents) | **to set** |
| `ANTHROPIC_API_KEY` | editing agent | **to set** (morning) |

## D1
| Env | Database | Console |
|---|---|---|
| dev | `inzenirji-editor-dev` | Cloudflare → Storage & Databases → D1 → Console. Add sites/users: `docs/runbooks/add-site-user.md` |

## Secrets (names only, where they will live)
| Name | Used by | Lives in | Status |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | apps/api | hosting secret store | Planned |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | apps/api | hosting secret store | Planned |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | apps/api | hosting secret store | Planned |
