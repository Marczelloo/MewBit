// The numbers selection.js scores and budgets a level's moments with. They were fitted on the 80 train songs of the
// corpus against human maps (mapping-analysis/salience/density/: k_weights_raw.json for the scores, budget_fit.json for
// the budget); nothing here is tuned on the held-out songs.

// K: a logistic model over the candidates of a song (30 ms clusters of the Features v4 onsets). The strength and the
// distance to the grid are ranked within the song; the meter flags stay as they are.
//   score = intercept + coef . [strength, beat, half, quarter, other, downbeat, distance to the grid]
const K_COLUMNS = ["raw_strength", "m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"];
const K = {
  easy: { coef: [2.728315, 1.103038, -0.143434, -2.741593, -0.718213, 0.464883, 0.130978], intercept: -2.511861 },
  normal: { coef: [2.94142, 0.929129, 0.392415, -2.187861, -0.661454, 0.304963, -0.604858], intercept: -1.532559 },
  hard: { coef: [2.920554, 0.798861, 0.670303, -1.370092, -0.690628, 0.238263, -0.967896], intercept: -0.593304 },
};
const CLUSTER_MS = 30; // an onset joins a candidate while it lies within this of the candidate's first onset
const METER_TOLERANCE = 0.07; // a candidate within this share of a beat of a beat, half beat or quarter beat sits on it
const DOWNBEAT_MS = 2; // a beat this near a downbeat of the grid is one

// The budget of a phrase, in moments per second: how much the music offers (the phrase's salient sounds per second and
// its loudness against the song) predicts how many moments people play, a ridge fit on the train songs
// (density/fit_budget.js). A salient sound is a candidate whose score lies in the song's top share (1 - q).
//   fitted = intercept + coef . [salient rate, loudness against the song]
// The fit explains little of the spread between songs, so the rate is stretched round the median people play: the song's
// fitted mean against the median song's (refModel) to the power gamma, the phrase's against its song's to the power delta.
// gamma and delta are the exponents that give the train songs the CV between songs and within a song people have. Rates are
// per second the music plays in the phrase (not the lead-in, not the silence), and a level's maxNpsCeiling caps them.
const BUDGET = {
  q: 0.7,
  coef: [0.35670033628977343, 1.6057845715103989],
  intercept: 0.9700834599670776,
  refModel: 4.564733517120315,
  gamma: 3.896767738433306,
  delta: 2.0187978257457884,
  medianRate: 4.586, // moments per second of the median human song
  minPhraseMs: 2000, // a shorter phrase says too little to enter its song's mean
  minRatio: 0.25, // a phrase's fitted rate counts for at least this share of its song's
};

// How a repeat of Normal is charted (selection.js repeatPlan).
const REPEAT = {
  louder: 1.1, // a repeat is louder than its source when its audible loudness is this many times the source's
  gain: 1.15, // a louder repeat plays this many times the moments of its source (human mappers: density/REPORT.md)
  sparse: 0.5, // a source with fewer moments than this share of a louder repeat's budget is too thin to copy
};

module.exports = { BUDGET, CLUSTER_MS, DOWNBEAT_MS, K, K_COLUMNS, METER_TOLERANCE, REPEAT };
