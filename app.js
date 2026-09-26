const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const midiInput = document.getElementById("midi-input");
const playBtn = document.getElementById("play-btn");
const modeBtn = document.getElementById("mode-btn");
const clearBtn = document.getElementById("clear-btn");
const synthSelect = document.getElementById("synth-select");
const bpmSlider = document.getElementById("bpm-slider");
const bpmVal = document.getElementById("bpm-val");

const trackListEl = document.getElementById("track-list");
const addTrackBtn = document.getElementById("add-track-btn");
const addDrumBtn = document.getElementById("add-drum-btn");

const MIN_NOTE = 21;
const MAX_NOTE = 108;
const TOTAL_NOTES = MAX_NOTE - MIN_NOTE + 1;

const TRACK_COLORS = [
  "#9fb0ff", "#67d7b0", "#f6c76f",
  "#ef8fbd", "#b493ff", "#66c8df"
];

/* General MIDI percussion map.
   The editor uses the most useful 12 lanes; MIDI import can still retain
   any other percussion note. */
const DRUM_LANES = [
  { midi: 49, name: "Crash" },
  { midi: 42, name: "Hi-Hat" },
  { midi: 46, name: "Open HH" },
  { midi: 38, name: "Snare" },
  { midi: 37, name: "Side Stick" },
  { midi: 36, name: "Kick" },
  { midi: 35, name: "Kick 2" },
  { midi: 45, name: "Low Tom" },
  { midi: 47, name: "Mid Tom" },
  { midi: 50, name: "High Tom" },
  { midi: 51, name: "Ride" },
  { midi: 39, name: "Clap" }
];

const DRUM_MIDI_SET = new Set(DRUM_LANES.map(d => d.midi));

let beatWidth = 40;
let noteHeight = 16;

let tracks = [];
let currentTrackIndex = 0;

let isPlaying = false;
let currentBeat = 0;
let playTimer = null;
let mode = "scroll";
let bpm = 120;

let scrollX = 0;
let scrollY = 0;

const activeTouches = new Map();
let initialPinchDistance = null;
let initialBeatWidth = beatWidth;
let initialNoteHeight = noteHeight;
let initialScrollX = 0;
let initialScrollY = 0;
let singleStartTouch = { x: 0, y: 0 };

/* ---------- Audio ---------- */

function createSynth(type) {
  let synthClass = Tone.Synth;
  if (type === "fm") synthClass = Tone.FMSynth;
  if (type === "am") synthClass = Tone.AMSynth;

  // 8 voices was too easy to exhaust with chords.
  // 32 gives room for dense passages without being as expensive as 64.
  return new Tone.PolySynth(synthClass, {
    maxPolyphony: 32,
    options: {
      envelope: {
        attack: 0.005,
        decay: 0.09,
        sustain: 0.28,
        release: 0.18
      }
    }
  }).toDestination();
}

function createDrumKit() {
  return {
    kick: new Tone.MembraneSynth({
      pitchDecay: 0.025,
      octaves: 5,
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.06 }
    }).toDestination(),

    snare: new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.03 }
    }).toDestination(),

    hat: new Tone.MetalSynth({
      frequency: 240,
      envelope: { attack: 0.001, decay: 0.055, release: 0.02 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 2800,
      octaves: 1.5
    }).toDestination(),

    tom: new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.20, sustain: 0, release: 0.05 }
    }).toDestination(),

    clap: new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 }
    }).toDestination(),

    crash: new Tone.MetalSynth({
      frequency: 250,
      envelope: { attack: 0.001, decay: 0.65, release: 0.12 },
      harmonicity: 5.1,
      modulationIndex: 35,
      resonance: 3000,
      octaves: 1.8
    }).toDestination(),

    ride: new Tone.MetalSynth({
      frequency: 330,
      envelope: { attack: 0.001, decay: 0.35, release: 0.08 },
      harmonicity: 5.1,
      modulationIndex: 25,
      resonance: 3200,
      octaves: 1.2
    }).toDestination()
  };
}

function disposeTrackAudio(track) {
  if (!track) return;
  try {
    if (track.synth) track.synth.dispose();
  } catch (_) {}
  if (track.drumKit) {
    Object.values(track.drumKit).forEach(node => {
      try { node.dispose(); } catch (_) {}
    });
  }
}

function addTrack(name = null, synthType = "synth") {
  const id = tracks.length;
  const color = TRACK_COLORS[id % TRACK_COLORS.length];

  tracks.push({
    id,
    name: name || `Track ${id + 1}`,
    color,
    synthType,
    isDrum: false,
    synth: createSynth(synthType),
    drumKit: null,
    notes: []
  });

  currentTrackIndex = tracks.length - 1;
  updateTrackUI();
  render();
}

