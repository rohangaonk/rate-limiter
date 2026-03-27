
## Rate Limiter

### Requirements

- should allow only set number of requests to the internal system in a given time
- should support dynamic rate limiting
- should support uniform distribution of requests over a span of time (handle sudden peaks)

Neetcode

- rate limitter should be placed in api gateway to block traffic before it reaches backend
- system must determine stable identify per request (user, api-key, ip, tenant)
- should allow short burts of requests while enforcing average over long term period.
- In cases of multiple gateway instances system should enforce consistent limits.
- users/devs should be able to update rate limits across gateway instances without re-deploying gateway

Hello interview

- identify clients based on user, api key etc
- should limit based on rules like 100 requests per minute.
- when limits are exceeded system should return 429 too many requests.

### Non Functional Requirements

- should handle peak load of 100k requests per second
- system should be highly available → prefer availability over consistency
- system should be fault tolerant to avoid single point of failure

Neetcode

- 1 million requests per second at gateway
- millions of unique users without running out of memory
- less than 10ms of latency
- api should still function incase of rate limiter has problems
- decide what happens in case limiter is down allow all vs allow none
- consistency on stale reads in order not to allow extra requests.
- ensure users cannot fake their identities.

Hello interview

- 1 million rps across 100 million DAU.
- less than 10 ms of latency
- Highly available , eventually consistent, slight delays in limit enforcement is okay.

### Core Entities

- identity
- request counter per identity

Hello interview

- Rules → eg. authenticated users get 1k request per hour/minute, search api allows 10 request per second etc
- clients → could be users, ip, api keys etc.
- Requests → incoming request that need to be evaluated against

### High level design

![rate-limiter.jpg](attachment:5ed594a6-59ff-449f-a132-f26f9849657d:rate-limiter.jpg)

Neetcode 

- rate limiter lives inline with gateway. rate limiter module receives identity, request and returns block or allow, remaining quota, how much to wait before next call.
- we derive identity from authentication context (gateway already authenticates each request)
- a request must follow per api key, per tenant, per ip. if all is true we allow.
- talks about layering approach for each criteria at api key level, at tenant level ,at ip level etc.

Hello interview

- system need a way to identify users based on id, ip, api key etc
- best solution is to put rate limiter as part of gateway
- talk about rules and layering at user level, ip level, global limits etc
- discussions on rate limitting algorightms
    - Fixed window counter
        - count request in each window eg minutes
        - suffers from boundary effect
    - Sliding window log
        - keeps a log of each request timestamp
        - this helps to get the exact requests remaining but memory is the issue.
    - sliding window counter
        - if you are 30% into the current window you count,
        - 70% of the previous minute request plus 100 percent of this minute
        - but this is approximation and assumes traffic to be evenly distributed
    - Token bucket
- prefers Token bucket algorithm for this implementation
- track current count and last refill time, you already know refill rate so calculation is very easy
- if user x bucket was last updated 30s before and refill rate is 1 rps then we can add 30 requests to user x’s bucket upto max capacity of course.
- need to add lua script to prevent race condition between read →calculate →update
- when limits are exceeded return 429.
- along with 429 we also send some helpful headers
    - rate limit ceiling for that request → 100
    - remaining requests - > 0
    - limit reset → unix timestamp. or retry after → 30s

### Deep Dives

Hello interview

fulfiling non functional requirements

- 1M requests per second
    - typical redis instance can handle 100k to 200k ops per second depending upon complexity of ops. in our case there are more than 1 ops with lua scripting redis can handle apprx 50k to 100k rate limit checks per second.
    - we can use multiple redis instances but we need to be careful on how we shard the data
    - we want same user to land on same instance so userId hash becomes the most valid candidate for sharding. for anonymous user we may has ip address. for api key we has api keys. Also need to use consistent hashing to minimise rebalancing.
    - This will ensure that single user bucket lives on same shard.
    - Best practice in production is to use redis cluster (aws support this) instead of you managing the individual redis instances. cluster auto shards (has its own logic may not be user id based) data into 16384 shards.
    - we can also enable replication (in aws) to ensure higher availability and single point failure.
    - Redis has master-replica replication when master fails read replica is promoted
    - If still system fail then we either need to fail open or fail closed but this depends on kind of application and use case.
- Less than 10ms latency
    - though redis ops are sub-millisecond we may still experience latency due to 1M rps.
    - using connection pooling instead of new tcp connection for each request this is by default but we need to tune it for our use case.
- Handling hot key problem
    - very rare that single ip or client can create hot key
    - if clients need higher rates offer higher tiers. with high pricing.
- Handling dynamic rule configuration  → 2 approaches
    - poll based where rate limit module will periodically call db or other service where limits are stored. but there could be delay based on poll interval.
    - push based something like zookeeper where config changes are immediately sent to all api gateways. when rate limit rule is updated config service immediately notifies all the gateways which then update their rule.