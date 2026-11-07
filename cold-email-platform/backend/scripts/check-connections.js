require('dotenv').config();
const mongoose = require('mongoose');
const Redis = require('ioredis');

async function main() {
  let redis;
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.db.admin().ping();
    console.log('MongoDB OK');
  } catch (error) {
    console.log('MongoDB error:', error.message);
  }

  try {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    await redis.ping();
    console.log('Redis OK');
  } catch (error) {
    console.log('Redis error:', error.message);
  } finally {
    if (redis) await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.log('Connection check error:', error.message);
  process.exitCode = 1;
});