function addDrumTrack(name = null) {
  const id = tracks.length;
  tracks.push({
    id,
    name: name || `Drums ${id + 1}`,
    color: "#ef8fbd",
    synthType: "drums",
    isDrum: true,
    synth: null,
    drumKit: createDrumKit(),
    notes: []
  });

  currentTrackIndex = tracks.length - 1;
  synthSelect.value = "synth";
  synthSelect.disabled = true;
  updateTrackUI();
  render();
}

function updateSynthControl() {
  const track = tracks[currentTrackIndex];
  const isDrum = !!track?.isDrum;

  synthSelect.disabled = isDrum;
  if (!isDrum) synthSelect.value = track.synthType;
}

function updateTrackUI() {
  trackListEl.innerHTML = "";

  tracks.forEach((track, index) => {
    const item = document.createElement("div");
    item.className = `track-item ${index === currentTrackIndex ? "active" : ""}`;

    const badge = document.createElement("span");
    badge.className = "track-color-badge";
    badge.style.backgroundColor = track.color;
    badge.style.color = track.color;

    const name = document.createElement("span");
    name.textContent = track.name;

    item.appendChild(badge);
    item.appendChild(name);

    if (track.isDrum) {
      const drumMark = document.createElement("span");
      drumMark.textContent = "DRUM";
      drumMark.style.fontSize = "8px";
      drumMark.style.letterSpacing = "0.08em";
      drumMark.style.opacity = "0.65";
      item.appendChild(drumMark);
    }

    item.addEventListener("click", () => {
      currentTrackIndex = index;
      updateSynthControl();
      updateTrackUI();
      render();
    });

    trackListEl.appendChild(item);
  });

  updateSynthControl();
}

synthSelect.addEventListener("change", event => {
  const track = tracks[currentTrackIndex];
  if (!track || track.isDrum) return;

  const type = event.target.value;
  try { track.synth.dispose(); } catch (_) {}
  track.synthType = type;
  track.synth = createSynth(type);
});

addTrackBtn.addEventListener("click", () => addTrack());
addDrumBtn.addEventListener("click", () => addDrumTrack());

/* ---------- MIDI ---------- */

function isDrumNote(midi) {
  return DRUM_MIDI_SET.has(midi);
}

function getDrumLaneIndex(midi) {
  return DRUM_LANES.findIndex(d => d.midi === midi);
}

function drumVoice(midi) {
  if ([35, 36].includes(midi)) return "kick";
  if ([37].includes(midi)) return "clap";
  if ([38, 40].includes(midi)) return "snare";
  if ([42, 44, 46].includes(midi)) return "hat";
  if ([45, 47, 48, 50].includes(midi)) return "tom";
  if ([49].includes(midi)) return "crash";
  if ([51, 53, 59].includes(midi)) return "ride";
  return "snare";
}

function triggerDrum(track, midi, when = undefined) {
  const kit = track.drumKit;
  if (!kit) return;

  const time = when;
  try {
    switch (drumVoice(midi)) {
      case "kick":
        kit.kick.triggerAttackRelease("C1", "8n", time);
        break;
      case "snare":
        kit.snare.triggerAttackRelease("16n", time);
        break;
      case "hat":
        kit.hat.triggerAttackRelease("32n", time);
        break;
      case "tom":
        kit.tom.triggerAttackRelease("G2", "8n", time);
        break;
      case "clap":
        kit.clap.triggerAttackRelease("16n", time);
        break;
      case "crash":
        kit.crash.triggerAttackRelease("16n", time);
        break;
      case "ride":
        kit.ride.triggerAttackRelease("16n", time);
        break;
    }
  } catch (_) {}
}

