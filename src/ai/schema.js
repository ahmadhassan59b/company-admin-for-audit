const { z } = require('zod');

const AIResultSchema = z.object({
  summary: z.string(),
  quick_wins: z.array(z.string()),
  strategic_recommendations: z.array(z.string()),
  risk_level: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(['low', 'medium', 'high'])
  )
});

module.exports = {
  AIResultSchema
};
