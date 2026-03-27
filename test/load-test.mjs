// test/load-test.mjs
import autocannon from 'autocannon';

const BASE = 'http://localhost:3000';

// Helper to shoot a burst or sustained load
function run({ title, url, headers, connections = 10, amount, duration }) {
  console.log(`\n=== ${title} ===`);
  const opts = {
    url,
    connections,
    headers,
  };
  if (amount) opts.amount = amount;
  if (duration) opts.duration = duration;

  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) {
        console.error('  Error running autocannon:', err);
        return reject(err);
      }
      if (!result) {
        console.error('  No result returned from autocannon');
        return reject(new Error('No result returned from autocannon'));
      }
      console.log(`  2xx: ${result['2xx']}  |  non-2xx: ${result.non2xx}  |  Duration: ${result.duration}s`);
      resolve(result);
    });
  });
}

// 1. Anonymous IP — hits ip layer (capacity=200, refill=30/s)
await run({
  title: 'Anonymous IP — burst 250 reqs (expect ~200 ok, rest 429)',
  url: `${BASE}/resource/data`,
  amount: 250,
});

// 2. Different fake IPs via X-Forwarded-For — each gets its own bucket
for (const ip of ['1.2.3.1', '1.2.3.2', '1.2.3.3']) {
  await run({
    title: `Fake IP ${ip} — should each get full 200-token bucket`,
    url: `${BASE}/resource/data`,
    headers: { 'x-forwarded-for': ip },
    amount: 210,
  });
}

// 3. Named users — hits user layer (capacity=50) AND ip layer (capacity=200)
await run({
  title: 'User alice — user bucket (50 cap) is now the bottleneck (IP is 200)',
  url: `${BASE}/resource/data`,
  headers: { 'x-user-id': 'alice', 'x-forwarded-for': '10.0.0.1' },
  amount: 70,
});

// 4. API key — capacity (100 cap) is bottleneck (IP is 200)
await run({
  title: 'API Key test — 100 cap bucket is bottleneck',
  url: `${BASE}/resource/data`,
  headers: { 'x-api-key': 'my-key-abc', 'x-forwarded-for': '10.0.0.2' },
  amount: 150,
});

// 5. 6 Users — total 300 successful requests (6 * 50)
console.log('\n=== Multi-User Scaling: 6 Users (50 cap each) ===');
let total2xx = 0;
for (let i = 1; i <= 6; i++) {
  const res = await run({
    title: `User user-${i}`,
    url: `${BASE}/resource/data`,
    headers: { 'x-user-id': `user-${i}`, 'x-forwarded-for': `192.168.1.${i}` },
    amount: 60,
  });
  total2xx += res['2xx'];
}
console.log(`\n>>> GRAND TOTAL 2xx across 6 users: ${total2xx} (Expected: 300)`);

// 6. Sustained Throughput — 6 IPs for 30 seconds (CONCURRENT)
console.log('\n=== Sustained Load: 6 IPs for 30 seconds (CONCURRENT) ===');
const promises = [];
for (let i = 1; i <= 6; i++) {
  promises.push(run({
    title: `IP Sustained 192.168.10.${i}`,
    url: `${BASE}/resource/data`,
    headers: { 'x-forwarded-for': `192.168.10.${i}` },
    duration: 30, // 30 seconds
    connections: 20, // More connections to ensure we hit the refill limit
  }));
}

const results = await Promise.all(promises);
const totalSustained2xx = results.reduce((sum, res) => sum + res['2xx'], 0);

console.log(`\n>>> GRAND TOTAL 2xx after 30s across 6 CONCURRENT IPs: ${totalSustained2xx}`);
console.log(`Expecting > 1200 (Theory: (200 + 30*30) * 6 = 6600)`);
