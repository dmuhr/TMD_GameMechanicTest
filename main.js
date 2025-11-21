/*
  Attribute heatmap system + Value Index (VI) + time-based Decay.

  New in this version:
    - Decay feedback into radius & attribute strength (with sliders).
    - Non-Human Index (NHI) tab built from ruined miniatures.
    - Noise on VI for decay per tick (instability slider).
*/

const GRID = 64;
const CELL = 8;
const CANVAS_PIX = GRID * CELL;

// Attributes
const ATTRIBUTES = [
  "National Image Accuracy",       // NIA
  "Moral Hygiene Index",           // MHI
  "Patriotic Heritage Value",      // PHV
  "Territorial Integrity",         // TI
  "Social Order Compliance",       // SOC
  "Touristic Desire",              // TD
  "Protected Democracy Index",     // PDI
  "National Reconstruction Factor",// NRF
  "Growth & Prosperity Metric"     // GPM
];
const N_ATTR = ATTRIBUTES.length;

function radiusSliderToCells(slider) {
  return slider * 30; // 0..30 slots
}

// Data: miniatures and fields
// miniature: { id, x, y, attributes[9], radii[9], decay }
let miniatures = [];
let nextId = 1;

// per-attribute scalar field [N_ATTR][GRID*GRID], in [-1,1]
const attrField = [];
for (let j = 0; j < N_ATTR; j++) {
  attrField.push(new Float32Array(GRID * GRID));
}

// Value Index field [-1,1]
const viField = new Float32Array(GRID * GRID);

// Non-Human Index field [-1,1]
const nhiField = new Float32Array(GRID * GRID);

// Per-attribute radius settings for future miniatures
let attrRadii = new Array(N_ATTR).fill(0.5);

/* ----- VI parameters: defaults you liked ----- */

// Linear weights
let viWeights = [
  0.21, // NIA
  0.19, // MHI
  0.28, // PHV
  0.23, // TI
  0.18, // SOC
  0.23, // TD
  0.17, // PDI
  0.22, // NRF
  0.23  // GPM
];

// Targets
let viTargets = [
  0.40, // NIA
  0.10, // MHI
  0.10, // PHV
  0.10, // TI
  0.55, // SOC
  0.20, // TD
  0.00, // PDI
  -0.20,// NRF
  0.45  // GPM
];

// Penalties
let viPenalties = [
  0.35, // NIA
  1.35, // MHI
  0.10, // PHV
  0.00, // TI
  0.30, // SOC
  0.20, // TD
  0.45, // PDI
  0.40, // NRF
  0.55  // GPM
];

let viTau = 0.45;

// Synergies
let alphaGN = 0.28; // GPM * NIA
let alphaPT = 0.23; // PHV * TD
let alphaPS = 0.29; // PDI * SOC

// Stability and squash
let kappa = 0.23;
let gamma = 0.60;

/* ----- Time / Decay parameters ----- */

let ticksPerMinute = 60;
let kBad = 0.10;
let kGood = 0.10;
let viNoiseAmplitude = 0.25; // noise on VI used for decay

// how much decay affects radius / attributes
let decayRadiusInfluence = 1.0; // 0..1
let decayAttrInfluence   = 0.5; // 0..1

// Non-Human Index parameters
let nhThreshold    = 0.75; // decay ≥ threshold => ruin
let nhRadiusFactor = 0.60; // scales base radius for NHI

let simRunning = false;
let tickAccumulator = 0;
let lastTimestamp = null;
let tickCount = 0;

/* ----- DOM elements ----- */

const placeBtn      = document.getElementById("placeBtn");
const resetBtn      = document.getElementById("resetBtn");
const placeManyBtn  = document.getElementById("placeManyBtn");
const multiCountInp = document.getElementById("multiCount");

const xInput   = document.getElementById("xInput");
const yInput   = document.getElementById("yInput");
const randLoc  = document.getElementById("randLoc");
const randAttr = document.getElementById("randAttr");
const randRadius = document.getElementById("randRadius");

const attrInputsDiv   = document.getElementById("attrInputs");
const radiusInputsDiv = document.getElementById("radiusInputs");
const attrTabsDiv     = document.getElementById("attrTabs");

const viWeightsDiv   = document.getElementById("viWeights");
const viSynergiesDiv = document.getElementById("viSynergies");
const viPenaltyDiv   = document.getElementById("viPenaltyTargets");
const viGlobalDiv    = document.getElementById("viGlobal");
const viTauSlider    = document.getElementById("viTau");
const viTauVal       = document.getElementById("viTauVal");