midiInput.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const parsedMidi = new Midi(buffer);

    tracks.forEach(disposeTrackAudio);
    tracks = [];

    const fileBpm = Math.round(parsedMidi.header.tempos[0]?.bpm || 120);
    bpm = Math.max(40, Math.min(240, fileBpm));
    bpmSlider.value = bpm;
    bpmVal.textContent = bpm;

    parsedMidi.tracks.forEach((track, idx) => {
      if (!track.notes.length) return;

      // MIDI channel 10 is percussion in General MIDI.
      const looksLikeDrums =
        track.channel === 9 ||
        track.instrument?.family?.toLowerCase?.().includes("drum") ||
        track.instrument?.name?.toLowerCase?.().includes("drum");

      if (looksLikeDrums) {
        addDrumTrack(track.name || "Drums");
        const drumTrack = tracks[tracks.length - 1];

        track.notes.forEach(note => {
          drumTrack.notes.push({
            note: note.midi,
            startBeat: note.time * (fileBpm / 60),
            duration: Math.max(note.duration * (fileBpm / 60), 0.25)
          });
        });
      } else {
        addTrack(track.name || `Track ${tracks.length + 1}`);
        const currentTrack = tracks[tracks.length - 1];

        track.notes.forEach(note => {
          currentTrack.notes.push({
            note: note.midi,
            startBeat: note.time * (fileBpm / 60),
            duration: Math.max(note.duration * (fileBpm / 60), 0.25)
          });
        });
      }
    });

    if (!tracks.length) addTrack();

    currentTrackIndex = 0;
    updateTrackUI();
    stopPlayback();
    scrollX = 0;
    scrollY = tracks[0]?.isDrum
      ? 0
      : Math.max(0, TOTAL_NOTES * noteHeight - canvas.clientHeight * 0.66);
    render();
  } catch (error) {
    console.error(error);
    alert("MIDIファイルを読み込めませんでした。");
  } finally {
    midiInput.value = "";
  }
});

/* ---------- Controls ---------- */

bpmSlider.addEventListener("input", event => {
  bpm = Number(event.target.value);
  bpmVal.textContent = bpm;
  if (isPlaying) restartTimer();
});

window.addEventListener("resize", resizeCanvas, { passive: true });

modeBtn.addEventListener("click", () => {
  if (mode === "scroll") {
    mode = "edit";
    modeBtn.textContent = "モード: 打ち込み";
    modeBtn.classList.remove("btn-amber");
    modeBtn.classList.add("btn-purple");
  } else {
    mode = "scroll";
    modeBtn.textContent = "モード: スクロール";
    modeBtn.classList.remove("btn-purple");
    modeBtn.classList.add("btn-amber");
  }
});

playBtn.addEventListener("click", async () => {
  await Tone.start();
  isPlaying ? stopPlayback() : startPlayback();
});

clearBtn.addEventListener("click", () => {
  tracks.forEach(track => { track.notes = []; });
  stopPlayback();
  render();
});

/* ---------- Canvas ---------- */

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = document.getElementById("editor-container").clientHeight;

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const track = tracks[currentTrackIndex];
  const rows = track?.isDrum ? DRUM_LANES.length : TOTAL_NOTES;
  scrollY = Math.min(scrollY, Math.max(0, rows * noteHeight - height));

  render();
}

function visibleRows(track) {
  return track?.isDrum ? DRUM_LANES.length : TOTAL_NOTES;
}

function noteRow(track, midi) {
  if (track?.isDrum) {
    const idx = getDrumLaneIndex(midi);
    return idx >= 0 ? idx : 0;
  }
  return TOTAL_NOTES - 1 - (midi - MIN_NOTE);
}

function rowMidi(track, row) {
  if (track?.isDrum) return DRUM_LANES[row]?.midi ?? 36;
  return MIN_NOTE + (TOTAL_NOTES - 1 - row);
}

canvas.addEventListener("pointerdown", async event => {
  await Tone.start();

  canvas.setPointerCapture(event.pointerId);
  activeTouches.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (activeTouches.size === 1) {
    singleStartTouch = { x: event.clientX, y: event.clientY };
    initialScrollX = scrollX;
    initialScrollY = scrollY;

    const track = tracks[currentTrackIndex];

    if (mode === "edit" && track) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const beat = (x + scrollX) / beatWidth;
      const row = Math.floor((y + scrollY) / noteHeight);
      const midiNote = rowMidi(track, row);

      if (track.isDrum || (midiNote >= MIN_NOTE && midiNote <= MAX_NOTE)) {
        const targetBeat = Math.floor(beat);
        const existingIndex = track.notes.findIndex(note =>
          note.note === midiNote &&
          Math.abs(note.startBeat - targetBeat) < 0.5
        );

        if (existingIndex >= 0) {
          track.notes.splice(existingIndex, 1);
        } else {
          track.notes.push({
            note: midiNote,
            startBeat: targetBeat,
            duration: track.isDrum ? 0.25 : 1
          });

          try {
            if (track.isDrum) {
              triggerDrum(track, midiNote);
            } else {
              track.synth.triggerAttackRelease(
                Tone.Frequency(midiNote, "midi").toNote(),
                "8n"
              );
            }
          } catch (_) {}
        }

        render();
      }
    }
  }

  if (activeTouches.size === 2) {
    const points = [...activeTouches.values()];
    initialPinchDistance = Math.hypot(
      points[0].x - points[1].x,
      points[0].y - points[1].y
    );
    initialBeatWidth = beatWidth;
    initialNoteHeight = noteHeight;
  }
});

