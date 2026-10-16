/* Minimal mocked Web Audio API for tests. */
export class MockParam {
  value = 0;
  calls: Array<[string, ...number[]]> = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.calls.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(['ramp', v, t]); return this; }
  setTargetAtTime(v: number, t: number, c: number) { this.value = v; this.calls.push(['target', v, t, c]); return this; }
  cancelScheduledValues(t: number) { this.calls.push(['cancel', t]); return this; }
}
export class MockNode {
  connections: unknown[] = [];
  connected = true;
  connect(n: unknown) { this.connections.push(n); return n; }
  disconnect() { this.connected = false; }
}
export class MockGain extends MockNode { gain = new MockParam(); }
export class MockPanner extends MockNode {
  panningModel = 'equalpower'; distanceModel = 'inverse'; refDistance = 1; maxDistance = 10000; rolloffFactor = 1;
  coneInnerAngle = 360; coneOuterAngle = 360; coneOuterGain = 0;
  positionX = new MockParam(); positionY = new MockParam(); positionZ = new MockParam();
  orientationX = new MockParam(); orientationY = new MockParam(); orientationZ = new MockParam();
}
export class MockSource extends MockNode {
  buffer: unknown = null; loop = false; playbackRate = new MockParam(); onended: (() => void) | null = null;
  started: number | null = null; stopped: number | null = null;
  start(t: number) { this.started = t; }
  stop(t: number) { this.stopped = t; }
  end() { this.onended?.(); }
}
export class MockMediaSource extends MockNode {}
export class MockListener {
  positionX = new MockParam(); positionY = new MockParam(); positionZ = new MockParam();
  forwardX = new MockParam(); forwardY = new MockParam(); forwardZ = new MockParam();
  upX = new MockParam(); upY = new MockParam(); upZ = new MockParam();
}
export class MockContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  destination = new MockNode();
  listener = new MockListener();
  gains: MockGain[] = [];
  sources: MockSource[] = [];
  resume = async () => { this.state = 'running'; };
  close = async () => { this.state = 'closed'; };
  createGain() { const g = new MockGain(); this.gains.push(g); return g; }
  createPanner() { return new MockPanner(); }
  createBufferSource() { const s = new MockSource(); this.sources.push(s); return s; }
  createMediaElementSource() { return new MockMediaSource(); }
  decodeAudioData = async (ab: ArrayBuffer) => ({ duration: 1, byteLength: ab.byteLength }) as unknown;
}