const ticksPerMinSlider = document.getElementById("ticksPerMin");
const ticksPerMinVal    = document.getElementById("ticksPerMinVal");
const kBadSlider        = document.getElementById("kBadSlider");
const kGoodSlider       = document.getElementById("kGoodSlider");
const kBadVal           = document.getElementById("kBadVal");
const kGoodVal          = document.getElementById("kGoodVal");
const noiseSlider       = document.getElementById("noiseSlider");
const noiseVal          = document.getElementById("noiseVal");

const decayRadiusInfluenceSlider = document.getElementById("decayRadiusInfluence");
const decayRadiusInfluenceVal    = document.getElementById("decayRadiusInfluenceVal");
const decayAttrInfluenceSlider   = document.getElementById("decayAttrInfluence");
const decayAttrInfluenceVal      = document.getElementById("decayAttrInfluenceVal");

const nhThresholdSlider = document.getElementById("nhThreshold");
const nhThresholdVal    = document.getElementById("nhThresholdVal");
const nhRadiusSlider    = document.getElementById("nhRadius");
const nhRadiusVal       = document.getElementById("nhRadiusVal");

const timeToggleBtn = document.getElementById("timeToggleBtn");
const timeResetBtn  = document.getElementById("timeResetBtn");
const simStatus     = document.getElementById("simStatus");

const heatCanvas = document.getElementById("heatCanvas");
const heatCtx    = heatCanvas.getContext("2d");

const miniInfo  = document.getElementById("miniInfo");
const valueInfo = document.getElementById("valueInfo");

const miniListDiv = document.getElementById("miniList");

const attrSliders      = [];
const attrValueBoxes   = [];
const radiusSliders    = [];
const radiusValueBoxes = [];
const viWeightSliders  = [];
const viWeightBoxes    = [];
const viTargetSliders  = [];
const viTargetBoxes    = [];
const viPenaltySliders = [];
const viPenaltyBoxes   = [];

let currentLayerIndex = 0;   // 0 = VI, 1 = NHI, 2..10 = attributes
let highlightedMiniId = null;


/* ----- More Info Button ----- */

  document.getElementById("infoBtn").onclick = () =>
    document.getElementById("infoModal").classList.remove("hidden");

  document.getElementById("closeInfo").onclick = () =>
    document.getElementById("infoModal").classList.add("hidden");

// Heatmap palette
const HEAT_STOPS = [
  { pos: 0.0,  r: 8,   g: 29,  b: 88  },
  { pos: 0.33, r: 65,  g: 182, b: 196 },
  { pos: 0.66, r: 254, g: 217, b: 118 },
  { pos: 1.0,  r: 240, g: 59,  b: 32  }
];

function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const a = HEAT_STOPS[i];
    const b = HEAT_STOPS[i + 1];
    if (t >= a.pos && t <= b.pos) {
      const u = (t - a.pos) / (b.pos - a.pos || 1);
      const r = Math.round(a.r + (b.r - a.r) * u);
      const g = Math.round(a.g + (b.g - a.g) * u);
      const bl = Math.round(a.b + (b.b - a.b) * u);
      return [r, g, bl];
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  return [last.r, last.g, last.b];
}

/* ----- State mapping & colors ----- */

function getDecayState(decay) {
  if (decay < 0.25) return "Prototype";
  if (decay < 0.5)  return "Transparent";
  if (decay < 0.75) return "Model";
  return "Ruin";
}

function getStateClass(decay) {
  const s = getDecayState(decay);
  if (s === "Prototype")   return "state-prototype";
  if (s === "Transparent") return "state-transparent";
  if (s === "Model")       return "state-model";
  return "state-ruin";
}

// approximate same palette as CSS pills for canvas squares
function getStateColors(decay) {
  const s = getDecayState(decay);
  if (s === "Prototype") {
    return { fill: "rgba(141,224,255,0.45)", stroke: "rgba(141,224,255,0.95)" };
  }
  if (s === "Transparent") {
    return { fill: "rgba(153,247,185,0.45)", stroke: "rgba(153,247,185,0.95)" };
  }
  if (s === "Model") {
    return { fill: "rgba(255,212,121,0.5)", stroke: "rgba(255,212,121,0.95)" };
  }
  return { fill: "rgba(255,154,166,0.55)", stroke: "rgba(255,154,166,0.95)" };
}

/* ----- UI builders ----- */

