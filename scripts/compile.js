#!/usr/bin/env node

/**
 * compile.js — CSV → JSON compiler for AI Scenarios Platform
 * 
 * Reads scenarios.csv, evaluations.csv, and policies.csv from data/
 * Outputs site/data.json with chart-ready, joined data.
 * 
 * Usage: npm run compile
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(__dirname, '..', 'site', 'data.json');

// --- Helpers ---

function readCSV(filename) {
  const filepath = path.join(DATA_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });
}

function toBoolean(val) {
  return String(val).toUpperCase() === 'TRUE';
}

function toNumber(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function getRating(score) {
  if (score < 1.8) return 'Critically Unprepared';
  if (score < 2.6) return 'Highly Unprepared';
  if (score < 3.4) return 'Unprepared';
  if (score < 4.2) return 'Almost Prepared';
  return 'Prepared';
}

// --- Tag columns ---
const TAG_COLUMNS = [
  'tag_mass_unemployment',
  'tag_fiscal_crisis',
  'tag_inequality',
  'tag_ai_concentration',
  'tag_skills_obsolescence',
  'tag_public_service_disruption',
  'tag_democratic_erosion',
  'tag_existential_risk',
];

// --- Main ---

function compile() {
  console.log('📊 Compiling AI Scenarios data...\n');

  // 1. Read CSVs
  const rawScenarios = readCSV('scenarios.csv');
  const rawEvaluations = readCSV('evaluations.csv');
  const rawPolicies = readCSV('policies.csv');
  const rawChallenges = readCSV('challenges.csv');
  const rawRegional = readCSV('regional_preparedness.csv');

  console.log(`  Scenarios:   ${rawScenarios.length}`);
  console.log(`  Evaluations: ${rawEvaluations.length}`);
  console.log(`  Policies:    ${rawPolicies.length}`);
  console.log(`  Challenges:  ${rawChallenges.length}`);
  console.log(`  Regions:     ${rawRegional.length}`);

  // 2. Deduplicate evaluations — keep latest per scenario_id
  const latestEvals = {};
  for (const ev of rawEvaluations) {
    const id = ev.scenario_id;
    if (!latestEvals[id] || ev.date > latestEvals[id].date) {
      latestEvals[id] = ev;
    }
  }

  // 3. Transform scenarios
  const scenarios = rawScenarios.map(row => {
    const tags = TAG_COLUMNS
      .filter(col => toBoolean(row[col]))
      .map(col => col.replace('tag_', ''));

    const ev = latestEvals[row.id];
    const evaluation = ev ? {
      date: ev.date,
      likelihood: toNumber(ev.likelihood),
      impact: toNumber(ev.impact),
      preparedness: toNumber(ev.preparedness),
      rationale: {
        likelihood: ev.likelihood_rationale || '',
        impact: ev.impact_rationale || '',
        preparedness: ev.preparedness_rationale || '',
      }
    } : null;

    return {
      id: row.id,
      title: row.title,
      authors: row.authors,
      institution: row.institution,
      url: row.url,
      year: toNumber(row.year),
      summary: row.summary,
      steep: {
        social: row.social,
        technological: row.technological,
        economic: row.economic,
        environmental: row.environmental,
        political: row.political,
      },
      tags,
      evaluation,
    };
  });

  // 4. Transform policies
  const policies = rawPolicies.map(row => {
    const citations = [];
    for (let i = 1; i <= 3; i++) {
      const text = row[`citation_${i}_text`];
      const url = row[`citation_${i}_url`];
      if (text && url) {
        citations.push({ text, url });
      }
    }

    return {
      id: row.id,
      name: row.name,
      challengeTag: row.challenge_tag ? row.challenge_tag.replace('tag_', '') : '',
      description: row.description,
      updated: row.updated || null,
      isNoRegret: toBoolean(row.is_no_regret),
      citations,
    };
  });

  // 5. Transform challenges — use CSV preparedness if available, else compute from scenarios
  const challenges = rawChallenges.map(row => {
    const tagName = row.tag ? row.tag.replace('tag_', '') : '';

    // Find scenarios that have this challenge tag and have evaluations
    const taggedScenarios = scenarios.filter(s =>
      s.tags.includes(tagName) && s.evaluation
    );

    // Use CSV preparedness value if provided, otherwise compute weighted average
    let preparedness;
    if (row.preparedness && !isNaN(Number(row.preparedness))) {
      preparedness = toNumber(row.preparedness);
    } else {
      let weightedPrep = 0;
      let totalW = 0;
      for (const s of taggedScenarios) {
        const w = s.evaluation.likelihood;
        weightedPrep += s.evaluation.preparedness * w;
        totalW += w;
      }
      preparedness = totalW > 0
        ? Math.round(weightedPrep / totalW * 10) / 10
        : null;
    }

    // Find policies for this challenge
    const challengePolicies = policies
      .filter(p => p.challengeTag === tagName)
      .map(p => p.id);

    return {
      id: row.id,
      tag: tagName,
      problemName: row.problem_name,
      opportunityName: row.opportunity_name,
      description: row.description,
      preparedness,
      rating: preparedness !== null ? getRating(preparedness) : null,
      scenarioCount: taggedScenarios.length,
      policyIds: challengePolicies,
    };
  });

  // 6. Compute aggregate stats
  const evaluatedScenarios = scenarios.filter(s => s.evaluation);
  
  let weightedPreparedness = 0;
  let totalWeight = 0;
  for (const s of evaluatedScenarios) {
    const weight = s.evaluation.likelihood;
    weightedPreparedness += s.evaluation.preparedness * weight;
    totalWeight += weight;
  }

  // Overall preparedness is a weighted average on 1-5 scale
  const overallPreparedness = totalWeight > 0
    ? Math.round(weightedPreparedness / totalWeight * 10) / 10
    : 1;

  // 7. Transform regional preparedness
  const regions = rawRegional.map(row => ({
    id: row.region,
    label: row.label,
    preparedness: toNumber(row.preparedness),
    rating: getRating(toNumber(row.preparedness)),
  }));

  const output = {
    meta: {
      generated: new Date().toISOString(),
      overallPreparedness,
      overallRating: getRating(overallPreparedness),
      scenarioCount: scenarios.length,
      policyCount: policies.length,
    },
    scenarios,
    policies,
    challenges,
    regions,
  };

  // 6. Write output
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✅ Compiled successfully → ${OUTPUT_PATH}`);
  console.log(`\n  Overall Preparedness: ${overallPreparedness}/5`);
  console.log(`  Rating: ${output.meta.overallRating}`);
  console.log(`  Scenarios: ${output.meta.scenarioCount}`);
  console.log(`  Policies: ${output.meta.policyCount}\n`);
}

compile();
