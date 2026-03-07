/**
 * chart.js — Interactive chart widget for AI Preparedness Tracker
 * Uses D3.js v7 (loaded from CDN)
 *
 * Page-aware: detects which page it's on and initializes accordingly.
 * Both index.html and policies.html include this file so chart code
 * never diverges.
 */

(function () {
  'use strict';

  // --- State ---
  let data = null;
  let chartContainer = null;
  let currentMode = 'risk'; // 'risk' | 'policyGaps' | 'preparedness'

  // --- Helpers ---
  function formatTag(tag) {
    return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // --- Constants ---
  const MARGIN = { top: 20, right: 30, bottom: 50, left: 55 };
  const DOT_RADIUS = 7;
  const DOT_RADIUS_HOVER = 10;

  // Likelihood axis labels (1-5 scale, matching range splits)
  const LIKELIHOOD_TICKS = [1.4, 2.2, 3.0, 3.8, 4.6];
  const LIKELIHOOD_LABELS = ['Improbable', 'Possible', 'Plausible', 'Probable', 'Emerging'];
  const LIKELIHOOD_BOUNDARIES = [1.8, 2.6, 3.4, 4.2];

  const MODE_CONFIG = {
    risk: {
      label: 'Scenarios',
      yLabel: 'Net Impact',
      type: 'scatter',
      getY: (d) => {
        const ev = d.evaluation;
        return ev.impact + ((ev.preparedness - 1) / 4) * (5 - ev.impact);
      },
      yDomain: [5, 1],
      dangerZone: true,
    },
    policyGaps: {
      label: 'Policy Gaps',
      type: 'table',
    },
    preparedness: {
      label: 'Preparedness',
      type: 'barChart',
    },
  };

  // --- Color helpers ---
  function getNetImpact(d) {
    const ev = d.evaluation;
    return ev.impact + ((ev.preparedness - 1) / 4) * (5 - ev.impact);
  }

  function getPreparednessLabel(score) {
    if (score < 1.8) return 'Critically Unprepared';
    if (score < 2.6) return 'Highly Unprepared';
    if (score < 3.4) return 'Unprepared';
    if (score < 4.2) return 'Almost Prepared';
    return 'Prepared';
  }

  function getPreparednessColor(score) {
    if (score < 1.8) return '#000000';
    if (score < 2.6) return '#c0392b';
    if (score < 3.4) return '#e67e22';
    if (score < 4.2) return '#f1c40f';
    return '#27ae60';
  }

  function getImpactLabel(score) {
    if (score < 1.8) return 'Systemic Risk';
    if (score < 2.6) return 'Broken for All';
    if (score < 3.4) return 'Broken for Some';
    if (score < 4.2) return 'Stable';
    return 'Improving';
  }

  function getImpactColor(score) {
    return getPreparednessColor(score);
  }

  function getLikelihoodLabel(score) {
    if (score < 1.8) return 'Improbable';
    if (score < 2.6) return 'Possible';
    if (score < 3.4) return 'Plausible';
    if (score < 4.2) return 'Probable';
    return 'Emerging';
  }

  function getLikelihoodColor(score) {
    if (score < 1.8) return '#cccccc';
    if (score < 2.6) return '#aaaaaa';
    if (score < 3.4) return '#888888';
    if (score < 4.2) return '#666666';
    return '#444444';
  }

  function getNetImpactColor(netImpact) {
    return getPreparednessColor(netImpact);
  }

  // --- Badge HTML helpers ---
  function makeBadge(label, bgColor, textColor) {
    return `<span class="score-badge" style="background:${bgColor};color:${textColor};border:1px solid #fff;border-radius:5px;">${label}</span>`;
  }

  function likelihoodBadge(score) {
    return makeBadge(getLikelihoodLabel(score), getLikelihoodColor(score), '#fff');
  }

  function impactBadge(score) {
    return makeBadge(getImpactLabel(score), getImpactColor(score), '#fff');
  }

  function preparednessBadge(score) {
    return makeBadge(getPreparednessLabel(score), getPreparednessColor(score), '#fff');
  }

  function getDotColor(d) {
    return getPreparednessColor(d.evaluation.preparedness);
  }

  // --- Tooltip ---
  function showTooltip(event, d, container) {
    const tooltip = container.querySelector('.chart-tooltip');
    const ev = d.evaluation;
    tooltip.innerHTML = `
      <div class="tt-title">${d.title}</div>
      <div class="tt-row"><span class="tt-label">Likelihood</span>${likelihoodBadge(ev.likelihood)}</div>
      <div class="tt-row"><span class="tt-label">Impact</span>${impactBadge(ev.impact)}</div>
      <div class="tt-row"><span class="tt-label">Preparedness</span>${preparednessBadge(ev.preparedness)}</div>
      <div class="tt-summary">${truncate(d.summary, 120)}</div>
    `;
    tooltip.style.opacity = '1';
    positionTooltip(event, tooltip, container);
  }

  function positionTooltip(event, tooltip, container) {
    const rect = container.getBoundingClientRect();
    let x = event.clientX - rect.left + 15;
    let y = event.clientY - rect.top - 10;
    if (x + 300 > rect.width) x = event.clientX - rect.left - 315;
    if (y + 120 > rect.height) y = event.clientY - rect.top - 120;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function hideTooltip(container) {
    const tooltip = container.querySelector('.chart-tooltip');
    tooltip.style.opacity = '0';
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  // --- Policy Gaps table ---
  function renderPolicyGapsTable() {
    if (!chartContainer || !data) return;

    chartContainer.querySelectorAll('svg, .chart-table-wrapper').forEach((el) => el.remove());

    const challenges = (data.challenges || [])
      .filter((c) => c.preparedness !== null)
      .sort((a, b) => a.preparedness - b.preparedness)
      .slice(0, 5);

    const wrapper = document.createElement('div');
    wrapper.className = 'chart-table-wrapper';

    const rows = challenges
      .map((c) => {
        const policyCount = c.policyIds ? c.policyIds.length : 0;
        return `
          <tr>
            <td class="gap-challenge-name">${c.problemName}</td>
            <td class="gap-policy-count">${policyCount} ${policyCount === 1 ? 'policy' : 'policies'}</td>
            <td class="gap-preparedness">
              <div class="gap-bar-container">
                ${preparednessBadge(c.preparedness)}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    wrapper.innerHTML = `
      <table class="gap-table">
        <thead>
          <tr>
            <th>Challenge</th>
            <th>Policies</th>
            <th>Preparedness</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    chartContainer.appendChild(wrapper);
  }

  // --- Regional Preparedness bar chart ---
  function renderRegionalBarChart() {
    if (!chartContainer || !data) return;

    chartContainer.querySelectorAll('svg, .chart-table-wrapper').forEach((el) => el.remove());

    const regions = data.regions || [];
    if (regions.length === 0) return;

    const barMargin = { top: 20, right: 30, bottom: 50, left: 140 };
    const containerWidth = chartContainer.clientWidth;
    const width = containerWidth;
    const height = Math.min(400, Math.max(280, containerWidth * 0.55));
    const innerWidth = width - barMargin.left - barMargin.right;
    const innerHeight = height - barMargin.top - barMargin.bottom;

    const svg = d3
      .select(chartContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg
      .append('g')
      .attr('transform', `translate(${barMargin.left},${barMargin.top})`);

    const xScale = d3
      .scaleBand()
      .domain(regions.map((r) => r.label))
      .range([0, innerWidth])
      .padding(0.35);

    const yScale = d3.scaleLinear().domain([0, 5]).range([innerHeight, 0]);

    g.append('g')
      .attr('class', 'grid-y')
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerWidth).tickFormat(''))
      .selectAll('line')
      .attr('stroke', '#e2e4ea')
      .attr('stroke-dasharray', '3,3');
    g.selectAll('.grid-y .domain').remove();

    const yAxisLabels = [
      { val: 1, text: 'Critically Unprepared' },
      { val: 2, text: 'Highly Unprepared' },
      { val: 3, text: 'Unprepared' },
      { val: 4, text: 'Almost Prepared' },
      { val: 5, text: 'Prepared' },
    ];

    const yAxis = g.append('g').call(
      d3.axisLeft(yScale).tickValues([1, 2, 3, 4, 5]).tickFormat((d) => {
        const found = yAxisLabels.find((l) => l.val === d);
        return found ? found.text : '';
      })
    );
    yAxis.selectAll('text').attr('font-size', '10px').attr('fill', '#6b7084');
    yAxis.selectAll('line').attr('stroke', '#ccc');
    yAxis.select('.domain').attr('stroke', '#ccc');

    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale));
    xAxis.selectAll('text').attr('font-size', '12px').attr('fill', '#6b7084').attr('font-weight', '600');
    xAxis.selectAll('line').attr('stroke', '#ccc');
    xAxis.select('.domain').attr('stroke', '#ccc');

    g.selectAll('.bar')
      .data(regions)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => xScale(d.label))
      .attr('y', (d) => yScale(d.preparedness))
      .attr('width', xScale.bandwidth())
      .attr('height', (d) => innerHeight - yScale(d.preparedness))
      .attr('fill', (d) => getPreparednessColor(d.preparedness))
      .attr('rx', 3)
      .attr('opacity', 0.85);

    g.selectAll('.bar-label')
      .data(regions)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', (d) => xScale(d.label) + xScale.bandwidth() / 2)
      .attr('y', (d) => yScale(d.preparedness) - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .attr('fill', (d) => getPreparednessColor(d.preparedness))
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text((d) => d.preparedness.toFixed(1) + '/5');

    g.selectAll('.bar-rating')
      .data(regions)
      .join('text')
      .attr('class', 'bar-rating')
      .attr('x', (d) => xScale(d.label) + xScale.bandwidth() / 2)
      .attr('y', (d) => yScale(d.preparedness) - 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('fill', '#6b7084')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .attr('text-transform', 'uppercase')
      .text((d) => d.rating);
  }

  // --- Chart rendering ---
  function renderChart() {
    if (!chartContainer || !data) return;

    const mode = MODE_CONFIG[currentMode];

    if (mode.type === 'table') {
      renderPolicyGapsTable();
      return;
    }

    if (mode.type === 'barChart') {
      renderRegionalBarChart();
      return;
    }

    // Clear previous
    chartContainer.querySelectorAll('svg, .chart-table-wrapper').forEach((el) => el.remove());

    const scenarios = data.scenarios.filter((s) => s.evaluation);

    const containerWidth = chartContainer.clientWidth;
    const width = containerWidth;
    const height = Math.min(400, Math.max(280, containerWidth * 0.55));
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = height - MARGIN.top - MARGIN.bottom;

    const svg = d3
      .select(chartContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const xScale = d3.scaleLinear().domain([0.5, 5.5]).range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain(mode.yDomain).range([innerHeight, 0]);

    // Plot area background
    const plotDefs = svg.append('defs');
    const plotBgGrad = plotDefs
      .append('linearGradient')
      .attr('id', 'plot-bg-gradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    plotBgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#fde8e6');
    plotBgGrad.append('stop').attr('offset', '50%').attr('stop-color', '#ffffff');
    plotBgGrad.append('stop').attr('offset', '100%').attr('stop-color', '#e6f5eb');

    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', innerWidth).attr('height', innerHeight)
      .attr('fill', 'url(#plot-bg-gradient)');

    if (mode.dangerZone) {
      const defs = svg.append('defs');

      const hGrad = defs
        .append('linearGradient')
        .attr('id', 'danger-gradient-h')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '100%').attr('y2', '0%');
      hGrad.append('stop').attr('offset', '0%').attr('stop-color', '#27ae60').attr('stop-opacity', 0.0);
      hGrad.append('stop').attr('offset', '40%').attr('stop-color', '#f1c40f').attr('stop-opacity', 0.08);
      hGrad.append('stop').attr('offset', '70%').attr('stop-color', '#e67e22').attr('stop-opacity', 0.12);
      hGrad.append('stop').attr('offset', '100%').attr('stop-color', '#c0392b').attr('stop-opacity', 0.18);

      const vGrad = defs
        .append('linearGradient')
        .attr('id', 'danger-gradient-v')
        .attr('x1', '0%').attr('y1', '100%')
        .attr('x2', '0%').attr('y2', '0%');
      vGrad.append('stop').attr('offset', '0%').attr('stop-color', '#27ae60').attr('stop-opacity', 0.0);
      vGrad.append('stop').attr('offset', '50%').attr('stop-color', '#e67e22').attr('stop-opacity', 0.06);
      vGrad.append('stop').attr('offset', '100%').attr('stop-color', '#000000').attr('stop-opacity', 0.18);

      g.append('rect').attr('x', 0).attr('y', 0)
        .attr('width', innerWidth).attr('height', innerHeight)
        .attr('fill', 'url(#danger-gradient-h)');

      g.append('rect').attr('x', 0).attr('y', 0)
        .attr('width', innerWidth).attr('height', innerHeight)
        .attr('fill', 'url(#danger-gradient-v)');

      g.append('text')
        .attr('x', innerWidth - 8).attr('y', 16)
        .attr('text-anchor', 'end')
        .attr('font-size', '10px')
        .attr('fill', '#c0392b')
        .attr('opacity', 0.5)
        .attr('font-family', 'Source Sans 3, sans-serif')
        .text('HIGH RISK ZONE');
    }

    // Grid lines
    g.append('g')
      .attr('class', 'grid-y')
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerWidth).tickFormat(''))
      .selectAll('line')
      .attr('stroke', '#e2e4ea')
      .attr('stroke-dasharray', '3,3');
    g.selectAll('.grid-y .domain').remove();

    g.append('g')
      .attr('class', 'grid-x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(LIKELIHOOD_BOUNDARIES).tickSize(-innerHeight).tickFormat(''))
      .selectAll('line')
      .attr('stroke', '#e2e4ea')
      .attr('stroke-dasharray', '3,3');
    g.selectAll('.grid-x .domain').remove();

    // X axis
    const xAxisG = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues(LIKELIHOOD_TICKS)
          .tickFormat((d, i) => LIKELIHOOD_LABELS[i])
      );
    xAxisG.selectAll('text').attr('font-size', '11px').attr('fill', '#6b7084');
    xAxisG.selectAll('line').attr('stroke', '#ccc');
    xAxisG.select('.domain').attr('stroke', '#ccc');

    // Y axis
    const yAxisG = g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(''));
    yAxisG.selectAll('line').attr('stroke', '#ccc');
    yAxisG.select('.domain').attr('stroke', '#ccc');

    g.append('text')
      .attr('x', -10).attr('y', 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('fill', '#e74c3c')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text('Worse');

    g.append('text')
      .attr('x', -10).attr('y', innerHeight + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('fill', '#27ae60')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text('Better');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(MARGIN.top + innerHeight / 2))
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', '#6b7084')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text(mode.yLabel);

    // Arrow marker definition
    const arrowDefs = svg.append('defs');
    arrowDefs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 1 L 10 5 L 0 9 Z')
      .attr('fill', '#c0392b');

    // Trend arrows (previous → current evaluation)
    const scenariosWithHistory = scenarios.filter((d) => d.previousEvaluation);
    if (scenariosWithHistory.length > 0) {
      const getPrevY = (d) => {
        // Build a fake scenario with previous eval to compute Y
        const prev = { evaluation: d.previousEvaluation };
        return mode.getY(prev);
      };

      g.selectAll('.trend-arrow')
        .data(scenariosWithHistory)
        .join('line')
        .attr('class', 'trend-arrow')
        .attr('x1', (d) => xScale(d.previousEvaluation.likelihood))
        .attr('y1', (d) => yScale(getPrevY(d)))
        .attr('x2', (d) => xScale(d.evaluation.likelihood))
        .attr('y2', (d) => yScale(mode.getY(d)))
        .attr('stroke', '#c0392b')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6)
        .attr('marker-end', 'url(#arrowhead)');
    }

    // Dots
    const dots = g
      .selectAll('.dot')
      .data(scenarios)
      .join('g')
      .attr('class', 'dot')
      .attr('transform', (d) => {
        const x = xScale(d.evaluation.likelihood);
        const y = yScale(mode.getY(d));
        return `translate(${x},${y})`;
      })
      .style('cursor', 'pointer');

    dots.append('circle')
      .attr('r', DOT_RADIUS)
      .attr('fill', (d) => getDotColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    dots.append('text')
      .text((d) => shortName(d.title))
      .attr('x', DOT_RADIUS + 4)
      .attr('y', 4)
      .attr('font-size', '10px')
      .attr('fill', '#6b7084')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .attr('pointer-events', 'none');

    dots
      .on('mouseenter', function (event, d) {
        d3.select(this).select('circle').transition().duration(150).attr('r', DOT_RADIUS_HOVER).attr('opacity', 1);
        showTooltip(event, d, chartContainer);
      })
      .on('mousemove', function (event, d) {
        const tooltip = chartContainer.querySelector('.chart-tooltip');
        positionTooltip(event, tooltip, chartContainer);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').transition().duration(150).attr('r', DOT_RADIUS).attr('opacity', 0.9);
        hideTooltip(chartContainer);
      });
  }

  function shortName(title) {
    const parts = title.split(':');
    const name = parts[0].trim();
    if (name.length > 20) return name.slice(0, 18) + '...';
    return name;
  }

  // --- Chart title map ---
  const CHART_TITLES = {
    risk: 'Key Scenarios to Watch',
    policyGaps: 'Top Policy Gaps',
    preparedness: 'Preparedness by Region',
  };

  // --- Mode switching ---
  function setMode(mode) {
    currentMode = mode;
    // Update controls that are siblings/ancestors of the chart container
    const chartSection = chartContainer.closest('.chart-section') ||
                         chartContainer.closest('.policies-chart-wrapper');
    if (chartSection) {
      chartSection.querySelectorAll('.chart-controls button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
      const titleEl = chartSection.querySelector('.chart-title');
      if (titleEl) titleEl.textContent = CHART_TITLES[mode] || '';
    }
    renderChart();
  }

  // --- Homepage population ---
  function populateHomepage() {
    if (!data) return;

    const meta = data.meta;
    const ratingClass = getRatingClass(meta.overallRating);

    const ratingValueEl = document.getElementById('hero-rating-value');
    const ratingPctEl = document.getElementById('hero-rating-pct');
    const ratingBarFill = document.getElementById('hero-rating-bar-fill');

    if (ratingValueEl) {
      ratingValueEl.textContent = meta.overallRating.toUpperCase();
      ratingValueEl.className = 'hero-rating-value ' + ratingClass;
    }
    if (ratingPctEl) {
      ratingPctEl.textContent = `(${meta.overallPreparedness}/5)`;
      ratingPctEl.className = 'hero-rating-pct ' + ratingClass;
    }
    if (ratingBarFill) {
      ratingBarFill.style.width = ((meta.overallPreparedness - 1) / 4) * 100 + '%';
      ratingBarFill.className = 'hero-rating-bar-fill bg-' + ratingClass.replace('rating-', '');
    }

    const scenarioCountEl = document.getElementById('scenario-count');
    const policyCountEl = document.getElementById('policy-count');
    if (scenarioCountEl) scenarioCountEl.textContent = meta.scenarioCount;
    if (policyCountEl) policyCountEl.textContent = meta.policyCount;

    populateScenarioTable();
  }

  function populateScenarioTable() {
    const tbody = document.getElementById('scenario-tbody');
    if (!tbody) return;

    const searchInput = document.getElementById('filter-search');
    const tagSelect = document.getElementById('filter-tag');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const selectedTag = tagSelect ? tagSelect.value : '';

    let scenarios = data.scenarios.filter((s) => s.evaluation);
    const policies = data.policies;

    if (searchTerm) {
      scenarios = scenarios.filter((s) =>
        s.title.toLowerCase().includes(searchTerm) ||
        s.institution.toLowerCase().includes(searchTerm) ||
        s.authors.toLowerCase().includes(searchTerm) ||
        s.summary.toLowerCase().includes(searchTerm)
      );
    }
    if (selectedTag) {
      scenarios = scenarios.filter((s) => s.tags.includes(selectedTag));
    }

    scenarios.sort((a, b) => b.evaluation.likelihood - a.evaluation.likelihood);

    if (scenarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-results">No scenarios match your filters.</td></tr>';
      return;
    }

    tbody.innerHTML = scenarios
      .map((s) => {
        const ev = s.evaluation;
        const challengeHtml = s.tags.length
          ? s.tags.slice(0, 4).map((tag) => `<span class="scenario-card-tag">${formatTag(tag)}</span>`).join('')
          : '<span class="policy-tag">&mdash;</span>';

        return `
        <tr>
          <td>
            <a href="scenario.html#${s.id}" class="scenario-name">${s.title}</a>
            <div class="scenario-institution">${s.institution}</div>
          </td>
          <td>
            <div class="scenario-card-tags">${challengeHtml}</div>
          </td>
          <td>${likelihoodBadge(ev.likelihood)}</td>
          <td>${impactBadge(ev.impact)}</td>
          <td>${preparednessBadge(ev.preparedness)}</td>
        </tr>`;
      })
      .join('');
  }

  function getRatingClass(rating) {
    const map = {
      'Critically Unprepared': 'rating-critically-unprepared',
      'Highly Unprepared': 'rating-highly-unprepared',
      'Unprepared': 'rating-unprepared',
      'Almost Prepared': 'rating-almost-prepared',
      'Prepared': 'rating-prepared',
    };
    return map[rating] || 'rating-highly-unprepared';
  }

  // --- Initialization ---
  async function init() {
    try {
      const response = await fetch('data.json');
      data = await response.json();
    } catch (err) {
      console.error('Failed to load data.json:', err);
      return;
    }

    // Detect chart container — homepage or policies page
    chartContainer = document.getElementById('chart-container') ||
                     document.getElementById('policies-chart-container');

    // Set default mode based on which page we're on
    if (document.getElementById('policies-chart-container')) {
      currentMode = 'policyGaps';
    } else {
      currentMode = 'risk';
    }

    // Homepage-specific population
    populateHomepage();

    // Render chart if container exists
    if (chartContainer) {
      renderChart();

      // Bind chart controls — find controls relative to the chart's parent section
      const chartSection = chartContainer.closest('.chart-section') ||
                           chartContainer.closest('.policies-chart-wrapper');
      if (chartSection) {
        chartSection.querySelectorAll('.chart-controls button').forEach((btn) => {
          btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });
        // Set initial active state
        chartSection.querySelectorAll('.chart-controls button').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.mode === currentMode);
        });
        const titleEl = chartSection.querySelector('.chart-title');
        if (titleEl) titleEl.textContent = CHART_TITLES[currentMode] || '';
      }
    }

    // Bind search/filter (homepage)
    const searchInput = document.getElementById('filter-search');
    const tagSelect = document.getElementById('filter-tag');
    if (searchInput) searchInput.addEventListener('input', populateScenarioTable);
    if (tagSelect) tagSelect.addEventListener('change', populateScenarioTable);

    // Responsive resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { renderChart(); }, 200);
    });

    // Expose data for other page scripts
    window._aiptData = data;
    window.dispatchEvent(new Event('aiptDataReady'));
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