canvas.addEventListener("pointermove", event => {
  if (!activeTouches.has(event.pointerId)) return;

  activeTouches.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (activeTouches.size === 2 && initialPinchDistance) {
    const points = [...activeTouches.values()];
    const currentDistance = Math.hypot(
      points[0].x - points[1].x,
      points[0].y - points[1].y
    );

    const scale = currentDistance / initialPinchDistance;
    beatWidth = Math.max(10, Math.min(150, initialBeatWidth * scale));
    noteHeight = Math.max(6, Math.min(50, initialNoteHeight * scale));

    const track = tracks[currentTrackIndex];
    const rows = visibleRows(track);
    scrollY = Math.min(
      scrollY,
      Math.max(0, rows * noteHeight - canvas.clientHeight)
    );

    render();
    return;
  }

  if (activeTouches.size === 1 && mode === "scroll") {
    const dx = event.clientX - singleStartTouch.x;
    const dy = event.clientY - singleStartTouch.y;

    const track = tracks[currentTrackIndex];
    const rows = visibleRows(track);

    scrollX = Math.max(0, initialScrollX - dx);
    scrollY = Math.max(
      0,
      Math.min(
        Math.max(0, rows * noteHeight - canvas.clientHeight),
        initialScrollY - dy
      )
    );

    render();
  }
});

function handlePointerEnd(event) {
  activeTouches.delete(event.pointerId);
  if (activeTouches.size < 2) initialPinchDistance = null;
}

canvas.addEventListener("pointerup", handlePointerEnd);
canvas.addEventListener("pointercancel", handlePointerEnd);

/* ---------- Optimized playback ---------- */

/*
  Old version:
    every 1/16 step -> scan every note in every track.
  With thousands of notes this gets expensive.

  New version:
    build an event map once at playback start.
    Each tick only visits notes scheduled for that step.
*/
function buildPlaybackEvents() {
  const events = new Map();

  for (const track of tracks) {
    for (const note of track.notes) {
      const step = Math.round(note.startBeat / 0.25) * 0.25;
      if (!events.has(step)) events.set(step, []);
      events.get(step).push({ track, note });
    }
  }

  return events;
}

function startPlayback() {
  isPlaying = true;
  playBtn.textContent = "停止";
  playBtn.classList.remove("btn-green");
  playBtn.classList.add("btn-amber");
  restartTimer();
}

function restartTimer() {
  if (playTimer) clearInterval(playTimer);

  const events = buildPlaybackEvents();
  const intervalMs = (60 / bpm / 4) * 1000;

  playTimer = setInterval(() => {
    const currentEvents = events.get(
      Math.round(currentBeat / 0.25) * 0.25
    ) || [];

    for (const event of currentEvents) {
      const track = event.track;
      const note = event.note;

      try {
        if (track.isDrum) {
          triggerDrum(track, note.note);
        } else if (track.synth) {
          track.synth.triggerAttackRelease(
            Tone.Frequency(note.note, "midi").toNote(),
            "8n"
          );
        }
      } catch (_) {}
    }

    const cursorX = currentBeat * beatWidth;

    if (
      cursorX - scrollX > canvas.clientWidth * 0.78 ||
      cursorX < scrollX
    ) {
      scrollX = Math.max(0, cursorX - 110);
    }

    render();
    currentBeat += 0.25;
  }, intervalMs);
}

function stopPlayback() {
  isPlaying = false;
  playBtn.textContent = "再生";
  playBtn.classList.remove("btn-amber");
  playBtn.classList.add("btn-green");

  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  currentBeat = 0;
  render();
}

/* ---------- Drawing ---------- */

function roundRect(ctx2d, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx2d.beginPath();
  ctx2d.moveTo(x + r, y);
  ctx2d.arcTo(x + width, y, x + width, y + height, r);
  ctx2d.arcTo(x + width, y + height, x, y + height, r);
  ctx2d.arcTo(x, y + height, x, y, r);
  ctx2d.arcTo(x, y, x + width, y, r);
  ctx2d.closePath();
}

