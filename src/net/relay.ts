// Backup route for friends rooms when phones can't connect directly (mobile data, strict Wi-Fi).
// Messages go through a public MQTT broker over a secure WebSocket, which works on any network
// that can open a website. No account needed. A tiny MQTT 3.1.1 client (publish/subscribe, QoS 0)
// is enough, so there is no extra library. Set VITE_RELAY_URL to use a different broker.

const BROKER: string = import.meta.env.VITE_RELAY_URL || 'wss://broker.hivemq.com:8884/mqtt';
const KEEPALIVE_S = 30;

type Handler = (data: Uint8Array) => void;

export interface Relay {
  /** Resolves once connected the first time; rejects if that takes too long. */
  ready: Promise<void>;
  isOpen(): boolean;
  subscribe(topic: string, fn: Handler): void;
  publish(topic: string, data: Uint8Array): void;
  close(): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type: number, body: Uint8Array | number[]): Uint8Array {
  const len: number[] = [];
  let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = type;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

export function openRelay(timeoutMs = 10000): Relay {
  let ws: WebSocket | null = null;
  let open = false;
  let closed = false;
  let pid = 1;
  let buf = new Uint8Array(0);
  let pinger = 0;
  let retry = 0;
  const subs = new Map<string, Handler>();
  const queue: Uint8Array[] = [];
  let firstOk: () => void = () => {};
  let firstFail: (e: Error) => void = () => {};
  const ready = new Promise<void>((res, rej) => { firstOk = res; firstFail = rej; });
  const failTimer = window.setTimeout(() => firstFail(new Error('relay timeout')), timeoutMs);

  const raw = (p: Uint8Array) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(p); };
  const sendSub = (topic: string) => {
    pid = (pid % 65535) + 1;
    raw(packet(0x82, [pid >> 8, pid & 255, ...str(topic), 0]));
  };

  const onPacket = (type: number, body: Uint8Array) => {
    const kind = type >> 4;
    if (kind === 2) { // CONNACK
      if (body[1] !== 0) return;
      open = true; retry = 0;
      clearTimeout(failTimer);
      subs.forEach((_, t) => sendSub(t));
      while (queue.length) raw(queue.shift()!);
      firstOk();
    } else if (kind === 3) { // PUBLISH
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      const qos = (type >> 1) & 3;
      const start = 2 + tlen + (qos ? 2 : 0);
      subs.get(topic)?.(body.subarray(start));
    }
  };

  const onData = (chunk: Uint8Array) => {
    const all = new Uint8Array(buf.length + chunk.length);
    all.set(buf); all.set(chunk, buf.length);
    let i = 0;
    while (i + 2 <= all.length) {
      let mult = 1, len = 0, j = i + 1, byte = 0;
      do { if (j >= all.length) { buf = all.slice(i); return; } byte = all[j++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
      if (j + len > all.length) break;
      onPacket(all[i], all.subarray(j, j + len));
      i = j + len;
    }
    buf = all.slice(i);
  };

  const connect = () => {
    if (closed) return;
    const s = new WebSocket(BROKER, ['mqtt']);
    ws = s;
    s.binaryType = 'arraybuffer';
    s.onopen = () => {
      buf = new Uint8Array(0);
      const id = 'ipl-' + Math.random().toString(36).slice(2, 12);
      raw(packet(0x10, [...str('MQTT'), 4, 0x02, KEEPALIVE_S >> 8, KEEPALIVE_S & 255, ...str(id)]));
      clearInterval(pinger);
      pinger = window.setInterval(() => raw(new Uint8Array([0xc0, 0])), 20000);
    };
    s.onmessage = e => onData(new Uint8Array(e.data as ArrayBuffer));
    s.onclose = () => {
      open = false;
      clearInterval(pinger);
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * retry);
    };
    s.onerror = () => { /* onclose retries */ };
  };

  const onShow = () => { if (document.visibilityState === 'visible' && !open && ws?.readyState !== WebSocket.CONNECTING) { ws?.close(); connect(); } };
  document.addEventListener('visibilitychange', onShow);
  connect();

  return {
    ready,
    isOpen: () => open,
    subscribe(topic, fn) { subs.set(topic, fn); if (open) sendSub(topic); },
    publish(topic, data) {
      const p = packet(0x30, [...str(topic), ...data]);
      if (open) raw(p); else if (queue.length < 20) queue.push(p);
    },
    close() {
      closed = true;
      clearTimeout(failTimer);
      clearInterval(pinger);
      document.removeEventListener('visibilitychange', onShow);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xe0, 0]));
      ws?.close();
    },
  };
}

// ---- message encoding: JSON, gzipped when the browser can (game state shrinks about 5x) ----

const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function pack(value: unknown): Promise<Uint8Array> {
  const json = enc.encode(JSON.stringify(value));
  if (canZip && json.length > 512) {
    const z = await pipe(json, new CompressionStream('gzip'));
    const out = new Uint8Array(z.length + 1); out[0] = 1; out.set(z, 1);
    return out;
  }
  const out = new Uint8Array(json.length + 1); out[0] = 0; out.set(json, 1);
  return out;
}

export async function unpack<T>(data: Uint8Array): Promise<T | null> {
  try {
    const body = data.subarray(1);
    const bytes = data[0] === 1 ? await pipe(body, new DecompressionStream('gzip')) : body;
    return JSON.parse(dec.decode(bytes)) as T;
  } catch { return null; }
}

/** Uncompressed, synchronous packing for a last message while the page is closing. */
export function packSync(value: unknown): Uint8Array {
  const json = enc.encode(JSON.stringify(value));
  const out = new Uint8Array(json.length + 1); out[0] = 0; out.set(json, 1);
  return out;
}

/** Sends packed messages in order (packing is async). */
export function orderedSender(relay: Relay, topic: string) {
  let chain = Promise.resolve();
  return (value: unknown) => { chain = chain.then(async () => relay.publish(topic, await pack(value))).catch(() => {}); };
}
