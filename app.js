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

const MIN_NOTE = 21;
const MAX_NOTE = 108;
const TOTAL_NOTES = MAX_NOTE - MIN_NOTE + 1;

const TRACK_COLORS = [
  "#9fb0ff",
  "#67d7b0",
  "#f6c76f",
  "#ef8fbd",
  "#b493ff",
  "#66c8df"
];

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

function createSynth(type) {
  let synthClass = Tone.Synth;
  if (type === "fm") synthClass = Tone.FMSynth;
  if (type === "am") synthClass = Tone.AMSynth;

  return new Tone.PolySynth(synthClass, {
    maxPolyphony: 8,
    options: {
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.3,
        release: 0.2
      }
    }
  }).toDestination();
}

function addTrack(name = null, synthType = "synth") {
  const id = tracks.length;
  const color = TRACK_COLORS[id % TRACK_COLORS.length];

  const newTrack = {
    id,
    name: name || `Track ${id + 1}`,
    color,
    synthType,
    synth: createSynth(synthType),
    notes: []
  };

  tracks.push(newTrack);
  currentTrackIndex = tracks.length - 1;

  updateTrackUI();
  render();
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

    item.addEventListener("click", () => {
      currentTrackIndex = index;
      synthSelect.value = tracks[currentTrackIndex].synthType;
      updateTrackUI();
      render();
    });

    trackListEl.appendChild(item);
  });
}

synthSelect.addEventListener("change", (event) => {
  const track = tracks[currentTrackIndex];
  if (!track) return;

  const type = event.target.value;
  track.synth.dispose();
  track.synthType = type;
  track.synth = createSynth(type);
});

addTrackBtn.addEventListener("click", () => addTrack());

bpmSlider.addEventListener("input", (event) => {
  bpm = Number(event.target.value);
  bpmVal.textContent = bpm;
  if (isPlaying) restartTimer();
});

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = document.getElementById("editor-container").clientHeight;

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const maxY = Math.max(0, TOTAL_NOTES * noteHeight - height);
  scrollY = Math.min(scrollY, maxY);
  render();
}

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

midiInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const parsedMidi = new Midi(buffer);

    tracks.forEach(track => track.synth.dispose());
    tracks = [];

    const fileBpm = Math.round(parsedMidi.header.tempos[0]?.bpm || 120);
    bpm = Math.max(40, Math.min(240, fileBpm));
    bpmSlider.value = bpm;
    bpmVal.textContent = bpm;

    parsedMidi.tracks.forEach(track => {
      if (!track.notes.length) return;

      addTrack(track.name || `Track ${tracks.length + 1}`);
      const currentTrack = tracks[tracks.length - 1];

      track.notes.forEach(note => {
        const startBeat = note.time * (fileBpm / 60);
        const duration = note.duration * (fileBpm / 60);

        currentTrack.notes.push({
          note: note.midi,
          startBeat,
          duration: Math.max(duration, 0.25)
        });
      });
    });

    if (!tracks.length) addTrack();

    currentTrackIndex = 0;
    updateTrackUI();
    stopPlayback();
    scrollX = 0;
    scrollY = Math.max(0, TOTAL_NOTES * noteHeight - canvas.clientHeight * 0.66);
    render();
  } catch (error) {
    console.error("MIDI loading failed:", error);
    alert("MIDIファイルを読み込めませんでした。");
  } finally {
    midiInput.value = "";
  }
});