function noteName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function render() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  const track = tracks[currentTrackIndex];
  const drum = !!track?.isDrum;
  const rows = visibleRows(track);

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#0a0c13");
  bg.addColorStop(0.52, "#080a10");
  bg.addColorStop(1, "#06080d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Pitch / drum lanes
  for (let row = 0; row < rows; row++) {
    const y = row * noteHeight - scrollY;
    if (y + noteHeight < 0 || y > height) continue;

    let isStrong = false;
    let label = "";

    if (drum) {
      isStrong = true;
      label = DRUM_LANES[row]?.name || "";
    } else {
      const midiNote = rowMidi(track, row);
      const pitch = midiNote % 12;
      isStrong = pitch === 0 || [1, 3, 6, 8, 10].includes(pitch);
    }

    ctx.fillStyle = drum
      ? (row % 2 === 0 ? "rgba(239,143,189,0.026)" : "rgba(255,255,255,0.012)")
      : (isStrong ? "rgba(255,255,255,0.018)" : "rgba(145,157,190,0.028)");

    ctx.fillRect(0, y, width, noteHeight);

    ctx.strokeStyle = drum
      ? "rgba(239,143,189,0.085)"
      : "rgba(255,255,255,0.055)";

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();

    if (drum && noteHeight >= 11) {
      ctx.fillStyle = "rgba(229,208,220,0.38)";
      ctx.font = "600 8px system-ui";
      ctx.fillText(label, 7, y + Math.min(noteHeight - 3, 11));
    }
  }

  // Beat grid
  const startBeat = Math.floor(scrollX / beatWidth);
  const endBeat = startBeat + Math.ceil(width / beatWidth) + 2;

  for (let beat = startBeat; beat < endBeat; beat++) {
    const x = beat * beatWidth - scrollX;
    const isBar = beat % 4 === 0;
    const isHalf = beat % 2 === 0;

    ctx.strokeStyle = isBar
      ? "rgba(210,220,255,0.20)"
      : isHalf
        ? "rgba(185,195,230,0.075)"
        : "rgba(255,255,255,0.035)";

    ctx.lineWidth = isBar ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();

    if (isBar && !drum) {
      ctx.fillStyle = "rgba(215,222,246,0.22)";
      ctx.font = "600 9px system-ui";
      ctx.fillText(String(beat / 4 + 1), x + 5, 12);
    }
  }

  // Notes
  tracks.forEach((track, trackIndex) => {
    const isActive = trackIndex === currentTrackIndex;
    const noteAlpha = isActive ? 0.92 : 0.24;

    track.notes.forEach(note => {
      const row = noteRow(track, note.note);
      if (row < 0) return;

      const x = note.startBeat * beatWidth - scrollX;
      const y = row * noteHeight - scrollY;
      const w = Math.max(note.duration * beatWidth, drum ? 5 : 4);
      const h = Math.max(noteHeight - 2, 3);

      if (x + w <= 0 || x >= width || y + h <= 0 || y >= height) return;

      const drawX = x + 1;
      const drawY = y + 1;
      const drawW = Math.max(w - 2, 2);

      if (isActive) {
        ctx.save();
        ctx.shadowColor = track.color;
        ctx.shadowBlur = drum ? 7 : 8;
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = track.color;
        roundRect(ctx, drawX, drawY, drawW, h, 2.5);
        ctx.fill();
        ctx.restore();
      }

      const gradient = ctx.createLinearGradient(0, drawY, 0, drawY + h);
      gradient.addColorStop(0, isActive ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.14)");
      gradient.addColorStop(0.18, track.color);
      gradient.addColorStop(1, isActive ? "rgba(130,145,220,0.88)" : "rgba(112,122,160,0.40)");

      ctx.globalAlpha = noteAlpha;
      ctx.fillStyle = gradient;
      roundRect(ctx, drawX, drawY, drawW, h, 2.5);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.fillRect(drawX + 1, drawY + 1, Math.max(drawW - 2, 1), 1);

      if (isActive) {
        ctx.strokeStyle = "rgba(255,255,255,0.58)";
        ctx.lineWidth = 1;
        roundRect(ctx, drawX + 0.5, drawY + 0.5, Math.max(drawW - 1, 1), Math.max(h - 1, 1), 2.5);
        ctx.stroke();
      }

      if (!drum && drawW > 42 && h >= 12 && isActive) {
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.font = "600 8px system-ui";
        ctx.fillText(noteName(note.note), drawX + 5, drawY + h - 4);
      }
    });
  });

  // Playback cursor
  if (isPlaying) {
    const cursorX = currentBeat * beatWidth - scrollX;

    const cursorGradient = ctx.createLinearGradient(0, 0, 0, height);
    cursorGradient.addColorStop(0, "rgba(255,120,135,0.15)");
    cursorGradient.addColorStop(0.5, "rgba(255,103,119,0.92)");
    cursorGradient.addColorStop(1, "rgba(255,120,135,0.15)");

    ctx.strokeStyle = cursorGradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();

    ctx.fillStyle = "#ff9aa5";
    ctx.shadowColor = "#ff7482";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cursorX, 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

addTrack();
requestAnimationFrame(resizeCanvas);
