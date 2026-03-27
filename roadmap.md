# Rate Limiter — Roadmap

## Legend
- ✅ Done
- 🔲 Not started

---

## Phase 1 — Project Setup ✅
- ✅ Scaffold NestJS project
- ✅ Docker Compose for local Redis
- ✅ `ioredis` + `@nestjs/config` installed
- ✅ `.env` with static rule config

**Key files:** `docker-compose.yml`, `.env`

---

## Phase 2 — Core Rate Limiter (Token Bucket) ✅
Implements the token bucket algorithm atomically using a Lua script on Redis.

- ✅ Token bucket data model in Redis (`tokens`, `lastRefill` as a Redis Hash)
- ✅ `token-bucket.lua` — atomic check-and-update (no race conditions)
- ✅ `RateLimiterService` — pre-loads Lua SHA via `SCRIPT LOAD`, uses `EVALSHA`, falls back on `NOSCRIPT`, **fail-open** on Redis error
- 🔲 Unit tests for token bucket logic

**Key files:** `src/rate-limiter/token-bucket.lua`, `src/rate-limiter/rate-limiter.service.ts`

---

## Phase 3 — Identity Extraction ✅
Determines who is making the request. Produces one Redis key per identity layer.

- ✅ `IdentityService` extracts in priority order:
  1. `X-API-Key` header → `rl:apikey:<value>`
  2. `X-User-Id` header → `rl:user:<value>`
  3. IP (with `X-Forwarded-For` support) → `rl:ip:<addr>`
- ✅ All layers returned; guard checks each independently

**Key files:** `src/identity/identity.service.ts`

---

## Phase 4 — Rate Limiter Guard ✅
NestJS `APP_GUARD` that enforces rate limits on every request.

- ✅ Loops through all identity layers; **all must pass**
- ✅ First denied layer returns `429 Too Many Requests`
- ✅ Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`
- ✅ `@SkipRateLimit()` decorator to bypass per route

**Key files:** `src/rate-limiter/rate-limiter.guard.ts`

---

## Phase 5 — Rule Configuration ✅ (local) / 🔲 (AWS)
How rate limit rules (capacity, refill rate) are loaded.

- ✅ **Local:** Static rules from `RATE_LIMIT_RULES` env variable at startup. No runtime updates (keep it simple).
- 🔲 **AWS:** `AppConfigRulesProvider` — polls `localhost:2772` (AppConfig sidecar agent) every ~15s for live rule updates. ✅ (implemented, activates when `APP_MODE=aws`)


**Key files:** `src/rules/rules.service.ts`

---

## Phase 6 — Demo Endpoints ✅
Protected endpoints to demonstrate the rate limiter in action.

- ✅ `GET /resource/public` — `@SkipRateLimit()`, always 200
- ✅ `GET /resource/data` — rate limited (IP + user + apikey layers)
- ✅ `GET /resource/premium` — rate limited

**Key files:** `src/resource/resource.controller.ts`

---

## Phase 6.5 — Dockerization ✅
Bridges local development and AWS deployment by running the entire stack in containers.

- ✅ `Dockerfile` — multi-stage build for NestJS
- ✅ `docker-compose.yml` — links NestJS app and Redis with healthcheck
- ✅ Verify end-to-end in Docker environment

**Key files:** `Dockerfile`, `docker-compose.yml`

---

## Phase 7 — AWS Deployment ✅
Deploy to AWS in a cost-conscious way while making production-grade decisions.

### Architecture
```
Client → ALB → ECS Task
                 ├── NestJS app (:3000)       ← rate limiter
                 └── AppConfig agent (:2772)  ← sidecar, polls AppConfig for rules
                         ↓
               ElastiCache Redis (t4g.micro, single node)
```

### Steps
- ✅ CDK stack:
  - ECS Fargate task (2 containers: app + AppConfig agent)
  - ElastiCache `cache.t4g.micro` (single node, no cluster)
  - ALB + security groups
- ✅ AWS AppConfig application + environment + config profile (JSON rules document)
- ✅ `AppConfigRulesProvider` in NestJS (polls `localhost:2772`)
- ✅ Dockerfile for NestJS app
- ✅ IAM roles (ECS task role with AppConfig read access)

---

## Phase 8 — Observability & Monitoring 🔲
Improve visibility into rate limiting decisions and system health.

### Goals
- 🔲 **CloudWatch Custom Metrics:** Publish `RateLimitSuccess` vs `RateLimitExceeded` counts.
- 🔲 **CloudWatch Dashboard:** Visualize throughput and reject rate per identity layer.
- 🔲 **Rules Admin CLI:** Dedicated tool to update rules without AWS CLI boilerplate (Started: `scripts/update-rules.sh`).

---

## Benchmark History

### 2026-03-27 — Initial AWS Benchmark
- **Test:** 100 connections, 20 seconds, `-H "X-User-Id: benchmark-user-1"`
- **Config:** User capacity 50, refill 10/s.
- **Results:**
    - Successes: 249 (100% match with 250 theoretical limit)
    - Avg Latency: 46ms
    - Throughput: 2,145 Req/Sec
- **Verdict:** System is correctly enforcing multi-layered rules at scale.
