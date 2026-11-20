/* global registerProcessor, AudioWorkletProcessor */
class Capture extends AudioWorkletProcessor {
  process([input]) {
    if (input[0]) this.port.postMessage(input[0].slice());
    return true;
  }
}

registerProcessor("capture", Capture);