function buildAttrInputs() {
  for (let i = 0; i < N_ATTR; i++) {
    const row = document.createElement("div");
    row.className = "attr-row";

    const name = document.createElement("div");
    name.className = "attr-name";
    name.textContent = ATTRIBUTES[i];

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = -1;
    slider.max = 1;
    slider.step = 0.1;
    slider.value = 0;
    slider.className = "attr-slider";

    const valBox = document.createElement("div");
    valBox.className = "attr-val-box";
    valBox.textContent = "0.0";

    slider.addEventListener("input", () => {
      valBox.textContent = Number(slider.value).toFixed(1);
    });

    row.appendChild(name);
    row.appendChild(slider);
    row.appendChild(valBox);
    attrInputsDiv.appendChild(row);

    attrSliders.push(slider);
    attrValueBoxes.push(valBox);
  }
}

function buildRadiusInputs() {
  for (let i = 0; i < N_ATTR; i++) {
    const row = document.createElement("div");
    row.className = "radius-row";

    const name = document.createElement("div");
    name.className = "radius-name";
    name.textContent = ATTRIBUTES[i];

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.01;
    slider.value = 0.5;
    slider.className = "radius-slider";

    const valBox = document.createElement("div");
    valBox.className = "radius-val-box";
    valBox.textContent = "0.50";

    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      attrRadii[i] = val;
      valBox.textContent = val.toFixed(2);
    });

    row.appendChild(name);
    row.appendChild(slider);
    row.appendChild(valBox);
    radiusInputsDiv.appendChild(row);

    radiusSliders.push(slider);
    radiusValueBoxes.push(valBox);
  }
}

function buildTabs() {
  // VI tab
  const viTab = document.createElement("button");
  viTab.className = "attr-tab vi-tab";
  viTab.dataset.index = 0;
  viTab.innerHTML = `<span class="index">VI</span><span>Value Index</span>`;
  viTab.addEventListener("click", () => {
    currentLayerIndex = 0;
    updateTabs();
    render();
  });
  attrTabsDiv.appendChild(viTab);

  // Non-human tab
  const nhTab = document.createElement("button");
  nhTab.className = "attr-tab nh-tab";
  nhTab.dataset.index = 1;
  nhTab.innerHTML = `<span class="index">NH</span><span>Non-Human</span>`;
  nhTab.addEventListener("click", () => {
    currentLayerIndex = 1;
    updateTabs();
    render();
  });
  attrTabsDiv.appendChild(nhTab);

  // Attribute tabs (start at index 2)
  for (let i = 0; i < N_ATTR; i++) {
    const tab = document.createElement("button");
    tab.className = "attr-tab";
    tab.dataset.index = i + 2;

    const idxSpan = document.createElement("span");
    idxSpan.className = "index";
    idxSpan.textContent = i + 1;

    const nameSpan = document.createElement("span");
    const parts = ATTRIBUTES[i].split(" ");
    nameSpan.textContent = parts.slice(0, 2).join(" ");

    tab.appendChild(idxSpan);
    tab.appendChild(nameSpan);

    tab.addEventListener("click", () => {
      currentLayerIndex = i + 2;
      updateTabs();
      render();
    });

    attrTabsDiv.appendChild(tab);
  }
  updateTabs();
}

