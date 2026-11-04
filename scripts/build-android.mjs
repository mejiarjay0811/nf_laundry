/**
 * Builds the Android APK.
 *
 * Exists because gradlew needs JAVA_HOME set before it can start, and this
 * machine has no system-wide Java — only the JDK bundled with Android Studio.
 * Without this the build fails with a bare "exit code 49", which says nothing
 * about the cause. Setting org.gradle.java.home in gradle.properties is not
 * enough: that tells Gradle which JDK to compile with, but the launcher has to
 * find one first.
 *
 * Usage:  npm run android:build
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where a JDK usually lives on Windows, most likely first. */
const CANDIDATES = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Android\\Android Studio\\jre',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Android Studio', 'jbr'),
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Java',
];

function findJdk() {
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    if (existsSync(path.join(candidate, 'bin', 'java.exe'))) return candidate;
  }
  return null;
}

const javaHome = findJdk();
if (!javaHome) {
  console.error('\nNo Java installation found. Android builds need a JDK.');
  console.error('Install Android Studio (which bundles one), or set JAVA_HOME.\n');
  console.error('Looked in:');
  for (const candidate of CANDIDATES) if (candidate) console.error('  ' + candidate);
  console.error('');
  process.exit(1);
}

console.log('Using JDK: ' + javaHome + '\n');

const gradlew = path.join(root, 'android', 'gradlew.bat');

// Node refuses to launch .bat/.cmd without a shell (CVE-2024-27980), so this
// goes through one; the path is quoted because it contains a space.
const result = spawnSync('"' + gradlew + '" assembleDebug --console=plain', {
  cwd: path.join(root, 'android'),
  env: { ...process.env, JAVA_HOME: javaHome },
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) process.exit(result.status ?? 1);

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log('\nAPK: ' + apk);
