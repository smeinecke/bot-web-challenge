import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROBES,
  collectMainObservations,
  collectSharedWorkerObservations,
  compareSnapshots,
  crossRealmMismatchesToFindings,
  type RealmSnapshot,
  type CrossRealmConsistencyResult,
  type CrossRealmProbe,
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

  it('does not treat a window-only probe mismatch when a worker simply lacks the API', () => {
    const snapshots: RealmSnapshot[] = [
      { realm: 'main', values: { 'navigator:userAgent': 'UA/1.0', 'screen:width': 1920, 'screen:height': 1080 } },
      { realm: 'worker', values: { 'navigator:userAgent': 'UA/1.0' } },
    ];
    const { mismatches, probeErrors } = compareSnapshots(snapshots);
    const screenMismatch = mismatches.find((m) => m.probe.id.startsWith('screen:'));
    expect(screenMismatch).toBeUndefined();
    expect(probeErrors).toHaveLength(0);
  });

  it('still detects a mismatch for a probe that is valid in both realms', () => {
    const snapshots: RealmSnapshot[] = [
      { realm: 'main', values: { 'navigator:userAgent': 'UA/1.0' } },
      { realm: 'worker', values: { 'navigator:userAgent': 'Bot/1.0' } },
    ];
    const { mismatches, probeErrors } = compareSnapshots(snapshots);
    expect(probeErrors).toHaveLength(0);
    const uaMismatch = mismatches.find((m) => m.probe.id === 'navigator:userAgent');
    expect(uaMismatch).toBeDefined();
    expect(uaMismatch?.referenceValue).toBe('UA/1.0');
    expect(uaMismatch?.otherValue).toBe('Bot/1.0');
  });

  it('turns a probe evaluation error in an applicable realm into inconclusive, not a pass', () => {
    const snapshots: RealmSnapshot[] = [
      { realm: 'main', values: { 'navigator:userAgent': 'UA/1.0' } },
      { realm: 'worker', values: { 'navigator:userAgent': 'UA/1.0', 'webgl:vendorRenderer': { _error: 'OffscreenCanvas not supported' } } },
    ];
    const { mismatches, probeErrors } = compareSnapshots(snapshots);
    expect(mismatches).toHaveLength(0);
    const webglError = probeErrors.find((pe) => pe.probe.id === 'webgl:vendorRenderer' && pe.realm === 'worker');
    expect(webglError).toBeDefined();

    const result: CrossRealmConsistencyResult = { snapshots, mismatches, inconclusive: [], probeErrors };
    const findings = crossRealmMismatchesToFindings(result);
    const inconclusive = findings.find((f) => f.status === 'inconclusive' && f.context === 'worker');
    expect(inconclusive).toBeDefined();
  });

  it('SharedWorker unsupported is not a bot finding', async () => {
    const snapshot = await collectSharedWorkerObservations();
    expect(snapshot.inconclusive).toBe(true);
    expect(snapshot.realm).toBe('shared-worker');

    const result: CrossRealmConsistencyResult = { snapshots: [snapshot], mismatches: [], inconclusive: [snapshot] };
    const findings = crossRealmMismatchesToFindings(result);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('inconclusive');
    expect(findings[0].artifactId).toBe('cross-realm:shared-worker');
    expect(findings[0].context).toBe('shared-worker');
  });

  it('uses a realm-specific OffscreenCanvas expression for worker WebGL', () => {
    const webglProbe = DEFAULT_PROBES.find((p) => p.id === 'webgl:vendorRenderer') as CrossRealmProbe;
    expect(webglProbe.realms).toContain('worker');
    expect(webglProbe.realms).toContain('shared-worker');
    expect(webglProbe.exprByRealm?.worker).toContain('OffscreenCanvas');
    expect(webglProbe.exprByRealm?.['shared-worker']).toContain('OffscreenCanvas');
    expect(webglProbe.expr).toContain('document.createElement');
  });

  it('exposes low-entropy userAgentData in SharedWorker-compatible probe set', () => {
    const uadProbe = DEFAULT_PROBES.find((p) => p.id === 'navigator:userAgentData') as CrossRealmProbe;
    expect(uadProbe).toBeDefined();
    expect(uadProbe.realms).toContain('shared-worker');
    expect(uadProbe.realms).toContain('worker');
    expect(uadProbe.realms).toContain('main');
  });

  it('does not require DOM-only probes in SharedWorker realms', () => {
    const screenProbe = DEFAULT_PROBES.find((p) => p.id === 'screen:width') as CrossRealmProbe;
    expect(screenProbe.realms).not.toContain('shared-worker');
    expect(screenProbe.realms).not.toContain('worker');

    const deviceMemoryProbe = DEFAULT_PROBES.find((p) => p.id === 'navigator:deviceMemory') as CrossRealmProbe;
    expect(deviceMemoryProbe.realms).not.toContain('shared-worker');
    expect(deviceMemoryProbe.realms).not.toContain('worker');
  });

  it('detects mismatches across main and SharedWorker realms', () => {
    const snapshots: RealmSnapshot[] = [
      { realm: 'main', values: { 'navigator:languages': '[]' } },
      { realm: 'shared-worker', values: { 'navigator:languages': '["en-US"]' } },
    ];
    const { mismatches } = compareSnapshots(snapshots);
    const mismatch = mismatches.find((m) => m.probe.id === 'navigator:languages');
    expect(mismatch).toBeDefined();
  });
});