function updateTabs() {
  const tabs = attrTabsDiv.querySelectorAll(".attr-tab");
  tabs.forEach(btn => {
    const idx = Number(btn.dataset.index);
    if (idx === currentLayerIndex) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

function buildVIWeights() {
  for (let i = 0; i < N_ATTR; i++) {
    const row = document.createElement("div");
    row.className = "vi-row";

    const label = document.createElement("div");
    label.className = "vi-label";
    label.textContent = ATTRIBUTES[i];

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = -0.3;
    slider.max = 0.3;
    slider.step = 0.01;
    slider.value = viWeights[i];
    slider.className = "vi-slider";

    const box = document.createElement("div");
    box.className = "vi-val-box";
    box.textContent = viWeights[i].toFixed(2);

    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      viWeights[i] = val;
      box.textContent = val.toFixed(2);
      recomputeVIField();
      render();
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(box);
    viWeightsDiv.appendChild(row);

    viWeightSliders.push(slider);
    viWeightBoxes.push(box);
  }
}

function buildVISynergies() {
  const mkRow = (name, initial, onChange) => {
    const row = document.createElement("div");
    row.className = "vi-row";

    const label = document.createElement("div");
    label.className = "vi-label";
    label.textContent = name;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 0.5;
    slider.step = 0.01;
    slider.value = initial;
    slider.className = "vi-slider";

    const box = document.createElement("div");
    box.className = "vi-val-box";
    box.textContent = initial.toFixed(2);

    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      box.textContent = val.toFixed(2);
      onChange(val);
      recomputeVIField();
      render();
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(box);
    viSynergiesDiv.appendChild(row);
  };

  mkRow("GPM × NIA (αGN)", alphaGN, v => alphaGN = v);
  mkRow("PHV × TD (αPT)",  alphaPT, v => alphaPT = v);
  mkRow("PDI × SOC (αPS)", alphaPS, v => alphaPS = v);
}

function buildVIPenaltyTargets() {
  for (let i = 0; i < N_ATTR; i++) {
    const row = document.createElement("div");
    row.className = "vi-row";

    const label = document.createElement("div");
    label.className = "vi-label";
    label.textContent = ATTRIBUTES[i];

    const targetSlider = document.createElement("input");
    targetSlider.type = "range";
    targetSlider.min = -1;
    targetSlider.max = 1;
    targetSlider.step = 0.05;
    targetSlider.value = viTargets[i];
    targetSlider.className = "vi-slider";

    const targetBox = document.createElement("div");
    targetBox.className = "vi-val-box";
    targetBox.textContent = viTargets[i].toFixed(2);

    const penaltySlider = document.createElement("input");
    penaltySlider.type = "range";
    penaltySlider.min = 0;
    penaltySlider.max = 2;
    penaltySlider.step = 0.05;
    penaltySlider.value = viPenalties[i];
    penaltySlider.className = "vi-slider";

    const penaltyBox = document.createElement("div");
    penaltyBox.className = "vi-val-box";
    penaltyBox.textContent = viPenalties[i].toFixed(2);

    targetSlider.addEventListener("input", () => {
      const val = Number(targetSlider.value);
      viTargets[i] = val;
      targetBox.textContent = val.toFixed(2);
      recomputeVIField();
      render();
    });

    penaltySlider.addEventListener("input", () => {
      const val = Number(penaltySlider.value);
      viPenalties[i] = val;
      penaltyBox.textContent = val.toFixed(2);
      recomputeVIField();
      render();
    });

    const col = document.createElement("div");
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.flex = "1";

    const entry1 = document.createElement("div");
    entry1.style.display = "flex";
    entry1.style.alignItems = "center";
    entry1.style.gap = "4px";
    entry1.appendChild(targetSlider);
    entry1.appendChild(targetBox);

    const entry2 = document.createElement("div");
    entry2.style.display = "flex";
    entry2.style.alignItems = "center";
    entry2.style.gap = "4px";
    entry2.appendChild(penaltySlider);
    entry2.appendChild(penaltyBox);

    col.appendChild(entry1);
    col.appendChild(entry2);

    row.appendChild(label);
    row.appendChild(col);
    viPenaltyDiv.appendChild(row);

    viTargetSliders.push(targetSlider);
    viTargetBoxes.push(targetBox);
    viPenaltySliders.push(penaltySlider);
    viPenaltyBoxes.push(penaltyBox);
  }

  viTauSlider.addEventListener("input", () => {
    viTau = Number(viTauSlider.value);
    viTauVal.textContent = viTau.toFixed(2);
    recomputeVIField();
    render();
  });
}

function buildVIGlobal() {
  const rowK = document.createElement("div");
  rowK.className = "vi-row";

  const labK = document.createElement("div");
  labK.className = "vi-label";
  labK.textContent = "Stability κ";

  const sK = document.createElement("input");
  sK.type = "range";
  sK.min = 0;
  sK.max = 0.5;
  sK.step = 0.01;
  sK.value = kappa;
  sK.className = "vi-slider";

  const boxK = document.createElement("div");
  boxK.className = "vi-val-box";
  boxK.textContent = kappa.toFixed(2);

  sK.addEventListener("input", () => {
    kappa = Number(sK.value);
    boxK.textContent = kappa.toFixed(2);
    recomputeVIField();
    render();
  });

  rowK.appendChild(labK);
  rowK.appendChild(sK);
  rowK.appendChild(boxK);
  viGlobalDiv.appendChild(rowK);

  const rowG = document.createElement("div");
  rowG.className = "vi-row";

  const labG = document.createElement("div");
  labG.className = "vi-label";
  labG.textContent = "Squash γ";

  const sG = document.createElement("input");
  sG.type = "range";
  sG.min = 0.2;
  sG.max = 2.5;
  sG.step = 0.05;
  sG.value = gamma;
  sG.className = "vi-slider";

  const boxG = document.createElement("div");
  boxG.className = "vi-val-box";
  boxG.textContent = gamma.toFixed(2);

  sG.addEventListener("input", () => {
    gamma = Number(sG.value);
    boxG.textContent = gamma.toFixed(2);
    recomputeVIField();
    render();
  });

  rowG.appendChild(labG);
  rowG.appendChild(sG);
  rowG.appendChild(boxG);
  viGlobalDiv.appendChild(rowG);
}

/* ----- Time / decay UI ----- */

ticksPerMinSlider.addEventListener("input", () => {
  ticksPerMinute = Number(ticksPerMinSlider.value);
  ticksPerMinVal.textContent = ticksPerMinute.toString();
});

kBadSlider.addEventListener("input", () => {
  kBad = Number(kBadSlider.value);
  kBadVal.textContent = kBad.toFixed(2);
});

kGoodSlider.addEventListener("input", () => {
  kGood = Number(kGoodSlider.value);
  kGoodVal.textContent = kGood.toFixed(2);
});

noiseSlider.addEventListener("input", () => {
  viNoiseAmplitude = Number(noiseSlider.value);
  noiseVal.textContent = viNoiseAmplitude.toFixed(2);
});

decayRadiusInfluenceSlider.addEventListener("input", () => {
  decayRadiusInfluence = Number(decayRadiusInfluenceSlider.value);
  decayRadiusInfluenceVal.textContent = decayRadiusInfluence.toFixed(2);
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  render();
});

decayAttrInfluenceSlider.addEventListener("input", () => {
  decayAttrInfluence = Number(decayAttrInfluenceSlider.value);
  decayAttrInfluenceVal.textContent = decayAttrInfluence.toFixed(2);
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  render();
});

nhThresholdSlider.addEventListener("input", () => {
  nhThreshold = Number(nhThresholdSlider.value);
  nhThresholdVal.textContent = nhThreshold.toFixed(2);
  recomputeNonHumanField();
  render();
});

nhRadiusSlider.addEventListener("input", () => {
  nhRadiusFactor = Number(nhRadiusSlider.value);
  nhRadiusVal.textContent = nhRadiusFactor.toFixed(2);
  recomputeNonHumanField();
  render();
});

function updateSimStatusUI() {
  timeToggleBtn.textContent = simRunning ? "Pause" : "Start";
  simStatus.textContent = simRunning ? "Running" : "Paused";
}

timeToggleBtn.addEventListener("click", () => {
  simRunning = !simRunning;
  updateSimStatusUI();
});

timeResetBtn.addEventListener("click", () => {
  simRunning = false;
  tickCount = 0;
  tickAccumulator = 0;
  lastTimestamp = null;
  for (const m of miniatures) {
    m.decay = 0;
  }
  updateSimStatusUI();
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  renderMiniatureList();
  render();
});

/* ----- Core calculation ----- */

function recomputeAttributeFields() {
  for (let j = 0; j < N_ATTR; j++) {
    attrField[j].fill(0);
  }

  if (miniatures.length === 0) return;

  for (let j = 0; j < N_ATTR; j++) {
    const field = attrField[j];

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let acc = 0;

        for (const m of miniatures) {
          const baseAttr = m.attributes[j];
          if (baseAttr === 0) continue;

          // attribute weakened by decay
          let v = baseAttr;
          if (decayAttrInfluence > 0) {
            v = baseAttr * (1 - decayAttrInfluence * m.decay);
          }
          if (Math.abs(v) < 1e-4) continue;

          const dx = x - m.x;
          const dy = y - m.y;
          const d  = Math.sqrt(dx*dx + dy*dy);

          let rSlider = m.radii[j];

          // radius shrinks with decay
          if (decayRadiusInfluence > 0) {
            const factor = Math.max(0, 1 - decayRadiusInfluence * m.decay);
            rSlider *= factor;
          }

          if (rSlider <= 0) {
            if (d === 0) acc += v;
          } else {
            const radiusCells = radiusSliderToCells(rSlider);
            if (radiusCells <= 0) continue;
            const t = d / radiusCells;
            if (t >= 1) continue;

            const w = Math.exp(-(t * t) / (1 - t * t)); // smooth bump
            acc += v * w;
          }
        }

        const idx = y * GRID + x;
        if (acc > 1) acc = 1;
        if (acc < -1) acc = -1;
        field[idx] = acc;
      }
    }
  }
}

function recomputeVIField() {
  for (let idx = 0; idx < GRID * GRID; idx++) {
    const a = new Array(N_ATTR);
    for (let j = 0; j < N_ATTR; j++) {
      let v = attrField[j][idx];
      if (v > 1) v = 1;
      if (v < -1) v = -1;
      a[j] = v;
    }

    const NIA = a[0];
    const MHI = a[1];
    const PHV = a[2];
    const TI  = a[3];
    const SOC = a[4];
    const TD  = a[5];
    const PDI = a[6];
    const NRF = a[7];
    const GPM = a[8];

    let L = 0;
    for (let j = 0; j < N_ATTR; j++) {
      L += viWeights[j] * a[j];
    }

    const S =
      alphaGN * (GPM * NIA) +
      alphaPT * (PHV * TD)   +
      alphaPS * (PDI * SOC);

    let P = 0;
    for (let j = 0; j < N_ATTR; j++) {
      const dev = Math.abs(a[j] - viTargets[j]);
      const excess = dev - viTau;
      if (excess > 0) {
        P += viPenalties[j] * excess * excess;
      }
    }

    const TIpos  = Math.max(0, TI);
    const NRFpos = Math.max(0, NRF);
    const B = kappa * Math.min(TIpos, NRFpos);

    const raw = L + S - P + B;
    const VI = Math.tanh(gamma * raw);
    viField[idx] = VI;
  }
}

function recomputeNonHumanField() {
  nhiField.fill(0);
  if (miniatures.length === 0) return;

  for (const m of miniatures) {
    if (m.decay < nhThreshold) continue; // only ruined-ish

    // average radius slider across attributes
    let avgSlider = 0;
    for (let j = 0; j < N_ATTR; j++) avgSlider += m.radii[j];
    avgSlider /= N_ATTR;

    let slider = avgSlider || 0.3;
    slider *= nhRadiusFactor;
    const radiusCells = Math.max(3, radiusSliderToCells(slider));

    const x0 = Math.max(0, Math.floor(m.x - radiusCells));
    const x1 = Math.min(GRID - 1, Math.ceil(m.x + radiusCells));
    const y0 = Math.max(0, Math.floor(m.y - radiusCells));
    const y1 = Math.min(GRID - 1, Math.ceil(m.y + radiusCells));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - m.x;
        const dy = y - m.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d >= radiusCells) continue;

        const t = d / radiusCells;
        const w = Math.exp(-(t * t) / (1 - t * t)); // same bump
        const idx = y * GRID + x;
        nhiField[idx] += m.decay * w;
      }
    }
  }

  // clamp & map 0..1 -> -1..1
  for (let idx = 0; idx < GRID * GRID; idx++) {
    let v = nhiField[idx];
    if (v > 1) v = 1;
    if (v < 0) v = 0;
    nhiField[idx] = v * 2 - 1;
  }
}

