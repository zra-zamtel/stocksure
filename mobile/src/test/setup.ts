// The shop runs on Lusaka time (UTC+2, no daylight saving). Pinning it makes
// day boundaries in tests the same on every developer machine and in CI.
process.env.TZ = 'Africa/Lusaka';
