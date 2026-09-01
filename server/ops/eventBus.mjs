// Kafka event bus: the change journal. Every write publishes a REPLAYABLE
// event (full mutation payload) to `studio.changes`. Checkpoints record the
// topic offset; point-in-time restore = checkpoint + replay from that offset.
// Kafka being down never blocks writes — events are best-effort published and
// the durable audit stays in the changelog graph.

import { Kafka, logLevel } from 'kafkajs';

export const TOPIC = 'studio.changes';
const MAX_BODY = 512 * 1024; // stay under broker message limits

let kafka = null;
let producer = null;
let state = 'off'; // off | connecting | up | failed
let connectPromise = null;

function brokers() {
    return (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(',').map((s) => s.trim());
}

async function ensureProducer(log = console) {
    if (state === 'up') return producer;
    if (state === 'failed') return null;
    if (!connectPromise) {
        state = 'connecting';
        connectPromise = (async () => {
            try {
                kafka = new Kafka({ clientId: 'ontology-studio', brokers: brokers(), logLevel: logLevel.NOTHING });
                producer = kafka.producer({ allowAutoTopicCreation: true });
                await producer.connect();
                // create the topic eagerly so checkpoints always find it
                const admin = kafka.admin();
                await admin.connect();
                await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 1 }] }).catch(() => {});
                await admin.disconnect();
                state = 'up';
                log.log(`event bus: connected to kafka (${brokers().join(',')}) topic ${TOPIC}`);
                return producer;
            } catch (e) {
                state = 'failed';
                connectPromise = null;
                log.warn(`event bus: kafka unavailable (${String(e.message).slice(0, 120)}) — events not journaled`);
                setTimeout(() => {
                    if (state === 'failed') state = 'off';
                }, 60_000); // retry window
                return null;
            }
        })();
    }
    return connectPromise; // first publisher WAITS for the connection — no dropped events
}

export function busStatus() {
    return state;
}

let seq = 0;

/**
 * Publish a change event. `replay` carries what a restore needs to re-apply
 * the mutation: { kind: 'sparql-update'|'store-post'|'store-delete', body?, graph?, contentType? }.
 * Oversized bodies are marked non-replayable (the next checkpoint covers them).
 */
export async function publishChange(event, log = console) {
    const p = await ensureProducer(log);
    if (!p) return false;
    const e = { ...event, seq: seq++, at: event.at ?? new Date().toISOString() };
    if (e.replay?.body && e.replay.body.length > MAX_BODY) {
        e.replay = { kind: e.replay.kind, graph: e.replay.graph, oversized: true };
    }
    try {
        await p.send({ topic: TOPIC, messages: [{ key: e.actor ?? 'system', value: JSON.stringify(e) }] });
        return true;
    } catch (err) {
        log.warn(`event bus: publish failed (${String(err.message).slice(0, 120)})`);
        state = 'off';
        return false;
    }
}

/** Latest offset per partition — recorded into checkpoint manifests. */
export async function currentOffsets(log = console) {
    await ensureProducer(log);
    if (state !== 'up') return null;
    const admin = kafka.admin();
    await admin.connect();
    try {
        const offsets = await admin.fetchTopicOffsets(TOPIC).catch(() => []);
        return offsets.map((o) => ({ partition: o.partition, offset: o.offset }));
    } finally {
        await admin.disconnect();
    }
}

/**
 * Read journal events from the recorded offsets, optionally only those with
 * at <= until. Consumes with a throwaway group; resolves when the end of the
 * topic (as of call time) is reached.
 */
export async function readJournal({ fromOffsets, until }, log = console) {
    await ensureProducer(log);
    if (state !== 'up') throw new Error('kafka unavailable — cannot replay the journal');
    const admin = kafka.admin();
    await admin.connect();
    const endOffsets = await admin.fetchTopicOffsets(TOPIC);
    await admin.disconnect();
    const end = new Map(endOffsets.map((o) => [o.partition, BigInt(o.offset)]));
    const start = new Map((fromOffsets ?? []).map((o) => [o.partition, BigInt(o.offset)]));
    const untilTs = until ? Date.parse(until) : Infinity;

    const events = [];
    const consumer = kafka.consumer({ groupId: `studio-replay-${Date.now()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await new Promise((resolve, reject) => {
        const pending = new Map(end); // partitions still behind their end offset
        for (const [part, endOff] of pending) {
            if ((start.get(part) ?? 0n) >= endOff) pending.delete(part);
        }
        if (pending.size === 0) return resolve();
        const timeout = setTimeout(() => resolve(), 30_000); // safety: never hang a restore
        consumer
            .run({
                eachMessage: async ({ partition, message }) => {
                    const off = BigInt(message.offset);
                    const startOff = start.get(partition) ?? 0n;
                    if (off >= startOff) {
                        try {
                            const e = JSON.parse(message.value.toString());
                            if (Date.parse(e.at) <= untilTs) events.push(e);
                        } catch {
                            /* skip malformed */
                        }
                    }
                    if (off + 1n >= (end.get(partition) ?? 0n)) {
                        pending.delete(partition);
                        if (pending.size === 0) {
                            clearTimeout(timeout);
                            resolve();
                        }
                    }
                },
            })
            .catch(reject);
    });
    await consumer.disconnect();
    events.sort((a, b) => a.at.localeCompare(b.at) || (a.seq ?? 0) - (b.seq ?? 0));
    return events;
}