/* ----- Rendering ----- */

function render() {
  let field;
  if (currentLayerIndex === 0) {
    field = viField;
  } else if (currentLayerIndex === 1) {
    field = nhiField;
  } else {
    const attrIndex = currentLayerIndex - 2;
    field = attrField[attrIndex];
  }

  const img = heatCtx.createImageData(CANVAS_PIX, CANVAS_PIX);
  const data = img.data;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const idxField = gy * GRID + gx;
      const val = field[idxField];
      const t = (val + 1) / 2;
      const [r, g, b] = heatColor(Math.pow(t, 0.9));

      const startX = gx * CELL;
      const startY = gy * CELL;

      for (let py = 0; py < CELL; py++) {
        let rowIndex = ((startY + py) * CANVAS_PIX + startX) * 4;
        for (let px = 0; px < CELL; px++) {
          data[rowIndex]   = r;
          data[rowIndex+1] = g;
          data[rowIndex+2] = b;
          data[rowIndex+3] = 255;
          rowIndex += 4;
        }
      }
    }
  }

  heatCtx.putImageData(img, 0, 0);

  heatCtx.save();
  heatCtx.lineWidth = Math.max(1, CELL * 0.14);
  for (const m of miniatures) {
    const cx = m.x * CELL + CELL / 2;
    const cy = m.y * CELL + CELL / 2;
    const baseSize = CELL * 0.9;
    const s  = (m.id === highlightedMiniId) ? baseSize * 1.3 : baseSize;

    const colors = getStateColors(m.decay);

    // fill colored by state
    heatCtx.fillStyle = colors.fill;
    heatCtx.fillRect(cx - s/2, cy - s/2, s, s);

    // stroke
    heatCtx.strokeStyle = colors.stroke;
    heatCtx.strokeRect(cx - s/2, cy - s/2, s, s);

    // extra outline if highlighted
    if (m.id === highlightedMiniId) {
      heatCtx.strokeStyle = "rgba(255,255,255,0.9)";
      heatCtx.lineWidth = Math.max(1, CELL * 0.18);
      heatCtx.strokeRect(cx - s/2 - 1, cy - s/2 - 1, s + 2, s + 2);
      heatCtx.lineWidth = Math.max(1, CELL * 0.14);
    }

    // center dot
    heatCtx.beginPath();
    heatCtx.fillStyle = "rgba(0,0,0,0.85)";
    heatCtx.arc(cx, cy, Math.max(1, CELL*0.12), 0, Math.PI*2);
    heatCtx.fill();
  }
  heatCtx.restore();
}

