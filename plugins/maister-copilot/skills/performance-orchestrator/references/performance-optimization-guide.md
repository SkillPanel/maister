# Performance Optimization Guide

Reference covering performance metrics knowledge, optimization patterns, and static analysis detection strategies.

## Table of Contents

1. [Performance Metrics](#performance-metrics)
2. [Optimization Patterns](#optimization-patterns)
3. [Static Analysis Detection Patterns](#static-analysis-detection-patterns)

---

# Performance Metrics

## Response Time Metrics

**p50 (Median)**: 50% of requests faster than this value
**p95**: 95% of requests faster (typical SLA target)
**p99**: 99% of requests faster (worst-case for most users)
**Max**: Slowest request (often outlier, less important)

**Interpretation Thresholds**:
- p95 < 100ms: Excellent
- p95 100-500ms: Good
- p95 500-1000ms: Acceptable
- p95 > 1000ms: Slow (optimization needed)

## Throughput Metrics

**Requests/sec**: Total requests handled per second
**Transactions/sec**: Completed transactions per second
**Saturation Point**: Concurrency level where throughput plateaus

## CPU Metrics

**Usage %**: Overall CPU utilization
**Hot Functions**: Top functions by CPU time
**Complexity**: O(n), O(n log n), O(n^2), etc.

**Thresholds**:
- < 70%: Good headroom
- 70-90%: Acceptable
- \> 90%: Saturated

## Memory Metrics

**Heap Size**: Current memory usage
**Heap Growth**: Memory increase over time (leak indicator)
**GC Frequency**: Garbage collection frequency

**Leak Detection**: Heap grows continuously without plateau

## Database Metrics

**Queries/Request**: Total database queries per request
**Query Time**: Time spent in database
**N+1 Pattern**: 1 query + N related queries in loop
**Missing Indexes**: Full table scans

---

# Optimization Patterns

## Database Optimizations

### Fix N+1 Queries

**Problem**: 1 query to fetch list + N queries for related data

**Bad** (N+1 pattern):
```javascript
const users = await User.findAll();  // 1 query
for (let user of users) {
  user.profile = await Profile.findByPk(user.id);  // N queries
}
```

**Good** (eager loading):
```javascript
const users = await User.findAll({
  include: [{ model: Profile }]  // Single JOIN query
});
```

### Add Missing Indexes

**Detection**: Query filters/sorts on unindexed columns

```sql
-- Before (slow - sequential scan)
SELECT * FROM orders WHERE user_id = 123;

-- Add index
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);

-- After (fast - index scan)
```

### Connection Pooling

```javascript
// Bad: New connection per query
const connection = await mysql.createConnection(config);

// Good: Connection pool
const pool = mysql.createPool({
  connectionLimit: 10,
  ...config
});
```

## Algorithm Optimizations

### Replace O(n^2) with O(n)

**Bad** (nested loops):
```javascript
// O(n^2)
for (let user of users) {
  for (let order of orders) {
    if (order.userId === user.id) {
      user.orders.push(order);
    }
  }
}
```

**Good** (hash map):
```javascript
// O(n)
const ordersByUser = {};
for (let order of orders) {
  if (!ordersByUser[order.userId]) ordersByUser[order.userId] = [];
  ordersByUser[order.userId].push(order);
}
for (let user of users) {
  user.orders = ordersByUser[user.id] || [];
}
```

### Memoization

**Bad** (repeated calculations):
```javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);  // Exponential time
}
```

**Good** (memoized):
```javascript
const memo = {};
function fibonacci(n) {
  if (n <= 1) return n;
  if (memo[n]) return memo[n];
  memo[n] = fibonacci(n - 1) + fibonacci(n - 2);
  return memo[n];
}
```

## Caching Strategies

### Cache Expensive Operations

```javascript
// Bad: Calculate every time
app.get('/stats', async (req, res) => {
  const stats = await calculateExpensiveStats();  // 5 seconds
  res.json(stats);
});

// Good: Cache results
const cache = new Map();
app.get('/stats', async (req, res) => {
  let stats = cache.get('stats');
  if (!stats) {
    stats = await calculateExpensiveStats();
    cache.set('stats', stats);
    setTimeout(() => cache.delete('stats'), 60000);  // TTL: 1 min
  }
  res.json(stats);
});
```

### Redis Caching

```javascript
const redis = require('redis');
const client = redis.createClient();

// Cache expensive query
async function getUser(id) {
  const cached = await client.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  await client.setex(`user:${id}`, 3600, JSON.stringify(user));  // TTL: 1 hour
  return user;
}
```

## I/O Optimizations

### Async vs Sync

**Bad** (blocking):
```javascript
const data = fs.readFileSync('large-file.json');  // Blocks event loop
```

**Good** (non-blocking):
```javascript
const data = await fs.promises.readFile('large-file.json');  // Async
```

### Parallel API Calls

**Bad** (sequential):
```javascript
const user = await fetchUser(id);       // 200ms
const orders = await fetchOrders(id);   // 200ms
const profile = await fetchProfile(id); // 200ms
// Total: 600ms
```

**Good** (parallel):
```javascript
const [user, orders, profile] = await Promise.all([
  fetchUser(id),
  fetchOrders(id),
  fetchProfile(id)
]);
// Total: 200ms (slowest of the three)
```

## Memory Optimizations

### Streaming Large Data

**Bad** (load all):
```javascript
const data = await fs.promises.readFile('large-file.csv');  // 1GB in memory
processCSV(data);
```

**Good** (stream):
```javascript
const stream = fs.createReadStream('large-file.csv');
stream.pipe(csvParser()).on('data', processRow);  // Constant memory
```

### Object Pooling

```javascript
// Bad: Create new objects constantly
for (let i = 0; i < 1000000; i++) {
  const obj = { x: i, y: i * 2 };  // 1M allocations
  process(obj);
}

// Good: Reuse objects
const pool = { x: 0, y: 0 };
for (let i = 0; i < 1000000; i++) {
  pool.x = i;
  pool.y = i * 2;  // 1 allocation, reused
  process(pool);
}
```

---

# Static Analysis Detection Patterns

Strategies for detecting performance bottlenecks by reading code rather than running profiling tools.

## Database Pattern Detection

### N+1 Query Detection by Framework

**Generic ORM-in-loop patterns** (Grep heuristics):
- Query call inside `for`/`forEach`/`map`/`while` body
- `await` + model method inside iteration callback
- Lazy-loaded relationship access inside loop

**Framework-specific indicators**:

| Framework | N+1 Pattern | Fix Pattern |
|-----------|-------------|-------------|
| Sequelize | `.findByPk()`/`.findOne()` in loop | `include: [{ model: X }]` |
| Prisma | `prisma.x.findUnique()` in loop | `include: { x: true }` |
| TypeORM | `repository.findOne()` in loop | `relations: ['x']` or QueryBuilder `.leftJoinAndSelect()` |
| Django | Attribute access in template `{% for %}` | `.select_related()`/`.prefetch_related()` |
| Rails | Association call without `.includes()` | `.includes(:association)` |
| SQLAlchemy | Relationship access in loop | `joinedload()`/`subqueryload()` |
| Hibernate | `@ManyToOne` lazy access in loop | `@Fetch(FetchMode.JOIN)` or JPQL `JOIN FETCH` |

### Missing Index Detection

**Cross-reference strategy**:
1. Find all index definitions in schema/migration files
2. Find all query patterns (WHERE, ORDER BY, JOIN columns)
3. Flag columns queried but not indexed

**Where to find indexes by framework**:
- **Rails**: `add_index` in `db/migrate/` files
- **Django**: `db_index=True` in model fields, `indexes` in Meta
- **Sequelize**: `indexes` array in model definition
- **Prisma**: `@@index` and `@@unique` in schema.prisma
- **TypeORM**: `@Index()` decorator
- **SQL migrations**: `CREATE INDEX` statements

### Slow Query Pattern Indicators

Patterns detectable from code without running queries:
- `SELECT *` on tables with many columns
- Missing `LIMIT`/`TOP` on queries against known-large tables
- `LIKE '%...'` (leading wildcard prevents index use)
- `OR` conditions on different columns (prevents single index use)
- Subqueries in WHERE that could be JOINs
- `DISTINCT` masking a JOIN issue

## Algorithm Pattern Detection

### Nested Loop / O(n^2) Heuristics

**Search patterns**:
- Nested `for`/`forEach`/`while` loops over same or related collections
- `.find()`/`.filter()`/`.some()`/`.includes()` inside `.map()`/`.forEach()`/`for`
- `.indexOf()` inside loop (linear search repeated)
- `.sort()` inside loop (O(n log n) per iteration)

**Fix indicators**: Can be resolved by pre-building a Map/Set/index before the loop

### Blocking I/O Patterns

**Node.js sync operations**:
- `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `existsSync`
- `execSync`, `spawnSync`
- `crypto.pbkdf2Sync`, `crypto.randomBytesSync`

**Sequential awaits** (should be `Promise.all`):
- Multiple `await` statements on independent operations in same function
- Sequential HTTP/fetch calls to different endpoints
- Sequential database queries with no data dependency between them

## Memory Pattern Detection

**Unbounded growth indicators**:
- `Map`/`Set`/`Object`/`Array` in module or class scope with `.set()`/`push()` but no `.delete()`/eviction
- No size limit check before adding to collection
- No TTL or expiration mechanism

**Leak-prone patterns**:
- `addEventListener`/`.on()` without paired `removeEventListener`/`.off()`
- `setInterval` without `clearInterval` in cleanup/destroy/unmount
- Closures in long-lived callbacks capturing large objects

## Caching Opportunity Detection

**Indicators**:
- Same query/function called multiple times with same parameters in a request lifecycle
- Database query in a loop that could be batched and cached
- External API call returning reference/config data (infrequent changes)
- Expensive computation (sort, aggregate, transform) on data that doesn't change per-request
