// Speech for the headed walkthrough: what a screen reader would say at each stop, spoken aloud with the macOS
// system voice (the voices VoiceOver itself uses) and laid under the recorded video as a narration track with
// captions. macOS `say` writes 16-bit mono WAV; the track is assembled here and muxed with the workspace's ffmpeg.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { load } = require('./deps.cjs');

const RATE = 22050;
const VOICE = process.env.A11Y_VOICE || 'Samantha';
const WORDS_PER_MINUTE = Number(process.env.A11Y_VOICE_RATE || 210);

function requireSay() {
	if (process.platform !== 'darwin') throw new Error('Spoken walkthroughs use macOS `say`; run them on a Mac, or leave out --speak and --narrate');
}

/** Speaks `text` aloud and resolves when it has finished. */
function speak(text) {
	requireSay();
	return new Promise((resolve, reject) => {
		const child = spawn('say', ['-v', VOICE, '-r', String(WORDS_PER_MINUTE), text]);
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`say exited ${code} speaking "${text}"`))));
	});
}

/** Writes `text` as speech to a WAV file and returns its duration in seconds. */
function synthesise(text, file) {
	requireSay();
	const run = spawnSync('say', ['-v', VOICE, '-r', String(WORDS_PER_MINUTE), '--file-format=WAVE', `--data-format=LEI16@${RATE}`, '-o', file, text], { encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`say could not write ${file}: ${run.stderr}`);
	return readWav(file).samples.length / RATE;
}

/** Mono 16-bit PCM samples of a WAV file (chunks walked, since `say` adds one before the data). */
function readWav(file) {
	const buffer = fs.readFileSync(file);
	if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
	let offset = 12;
	let format = null;
	while (offset + 8 <= buffer.length) {
		const id = buffer.toString('ascii', offset, offset + 4);
		const size = buffer.readUInt32LE(offset + 4);
		const body = offset + 8;
		if (id === 'fmt ') format = { channels: buffer.readUInt16LE(body + 2), rate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
		if (id === 'data') {
			if (!format || format.channels !== 1 || format.bits !== 16 || format.rate !== RATE) throw new Error(`${file}: expected mono 16-bit ${RATE} Hz, got ${JSON.stringify(format)}`);
			return { samples: new Int16Array(buffer.buffer.slice(buffer.byteOffset + body, buffer.byteOffset + body + size)) };
		}
		offset = body + size + (size % 2);
	}
	throw new Error(`${file} has no data chunk`);
}

function writeWav(file, samples) {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + samples.length * 2, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(RATE, 24);
	header.writeUInt32LE(RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(samples.length * 2, 40);
	fs.writeFileSync(file, Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]));
}

/** One narration track: each clip placed at its start time (seconds) on silence `duration` seconds long. */
function buildTrack(clips, duration, file) {
	const track = new Int16Array(Math.ceil((duration + 1) * RATE));
	for (const clip of clips) {
		const { samples } = readWav(clip.file);
		track.set(samples.subarray(0, Math.max(0, track.length - Math.round(clip.start * RATE))), Math.round(clip.start * RATE));
	}
	writeWav(file, track);
}

const stamp = (seconds) => {
	const ms = Math.round(seconds * 1000);
	const pad = (n, w = 2) => String(n).padStart(w, '0');
	return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

/** WebVTT captions: one cue per clip, until the next clip starts. */
function writeCaptions(clips, file) {
	const cues = clips.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(clips[i + 1] ? Math.min(clips[i + 1].start, c.start + c.duration + 1.5) : c.start + c.duration + 1.5)}\n${c.text}\n`);
	fs.writeFileSync(file, `WEBVTT\n\n${cues.join('\n')}`);
}

/** The recorded video with the narration track and soft captions, as H.264/AAC MP4. */
function muxNarration(video, track, captions, out) {
	const ffmpeg = load('ffmpeg-static');
	const run = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, '-i', track, '-i', captions, '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-shortest', out], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
	if (run.status !== 0) throw new Error(`ffmpeg could not build ${path.basename(out)}: ${run.stderr || run.error?.message}`);
	return out;
}

module.exports = { speak, synthesise, buildTrack, writeCaptions, muxNarration, readWav };
