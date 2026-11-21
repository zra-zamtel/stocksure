// Extends app.json at build time. The only dynamic value is the Android
// versionCode: the release pipeline sets APP_VERSION_CODE to the CI run number,
// so every APK is newer than the last and installs over it without
// uninstalling. Local builds without it keep app.json's values.
module.exports = ({ config }) => {
  const versionCode = Number.parseInt(process.env.APP_VERSION_CODE ?? '', 10);
  if (!Number.isInteger(versionCode) || versionCode < 1) return config;
  return { ...config, android: { ...config.android, versionCode } };
};
