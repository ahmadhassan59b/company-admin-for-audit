const WEIGHTS = {
  workflows: 30,
  pipelines: 25,
  forms: 15,
  usage: 20,
  data_cleanliness: 10
};

const PENALTIES = {
  high: 12,
  medium: 7,
  low: 3
};

function categoryScore(category, rules) {
  const categoryIssues = rules.issues.filter((issue) => issue.category === category);
  const penalty = categoryIssues.reduce(
    (sum, issue) => sum + (PENALTIES[issue.severity] || 0),
    0
  );

  return Math.max(0, 100 - penalty);
}

function calculateScore(snapshot, rules) {
  const weightedScore = Object.entries(WEIGHTS).reduce(
    (sum, [category, weight]) => sum + categoryScore(category, rules) * (weight / 100),
    0
  );

  return Math.round(Math.max(0, Math.min(100, weightedScore)));
}

module.exports = {
  calculateScore
};