function renderMiniatureList() {
  miniListDiv.innerHTML = "";
  for (const m of miniatures) {
    const row = document.createElement("div");
    row.className = "mini-row";

    row.addEventListener("mouseenter", () => {
      highlightedMiniId = m.id;
      render();
    });
    row.addEventListener("mouseleave", () => {
      highlightedMiniId = null;
      render();
    });

    const header = document.createElement("div");
    header.className = "mini-row-header";

    const idSpan = document.createElement("div");
    idSpan.className = "mini-id";
    idSpan.textContent = `ID ${m.id}`;

    const decaySpan = document.createElement("div");
    decaySpan.className = "mini-decay";
    decaySpan.textContent = m.decay.toFixed(2);

    header.appendChild(idSpan);
    header.appendChild(decaySpan);

    const statePill = document.createElement("span");
    statePill.className = `mini-state-pill ${getStateClass(m.decay)}`;
    statePill.textContent = getDecayState(m.decay);

    row.appendChild(header);
    row.appendChild(statePill);

    miniListDiv.appendChild(row);
  }
}

/* ----- Hover & click on canvas ----- */

function findMiniatureAtCanvasPos(xCanvas, yCanvas) {
  const gx = xCanvas / CELL;
  const gy = yCanvas / CELL;

  let best = null;
  let bestD = 1e9;
  for (const m of miniatures) {
    const dx = m.x + 0.5 - gx;
    const dy = m.y + 0.5 - gy;
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }

  if (best && bestD <= 0.6) return best;
  return null;
}

