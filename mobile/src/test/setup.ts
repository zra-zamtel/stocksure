// The shop runs on Lusaka time (UTC+2, no daylight saving). Pinning it makes
// day boundaries in tests the same on every developer machine and in CI.
process.env.TZ = 'Africa/Lusaka';

// Tests run against the development address. A shell or CI that sets the API
// address for a real build (EXPO_PUBLIC_API_URL) must not leak into them.
delete process.env.EXPO_PUBLIC_API_URL;
