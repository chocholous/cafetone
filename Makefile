# Single-command dev + test orchestration.
#
#   make install   — npm install
#   make up        — start Postgres, copy .env.dev → .env, migrate, seed
#   make down      — stop Postgres (data persists in the pg volume)
#   make nuke      — down + delete the Postgres volume (fresh slate)
#   make dev       — run the server in the foreground (needs `make up` first)
#   make smoke     — run the end-to-end smoke test (server must be running)
#   make test      — up → start server in background → smoke → tear it down
#   make tunnel    — expose localhost:3000 via cloudflared (for phone testing)
#   make logs      — docker logs for Postgres

SHELL := /bin/bash
.PHONY: install up down nuke dev smoke test tunnel logs _wait_pg _start_bg _stop_bg

install:
	npm install --no-audit --no-fund

.env:
	@cp .env.dev .env
	@echo "copied .env.dev → .env"

up: .env
	docker compose up -d
	@$(MAKE) _wait_pg
	npx tsx scripts/migrate.ts
	npx tsx scripts/seed-dev.ts

down:
	docker compose down

nuke:
	docker compose down -v
	-rm -f .env

dev: up
	npx tsx watch src/index.ts

# Internal: block until Postgres is ready.
_wait_pg:
	@echo -n "waiting for postgres"
	@until docker compose exec -T pg pg_isready -U postgres >/dev/null 2>&1; do \
		echo -n "."; sleep 1; \
	done; echo " ok"

# Internal: start the server in the background, capture PID.
_start_bg:
	@mkdir -p .runtime
	@( npx tsx src/index.ts > .runtime/server.log 2>&1 & echo $$! > .runtime/server.pid )
	@echo "server started (pid $$(cat .runtime/server.pid)), logs → .runtime/server.log"

_stop_bg:
	@if [ -f .runtime/server.pid ]; then \
		kill $$(cat .runtime/server.pid) 2>/dev/null || true; \
		rm -f .runtime/server.pid; \
		echo "server stopped"; \
	fi

smoke:
	DEV_WIPE=true npx tsx scripts/seed-dev.ts
	npx tsx scripts/smoke.ts

test: up _start_bg
	@trap '$(MAKE) _stop_bg' EXIT; \
	DEV_WIPE=true npx tsx scripts/seed-dev.ts && \
	npx tsx scripts/smoke.ts

tunnel:
	@command -v cloudflared >/dev/null 2>&1 || { \
		echo "install cloudflared first (brew install cloudflared / apt install cloudflared)"; exit 1; \
	}
	cloudflared tunnel --url http://localhost:3000

logs:
	docker compose logs -f pg
