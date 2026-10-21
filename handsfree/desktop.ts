// Browser adapters for the shared voice engines in @aj47/bb-voice-core, used
// when bb runs on the desktop (or any browser outside the bb voice shell).
//
// Electron has no Web Speech recognizer, so the classic loop records the mic,
// cuts each utterance at a pause with a simple energy detector, and sends it
// to bb's own voice transcription (the service the composer mic uses).
import {
  NO_KEEP_ALIVE,
  type ClassicPlatform,
  type LivePlatform,
  type LiveSessionConfig,
  type PeerConnection,
  type Recognizer,
  type RecognizerEvents,
  type Speaker,
} from "@aj47/bb-voice-core";

const FRAME_MS = 50;
const VOICE_MIN_RMS = 0.012; // floor for "someone is talking", over the adaptive noise floor
const VOICE_ONSET_MS = 150;
const SILENCE_MS = 900; // pause that ends an utterance
const IDLE_MS = 15_000; // restart a silent session so recordings stay small
const MAX_UTTERANCE_MS = 60_000;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export type Transcribe = (audio: Blob) => Promise<string>;

function createRecognizer(transcribe: Transcribe): Recognizer {
  let events: RecognizerEvents | null = null;
  let generation = 0;
  let mic: { stream: MediaStream; context: AudioContext; analyser: AnalyserNode } | null = null;
  let session: { recorder: MediaRecorder; timer: ReturnType<typeof setInterval> } | null = null;

  const openMic = async () => {
    if (mic) return mic;
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    mic = { stream, context, analyser };
    return mic;
  };

  const closeMic = () => {
    mic?.stream.getTracks().forEach((t) => t.stop());
    void mic?.context.close().catch(() => {});
    mic = null;
  };

  const rms = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>) => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += v * v;
    return Math.sqrt(sum / buffer.length);
  };

  const run = async (gen: number) => {
    let m: NonNullable<typeof mic>;
    try {
      m = await openMic();
    } catch (e: any) {
      if (gen !== generation) return;
      events?.error(e?.name === "NotAllowedError" ? "not-allowed" : "audio-capture", e?.message);
      events?.end();
      return;
    }
    if (gen !== generation) return;

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(m.stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const buffer = new Float32Array(m.analyser.fftSize);
    const startedAt = Date.now();
    let noiseFloor = 0.005;
    let voicedMs = 0;
    let heard = false;
    let lastVoiceAt = 0;

    const finish = (keep: boolean) => {
      clearInterval(timer);
      session = null;
      recorder.onstop = async () => {
        if (gen !== generation) return;
        if (keep && chunks.length) {
          try {
            const text = await transcribe(new Blob(chunks, { type: recorder.mimeType }));
            if (gen !== generation) return;
            if (text.trim()) events?.result(text, true);
          } catch (e: any) {
            if (gen !== generation) return;
            events?.error("transcription", e?.message ?? String(e));
          }
        }
        events?.end();
      };
      recorder.stop();
    };

    const timer = setInterval(() => {
      const level = rms(m.analyser, buffer);
      const now = Date.now();
      const voiced = level > Math.max(VOICE_MIN_RMS, noiseFloor * 3);
      if (!voiced) noiseFloor = noiseFloor * 0.95 + level * 0.05;
      voicedMs = voiced ? voicedMs + FRAME_MS : 0;
      if (voicedMs >= VOICE_ONSET_MS) {
        lastVoiceAt = now;
        if (!heard) {
          heard = true;
          events?.speech?.();
        }
      }
      if (heard && now - lastVoiceAt > SILENCE_MS) finish(true);
      else if (heard && now - startedAt > MAX_UTTERANCE_MS) finish(true);
      else if (!heard && now - startedAt > IDLE_MS) finish(false);
    }, FRAME_MS);

    session = { recorder, timer };
    recorder.start(250);
  };

  return {
    async requestPermission() {
      try {
        await openMic();
        return true;
      } catch {
        return false;
      }
    },
    listen(next) {
      events = next;
      return () => {
        if (events === next) events = null;
      };
    },
    start() {
      void run(++generation);
    },
    // Called while the agent speaks and on stop: drop the take and free the
    // mic so its indicator is off while we talk.
    abort() {
      generation++;
      if (session) {
        clearInterval(session.timer);
        session.recorder.onstop = null;
        if (session.recorder.state !== "inactive") session.recorder.stop();
        session = null;
      }
      closeMic();
    },
  };
}

const speaker: Speaker = {
  speak(text, { language, rate, onDone }) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = rate;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === language && v.localService);
    if (voice) utterance.voice = voice;
    utterance.onend = onDone;
    utterance.onerror = onDone;
    speechSynthesis.speak(utterance);
  },
  stop() {
    speechSynthesis.cancel();
  },
};

export function classicPlatform(transcribe: Transcribe): ClassicPlatform {
  return { recognizer: createRecognizer(transcribe), speaker, keepAlive: NO_KEEP_ALIVE };
}

export function livePlatform(negotiate: (offerSdp: string, session: LiveSessionConfig) => Promise<string>): LivePlatform {
  return {
    keepAlive: NO_KEEP_ALIVE,
    negotiate,
    createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnection,
    getUserMedia: () => navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS),
    playRemoteAudio(stream) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = stream as MediaStream;
      document.body.appendChild(audio);
      return () => {
        audio.srcObject = null;
        audio.remove();
      };
    },
  };
}
