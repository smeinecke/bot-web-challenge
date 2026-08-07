import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROBES,
  collectMainObservations,
  crossRealmMismatchesToFindings,
  type RealmSnapshot,
  type CrossRealmConsistencyResult,
} from './cross-realm';

const allSame: RealmSnapshot[] = [
  { realm: 'main', values: { 'navigator:userAgent': 'UA/1.0', 'navigator:platform': 'Win32', 'webgl:vendorRenderer': { vendor: 'NVIDIA', renderer: 'GTX' } } },
  { realm: 'same-origin-iframe', values: { 'navigator:userAgent': 'UA/1.0', 'navigator:platform': 'Win32', 'webgl:vendorRenderer': { vendor: 'NVIDIA', renderer: 'GTX' } } },
  { realm: 'blob-iframe', values: { 'navigator:userAgent': 'UA/1.0', 'navigator:platform': 'Win32', 'webgl:vendorRenderer': { vendor: 'NVIDIA', renderer: 'GTX' } } },
  { realm: 'worker', values: { 'navigator:userAgent': 'UA/1.0', 'navigator:platform': 'Win32', 'webgl:vendorRenderer': { vendor: 'NVIDIA', renderer: 'GTX' } } },
];

const withWorkerInconclusive: RealmSnapshot[] = [
  ...allSame.slice(0, 3),
  { realm: 'worker', values: {}, inconclusive: true, reason: 'workerUnsupported', description: 'Workers not supported' },
];

const withUserAgentMismatch: RealmSnapshot[] = [
  allSame[0],
  { ...allSame[1], values: { ...allSame[1].values, 'navigator:userAgent': 'Bot/1.0' } },
  allSame[2],
  allSame[3],
];

describe('cross-realm consistency engine', () => {
  it('collects main observations for the default probe set', () => {
    const main = collectMainObservations();
    expect(main.realm).toBe('main');
    for (const probe of DEFAULT_PROBES) {
      expect(main.values).toHaveProperty(probe.id);
    }
  });

  it('reports no findings when all realms are consistent', () => {
    const result: CrossRealmConsistencyResult = { snapshots: allSame, mismatches: [], inconclusive: [] };
    const findings = crossRealmMismatchesToFindings(result);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('passed');
    expect(findings[0].artifactId).toBe('cross-realm:consistent');
  });

  it('emits inconclusive findings for failed realm collection', () => {
    const result: CrossRealmConsistencyResult = { snapshots: withWorkerInconclusive, mismatches: [], inconclusive: [withWorkerInconclusive[3]] };
    const findings = crossRealmMismatchesToFindings(result);
    const inconclusive = findings.filter(f => f.status === 'inconclusive');
    expect(inconclusive).toHaveLength(1);
    expect(inconclusive[0].context).toBe('worker');
  });

  it('emits findings for user-agent mismatch across realms', () => {
    const result: CrossRealmConsistencyResult = { snapshots: withUserAgentMismatch, mismatches: [], inconclusive: [] };
    result.mismatches.push({
      probe: DEFAULT_PROBES.find(p => p.id === 'navigator:userAgent')!,
      referenceRealm: 'main',
      otherRealm: 'same-origin-iframe',
      referenceValue: 'UA/1.0',
      otherValue: 'Bot/1.0',
    });
    const findings = crossRealmMismatchesToFindings(result);
    const mismatch = findings.find(f => f.artifactId === 'cross-realm:navigator:userAgent');
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('strong');
    expect(mismatch?.status).toBe('finding');
  });
});