heatCanvas.addEventListener("mousemove", (ev) => {
  const rect   = heatCanvas.getBoundingClientRect();
  const scaleX = heatCanvas.width / rect.width;
  const scaleY = heatCanvas.height / rect.height;

  const xC = (ev.clientX - rect.left) * scaleX;
  const yC = (ev.clientY - rect.top) * scaleY;

  const gx = Math.floor(xC / CELL);
  const gy = Math.floor(yC / CELL);

  const mini = findMiniatureAtCanvasPos(xC, yC);
  if (mini) {
    highlightedMiniId = mini.id;
    let html = `ID: <b>${mini.id}</b><br>Pos: <b>${mini.x}, ${mini.y}</b><br>`;
    html += `Decay: <b>${mini.decay.toFixed(2)}</b> — ${getDecayState(mini.decay)}<br>`;
    html += `<div style="margin-top:4px;">`;
    for (let j = 0; j < N_ATTR; j++) {
      html += `<div style="font-size:10px;">${ATTRIBUTES[j]}: ${mini.attributes[j].toFixed(2)}</div>`;
    }
    html += `</div>`;
    miniInfo.innerHTML = html;
    miniInfo.classList.remove("hidden");
  } else {
    highlightedMiniId = null;
    miniInfo.classList.add("hidden");
  }
  render(); // refresh highlight

  if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
    const idx = gy * GRID + gx;
    let val;
    let label;

    if (currentLayerIndex === 0) {
      val = viField[idx];
      label = "VI";
    } else if (currentLayerIndex === 1) {
      val = nhiField[idx];
      label = "Non-Human";
    } else {
      const attrIndex = currentLayerIndex - 2;
      val = attrField[attrIndex][idx];
      label = "Value";
    }

    valueInfo.textContent = `Pos ${gx}, ${gy} · ${label} ${val.toFixed(2)}`;
    valueInfo.classList.remove("hidden");
  } else {
    valueInfo.classList.add("hidden");
  }
});

heatCanvas.addEventListener("mouseleave", () => {
  highlightedMiniId = null;
  miniInfo.classList.add("hidden");
  valueInfo.classList.add("hidden");
  render();
});

// Click to place miniature at clicked cell
heatCanvas.addEventListener("click", (ev) => {
  const rect   = heatCanvas.getBoundingClientRect();
  const scaleX = heatCanvas.width / rect.width;
  const scaleY = heatCanvas.height / rect.height;

  const xC = (ev.clientX - rect.left) * scaleX;
  const yC = (ev.clientY - rect.top) * scaleY;

  const gx = Math.floor(xC / CELL);
  const gy = Math.floor(yC / CELL);

  placeMiniatureAt(gx, gy, { forcePosition: true, silentUI: true });
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  render();
  renderMiniatureList();
});

