type Processor = { process: (inputs: Float32Array[][]) => boolean };

describe('meeting PCM audio packets', () => {
  const originalGlobals = {
    AudioWorkletProcessor: Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletProcessor'),
    registerProcessor: Object.getOwnPropertyDescriptor(globalThis, 'registerProcessor'),
    sampleRate: Object.getOwnPropertyDescriptor(globalThis, 'sampleRate'),
  };

  afterEach(() => {
    for (const [key, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  it.each([24_000, 44_100, 48_000])('sends consecutive 100 ms PCM16 packets at %i Hz', (rate) => {
    const packets: Int16Array[] = [];
    let processor: Processor | undefined;

    Object.assign(globalThis, {
      sampleRate: rate,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (buffer: ArrayBuffer) => packets.push(new Int16Array(buffer)),
        };
      },
      registerProcessor: (_name: string, constructor: new () => Processor) => {
        processor = new constructor();
      },
    });
    jest.isolateModules(() => {
      require('../meeting-audio-worklet');
    });

    // Audio rendering supplies 128-frame blocks; packet boundaries must retain
    // leftover samples across calls and keep the same duration after each send.
    const frames = Math.ceil((rate * 0.3) / 128);

    for (let index = 0; index < frames; index++) {
      expect(processor?.process([[new Float32Array(128).fill(0.5)]])).toBe(true);
    }

    expect(packets).toHaveLength(3);
    for (const packet of packets) {
      expect(packet).toHaveLength(rate / 10);
      expect(packet.every((sample) => sample === 16383)).toBe(true);
    }
  });
});
