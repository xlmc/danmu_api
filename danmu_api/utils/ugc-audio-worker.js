import { workerData, parentPort } from 'node:worker_threads';
import { validateAudioTimeline } from './ugc-audio-util.js';
parentPort.postMessage(validateAudioTimeline(workerData.reference, workerData.candidate, workerData.settings));