/* ----- Decay tick ----- */

function decayTick(dtTicks) {
  if (miniatures.length === 0) return;

  for (const m of miniatures) {
    const idx = m.y * GRID + m.x;
    const baseVI = viField[idx];

    const noise = (Math.random() * 2 - 1) * viNoiseAmplitude;
    let VI = baseVI + noise;
    if (VI > 1) VI = 1;
    if (VI < -1) VI = -1;

    let D = m.decay;
    let dD = 0;

    if (VI < 0) {
      dD = kBad * (-VI) * (1 - D) * dtTicks;
    } else if (VI > 0) {
      dD = -kGood * VI * D * dtTicks;
    }

    D += dD;
    if (D < 0) D = 0;
    if (D > 1) D = 1;
    m.decay = D;
  }

  // decay affects fields, VI and NHI
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  renderMiniatureList();
  render();
}

/* ----- Placement helpers ----- */

function placeMiniatureAt(gx, gy, opts = {}) {
  let x = gx;
  let y = gy;

  if (!opts.forcePosition && randLoc.checked) {
    x = Math.floor(Math.random() * GRID);
    y = Math.floor(Math.random() * GRID);
  }

  x = Math.max(0, Math.min(GRID - 1, x));
  y = Math.max(0, Math.min(GRID - 1, y));

  let attrs = [];
  if (randAttr.checked) {
    for (let i = 0; i < N_ATTR; i++) {
      const v = Number(((Math.random() * 2) - 1).toFixed(1));
      attrs.push(v);
      if (!opts.silentUI) {
        attrSliders[i].value = v;
        attrValueBoxes[i].textContent = v.toFixed(1);
      }
    }
  } else {
    attrs = attrSliders.map(s => Number(s.value));
  }

  let radii = [];
if (randRadius.checked) {
  for (let i = 0; i < N_ATTR; i++) {
    const r = Number(Math.random().toFixed(2));
    radii.push(r);

    // Update UI unless silent
    if (!opts.silentUI) {
      radiusSliders[i].value = r;
      radiusValueBoxes[i].textContent = r.toFixed(2);
      attrRadii[i] = r;
    }
  }
} else {
  radii = attrRadii.slice();
}



  const m = {
    id: nextId++,
    x,
    y,
    attributes: attrs,
    radii,
    decay: 0
  };
  miniatures.push(m);
}

placeBtn.addEventListener("click", () => {
  placeMiniatureAt(Number(xInput.value), Number(yInput.value), { forcePosition: false });
  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  render();
  renderMiniatureList();
});

placeManyBtn.addEventListener("click", () => {
  let count = Number(multiCountInp.value);
  if (!Number.isFinite(count)) count = 1;
  count = Math.max(1, Math.min(1000, Math.floor(count)));

  for (let i = 0; i < count; i++) {
    let x = Number(xInput.value);
    let y = Number(yInput.value);
    placeMiniatureAt(x, y, { forcePosition: false, silentUI: true });
  }

  recomputeAttributeFields();
  recomputeVIField();
  recomputeNonHumanField();
  render();
  renderMiniatureList();
});

resetBtn.addEventListener("click", () => {
  miniatures = [];
  nextId = 1;
  for (let j = 0; j < N_ATTR; j++) {
    attrField[j].fill(0);
  }
  viField.fill(0);
  nhiField.fill(0);
  miniInfo.classList.add("hidden");
  valueInfo.classList.add("hidden");
  simRunning = false;
  tickCount = 0;
  tickAccumulator = 0;
  lastTimestamp = null;
  highlightedMiniId = null;
  updateSimStatusUI();
  render();
  renderMiniatureList();
});



/* ----- Animation loop ----- */

function loop(timestamp) {
  if (lastTimestamp == null) {
    lastTimestamp = timestamp;
  }
  const dtSec = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  if (simRunning && ticksPerMinute > 0) {
    const tickIntervalSec = 60 / ticksPerMinute;
    tickAccumulator += dtSec;
    while (tickAccumulator >= tickIntervalSec) {
      decayTick(1);
      tickAccumulator -= tickIntervalSec;
      tickCount++;
    }
  }

  requestAnimationFrame(loop);
}

/* ----- Init ----- */

buildAttrInputs();
buildRadiusInputs();
buildTabs();
buildVIWeights();
buildVISynergies();
buildVIPenaltyTargets();
buildVIGlobal();

updateSimStatusUI();
recomputeAttributeFields();
recomputeVIField();
recomputeNonHumanField();
render();
renderMiniatureList();

requestAnimationFrame(loop);
