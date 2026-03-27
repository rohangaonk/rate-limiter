-- Token Bucket Rate Limiter - Lua Script
-- Executed atomically on Redis to prevent race conditions
--
-- KEYS[1]  = bucket key (e.g. "rl:ip:1.2.3.4")
-- ARGV[1]  = capacity    (max tokens)
-- ARGV[2]  = refillRate  (tokens per second)
-- ARGV[3]  = now         (current time in milliseconds)
--
-- Returns: { status, tokens_remaining, retry_after_ms }
--   status 1  = ALLOWED
--   status 0  = DENIED

local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])

-- Read current bucket state
local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens    = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
  -- First request: initialise bucket to full
  tokens    = capacity
  lastRefill = now
end

-- Refill tokens based on elapsed time
local elapsedSec = (now - lastRefill) / 1000.0
local refilled   = math.floor(elapsedSec * refillRate)
tokens = math.min(capacity, tokens + refilled)

-- If we added tokens, update lastRefill proportionally
-- so we don't "lose" fractional seconds on every call
if refilled > 0 then
  lastRefill = lastRefill + math.floor(refilled / refillRate * 1000)
end

if tokens >= 1 then
  -- Consume one token
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
  -- TTL = time to fully drain bucket from full + 1s buffer
  local ttlSec = math.ceil(capacity / refillRate) + 1
  redis.call('EXPIRE', key, ttlSec)
  return { 1, tokens, 0 }
else
  -- Persist state without consuming
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
  local ttlSec = math.ceil(capacity / refillRate) + 1
  redis.call('EXPIRE', key, ttlSec)
  -- Calculate ms until next token is available
  local msPerToken = math.ceil(1000 / refillRate)
  return { 0, 0, msPerToken }
end
