declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

// Web Audio mixes sources into the context's native-rate mono stream. Send
// 100 ms PCM16 chunks and output silence so meeting audio is never echoed.
class MeetingAudioProcessor extends AudioWorkletProcessor {
  private readonly chunkSize = Math.round(sampleRate / 10);
  private samples = new Int16Array(this.chunkSize);
  private offset = 0;

  process(inputs: Float32Array[][]) {
    const channels = inputs[0];

    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;

      for (const channel of channels) sample += channel[index] / channels.length;
      sample = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(this.chunkSize);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('meeting-audio', MeetingAudioProcessor);
export {};