canvas.addEventListener("pointerdown", async (event) => {
  await Tone.start();

  canvas.setPointerCapture(event.pointerId);
  activeTouches.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (activeTouches.size === 1) {
    singleStartTouch = {
      x: event.clientX,
      y: event.clientY
    };

    initialScrollX = scrollX;
    initialScrollY = scrollY;

    if (mode === "edit" && tracks[currentTrackIndex]) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const beat = (x + scrollX) / beatWidth;
      const noteIdx = TOTAL_NOTES - 1 - Math.floor((y + scrollY) / noteHeight);
      const midiNote = MIN_NOTE + noteIdx;

      if (midiNote >= MIN_NOTE && midiNote <= MAX_NOTE) {
        const targetBeat = Math.floor(beat);
        const activeNotes = tracks[currentTrackIndex].notes;

        const existingIndex = activeNotes.findIndex(note =>
          note.note === midiNote &&
          Math.abs(note.startBeat - targetBeat) < 0.5
        );

        if (existingIndex >= 0) {
          activeNotes.splice(existingIndex, 1);
        } else {
          activeNotes.push({
            note: midiNote,
            startBeat: targetBeat,
            duration: 1
          });

          try {
            tracks[currentTrackIndex].synth.triggerAttackRelease(
              Tone.Frequency(midiNote, "midi").toNote(),
              "8n"
            );
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

canvas.addEventListener("pointermove", (event) => {
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

    beatWidth = Math.max(
      10,
      Math.min(150, initialBeatWidth * scale)
    );

    noteHeight = Math.max(
      6,
      Math.min(50, initialNoteHeight * scale)
    );

    const maxY = Math.max(0, TOTAL_NOTES * noteHeight - canvas.clientHeight);
    scrollY = Math.min(scrollY, maxY);

    render();
    return;
  }

  if (activeTouches.size === 1 && mode === "scroll") {
    const dx = event.clientX - singleStartTouch.x;
    const dy = event.clientY - singleStartTouch.y;

    scrollX = Math.max(0, initialScrollX - dx);
    scrollY = Math.max(
      0,
      Math.min(
        Math.max(0, TOTAL_NOTES * noteHeight - canvas.clientHeight),
        initialScrollY - dy
      )
    );

    render();
  }
});

function handlePointerEnd(event) {
  activeTouches.delete(event.pointerId);

  if (activeTouches.size < 2) {
    initialPinchDistance = null;
  }
}

canvas.addEventListener("pointerup", handlePointerEnd);
canvas.addEventListener("pointercancel", handlePointerEnd);

playBtn.addEventListener("click", async () => {
  await Tone.start();

  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

clearBtn.addEventListener("click", () => {
  tracks.forEach(track => {
    track.notes = [];
  });

  stopPlayback();
  render();
});

function startPlayback() {
  isPlaying = true;
  playBtn.textContent = "停止";
  playBtn.classList.remove("btn-green");
  playBtn.classList.add("btn-amber");
  restartTimer();
}

function restartTimer() {
  if (playTimer) clearInterval(playTimer);

  const intervalMs = (60 / bpm / 4) * 1000;

  playTimer = setInterval(() => {
    tracks.forEach(track => {
      track.notes
        .filter(note => Math.abs(note.startBeat - currentBeat) < 0.125)
        .forEach(note => {
          try {
            track.synth.triggerAttackRelease(
              Tone.Frequency(note.note, "midi").toNote(),
              "8n"
            );
          } catch (_) {}
        });
    });

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

  ctx.clearRect(0, 0, width, height);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#0a0c13");
  bg.addColorStop(0.52, "#080a10");
  bg.addColorStop(1, "#06080d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle pitch lanes
  for (let i = 0; i < TOTAL_NOTES; i++) {
    const midiNote = MIN_NOTE + (TOTAL_NOTES - 1 - i);
    const y = i * noteHeight - scrollY;

    if (y + noteHeight < 0 || y > height) continue;

    const pitch = midiNote % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(pitch);

    ctx.fillStyle = isBlack
      ? "rgba(255,255,255,0.018)"
      : "rgba(145,157,190,0.028)";

    ctx.fillRect(0, y, width, noteHeight);

    // Horizontal note line
    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();

    // Slightly stronger line at C
    if (pitch === 0) {
      ctx.strokeStyle = "rgba(175,188,230,0.11)";
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
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

    if (isBar) {
      ctx.fillStyle = "rgba(215,222,246,0.22)";
      ctx.font = "600 9px system-ui";
      ctx.fillText(String(beat / 4 + 1), x + 5, 12);
    }
  }

  // Tracks / notes
  tracks.forEach((track, trackIndex) => {
    const isActive = trackIndex === currentTrackIndex;
    const noteAlpha = isActive ? 0.92 : 0.24;

    track.notes.forEach(note => {
      const noteIdx = TOTAL_NOTES - 1 - (note.note - MIN_NOTE);
      const x = note.startBeat * beatWidth - scrollX;
      const y = noteIdx * noteHeight - scrollY;
      const w = Math.max(note.duration * beatWidth, 4);
      const h = Math.max(noteHeight - 2, 3);

      if (x + w <= 0 || x >= width || y + h <= 0 || y >= height) return;

      const drawX = x + 1;
      const drawY = y + 1;
      const drawW = Math.max(w - 2, 2);

      // glow
      if (isActive) {
        ctx.save();
        ctx.shadowColor = track.color;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = track.color;
        roundRect(ctx, drawX, drawY, drawW, h, 2.5);
        ctx.fill();
        ctx.restore();
      }

      const gradient = ctx.createLinearGradient(0, drawY, 0, drawY + h);
      gradient.addColorStop(0, isActive ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.16)");
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

      if (drawW > 42 && h >= 12 && isActive) {
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
