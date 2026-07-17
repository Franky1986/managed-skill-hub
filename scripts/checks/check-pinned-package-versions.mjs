#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const ignoredDirectories = new Set([
  '.git',
  '.tmp',
  'data',
  'dist',
  'node_modules',
]);
const exactSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function findPackageManifests(directory) {
  const manifests = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        manifests.push(...findPackageManifests(join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && entry.name === 'package.json') {
      manifests.push(join(directory, entry.name));
    }
  }

  return manifests;
}

const findings = [];
const manifests = findPackageManifests(repositoryRoot).sort();

for (const manifestPath of manifests) {
  const manifestName = relative(repositoryRoot, manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  for (const section of dependencySections) {
    for (const [packageName, version] of Object.entries(manifest[section] ?? {})) {
      if (typeof version !== 'string' || !exactSemverPattern.test(version)) {
        findings.push(`${manifestName}: ${section}.${packageName}=${JSON.stringify(version)}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error('[FAIL] Dependency versions must use exact semantic versions.');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`[OK] ${manifests.length} package manifests use exact dependency versions.`);
