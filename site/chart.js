/**
 * chart.js — Interactive scatter plot for AI Scenarios Platform
 * Uses D3.js v7 (loaded from CDN in index.html)
 */

(function () {
  'use strict';

  // --- State ---
  let data = null;
  let currentMode = 'risk'; // 'risk' | 'impact' | 'preparedness'

  // --- Constants ---
  const MARGIN = { top: 20, right: 30, bottom: 50, left: 55 };
  const DOT_RADIUS = 7;
  const DOT_RADIUS_HOVER = 10;

  // Likelihood axis category boundaries and labels
  const LIKELIHOOD_TICKS = [12.5, 37.5, 62.5, 87.5];
  const LIKELIHOOD_LABELS = ['Improbable', 'Possible', 'Plausible', 'Probable'];
  const LIKELIHOOD_BOUNDARIES = [25, 50, 75];

  const MODE_CONFIG = {
    risk: {
      label: 'Net Impact',
      yLabel: 'Net Impact',
      getY: (d) => {
        // impact × (1 - preparedness/200), higher = worse
        // impact is negative for harmful, so we negate to get positive "risk"
        const risk = Math.abs(d.evaluation.impact) * (1 - d.evaluation.preparedness / 200);
        return risk;
      },
      yDomain: [0, 100], // 0=bottom=better, 100=top=worse
      dangerZone: true,
    },
    impact: {
      label: 'Impact',
      yLabel: 'Impact',
      getY: (d) => d.evaluation.impact,
      yDomain: [100, -100], // 100(beneficial)=bottom=better, -100(harmful)=top=worse
      dangerZone: false,
    },
    preparedness: {
      label: 'Preparedness',
      yLabel: 'Preparedness',
      getY: (d) => d.evaluation.preparedness,
      yDomain: [200, 0], // 200(prepared)=bottom=better, 0(unprepared)=top=worse
      dangerZone: false,
    },
  };

  // --- Color helpers ---
  // Net impact score: |impact| × (1 - preparedness/200), range 0-100, higher = worse
  function getNetImpact(d) {
    return Math.abs(d.evaluation.impact) * (1 - d.evaluation.preparedness / 200);
  }

  // 5-stage scale based on net impact (0-100, higher = worse)
  function getNetImpactColor(netImpact) {
    if (netImpact >= 80) return '#4a4a4a'; // Critically Unprepared (dark grey)
    if (netImpact >= 60) return '#c0392b'; // Highly Unprepared (red)
    if (netImpact >= 40) return '#e67e22'; // Unprepared (orange)
    if (netImpact >= 20) return '#f1c40f'; // Almost Prepared (yellow)
    return '#27ae60';                       // Prepared (green)
  }

  // Preparedness-based color for table bars (0-200 scale)
  function getPreparednessColor(score) {
    if (score <= 40) return '#4a4a4a';  // Critically Unprepared
    if (score <= 80) return '#c0392b';  // Highly Unprepared
    if (score <= 120) return '#e67e22'; // Unprepared
    if (score <= 160) return '#f1c40f'; // Almost Prepared
    return '#27ae60';                    // Prepared
  }

  function getDotColor(d) {
    return getNetImpactColor(getNetImpact(d));
  }

  // --- Tooltip ---
  function showTooltip(event, d, container) {
    const tooltip = container.querySelector('.chart-tooltip');
    const mode = MODE_CONFIG[currentMode];

    tooltip.innerHTML = `
      <div class="tt-title">${d.title}</div>
      <div class="tt-row"><span class="tt-label">Likelihood</span><span>${d.evaluation.likelihood}%</span></div>
      <div class="tt-row"><span class="tt-label">Impact</span><span>${d.evaluation.impact}</span></div>
      <div class="tt-row"><span class="tt-label">Preparedness</span><span>${d.evaluation.preparedness}/200</span></div>
      <div class="tt-summary">${truncate(d.summary, 120)}</div>
    `;

    tooltip.style.opacity = '1';
    positionTooltip(event, tooltip, container);
  }

  function positionTooltip(event, tooltip, container) {
    const rect = container.getBoundingClientRect();
    let x = event.clientX - rect.left + 15;
    let y = event.clientY - rect.top - 10;

    // Prevent overflow right
    if (x + 300 > rect.width) {
      x = event.clientX - rect.left - 315;
    }
    // Prevent overflow bottom
    if (y + 120 > rect.height) {
      y = event.clientY - rect.top - 120;
    }

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

  // --- Chart rendering ---
  function renderChart() {
    const container = document.getElementById('chart-container');
    if (!container || !data) return;

    // Clear previous
    container.querySelectorAll('svg').forEach((el) => el.remove());

    const scenarios = data.scenarios.filter((s) => s.evaluation);
    const mode = MODE_CONFIG[currentMode];

    // Dimensions
    const containerWidth = container.clientWidth;
    const width = containerWidth;
    const height = Math.min(400, Math.max(280, containerWidth * 0.55));
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = height - MARGIN.top - MARGIN.bottom;

    // Create SVG
    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // Scales
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain(mode.yDomain).range([innerHeight, 0]);

    // Danger zone gradient (Net Risk mode) — reflects the dot color space
    // Covers entire chart area, from green (bottom-left) through yellow/orange to red/dark (top-right)
    if (mode.dangerZone) {
      const defs = svg.append('defs');

      // Horizontal gradient: left (low likelihood, green) → right (high likelihood, darker)
      const hGrad = defs
        .append('linearGradient')
        .attr('id', 'danger-gradient-h')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '100%').attr('y2', '0%');

      hGrad.append('stop').attr('offset', '0%').attr('stop-color', '#27ae60').attr('stop-opacity', 0.0);
      hGrad.append('stop').attr('offset', '40%').attr('stop-color', '#f1c40f').attr('stop-opacity', 0.08);
      hGrad.append('stop').attr('offset', '70%').attr('stop-color', '#e67e22').attr('stop-opacity', 0.12);
      hGrad.append('stop').attr('offset', '100%').attr('stop-color', '#c0392b').attr('stop-opacity', 0.18);

      // Vertical gradient: bottom (low risk, safe) → top (high risk, danger)
      const vGrad = defs
        .append('linearGradient')
        .attr('id', 'danger-gradient-v')
        .attr('x1', '0%').attr('y1', '100%')
        .attr('x2', '0%').attr('y2', '0%');

      vGrad.append('stop').attr('offset', '0%').attr('stop-color', '#27ae60').attr('stop-opacity', 0.0);
      vGrad.append('stop').attr('offset', '50%').attr('stop-color', '#e67e22').attr('stop-opacity', 0.06);
      vGrad.append('stop').attr('offset', '100%').attr('stop-color', '#4a4a4a').attr('stop-opacity', 0.18);

      // Layer both gradients over the full chart area
      g.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .attr('fill', 'url(#danger-gradient-h)');

      g.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .attr('fill', 'url(#danger-gradient-v)');

      // Danger zone label
      g.append('text')
        .attr('x', innerWidth - 8)
        .attr('y', 16)
        .attr('text-anchor', 'end')
        .attr('font-size', '10px')
        .attr('fill', '#c0392b')
        .attr('opacity', 0.5)
        .attr('font-family', 'Source Sans 3, sans-serif')
        .text('HIGH RISK ZONE');
    }

    // Grid lines — Y axis
    g.append('g')
      .attr('class', 'grid-y')
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerWidth).tickFormat(''))
      .selectAll('line')
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-dasharray', '3,3');

    g.selectAll('.grid-y .domain').remove();

    // Grid lines — X axis at category boundaries (25, 50, 75)
    g.append('g')
      .attr('class', 'grid-x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(LIKELIHOOD_BOUNDARIES).tickSize(-innerHeight).tickFormat(''))
      .selectAll('line')
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-dasharray', '3,3');

    g.selectAll('.grid-x .domain').remove();

    // X axis — qualitative likelihood labels
    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues(LIKELIHOOD_TICKS)
          .tickFormat((d, i) => LIKELIHOOD_LABELS[i])
      );

    xAxis.selectAll('text').attr('font-size', '11px').attr('fill', 'rgba(255,255,255,0.5)');
    xAxis.selectAll('line').attr('stroke', 'rgba(255,255,255,0.2)');
    xAxis.select('.domain').attr('stroke', 'rgba(255,255,255,0.2)');

    // Y axis — no numeric labels, just gridlines for reference
    const yAxis = g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(''));
    yAxis.selectAll('line').attr('stroke', 'rgba(255,255,255,0.2)');
    yAxis.select('.domain').attr('stroke', 'rgba(255,255,255,0.2)');

    // Y axis endpoint labels: "Better" at bottom, "Worse" at top
    g.append('text')
      .attr('x', -10)
      .attr('y', 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('fill', '#e74c3c')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text('Worse');

    g.append('text')
      .attr('x', -10)
      .attr('y', innerHeight + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('fill', '#27ae60')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text('Better');

    // Y axis label (mode name, rotated)
    svg
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(MARGIN.top + innerHeight / 2))
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', 'rgba(255,255,255,0.5)')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .text(mode.yLabel);

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

    dots
      .append('circle')
      .attr('r', DOT_RADIUS)
      .attr('fill', (d) => getDotColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    // Labels — short name, positioned to avoid overlap where possible
    dots
      .append('text')
      .text((d) => shortName(d.title))
      .attr('x', DOT_RADIUS + 4)
      .attr('y', 4)
      .attr('font-size', '10px')
      .attr('fill', 'rgba(255,255,255,0.65)')
      .attr('font-family', 'Source Sans 3, sans-serif')
      .attr('pointer-events', 'none');

    // Hover interactions
    dots
      .on('mouseenter', function (event, d) {
        d3.select(this).select('circle').transition().duration(150).attr('r', DOT_RADIUS_HOVER).attr('opacity', 1);
        showTooltip(event, d, container);
      })
      .on('mousemove', function (event, d) {
        const tooltip = container.querySelector('.chart-tooltip');
        positionTooltip(event, tooltip, container);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').transition().duration(150).attr('r', DOT_RADIUS).attr('opacity', 0.9);
        hideTooltip(container);
      });
  }

  function shortName(title) {
    // Truncate long titles for chart labels
    const parts = title.split(':');
    const name = parts[0].trim();
    if (name.length > 20) return name.slice(0, 18) + '...';
    return name;
  }

  // --- Mode switching ---
  function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.chart-controls button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderChart();
  }

  // --- Homepage population ---
  function populateHomepage() {
    if (!data) return;

    const meta = data.meta;

    // Rating
    const ratingClass = getRatingClass(meta.overallRating);

    const ratingValueEl = document.getElementById('hero-rating-value');
    const ratingPctEl = document.getElementById('hero-rating-pct');
    const ratingBarFill = document.getElementById('hero-rating-bar-fill');

    if (ratingValueEl) {
      ratingValueEl.textContent = meta.overallRating.toUpperCase();
      ratingValueEl.className = 'hero-rating-value ' + ratingClass;
    }
    if (ratingPctEl) {
      ratingPctEl.textContent = `(${meta.overallPreparednessPct}%)`;
      ratingPctEl.className = 'hero-rating-pct ' + ratingClass;
    }
    if (ratingBarFill) {
      ratingBarFill.style.width = (meta.overallPreparedness / 200) * 100 + '%';
      ratingBarFill.className = 'hero-rating-bar-fill bg-' + ratingClass.replace('rating-', '');
    }

    // How it works numbers
    const scenarioCountEl = document.getElementById('scenario-count');
    const policyCountEl = document.getElementById('policy-count');
    if (scenarioCountEl) scenarioCountEl.textContent = meta.scenarioCount;
    if (policyCountEl) policyCountEl.textContent = meta.policyCount;

    // Scenario table
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

    // Apply filters
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

    // Sort by likelihood descending
    scenarios.sort((a, b) => b.evaluation.likelihood - a.evaluation.likelihood);

    if (scenarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-results">No scenarios match your filters.</td></tr>';
      return;
    }

    tbody.innerHTML = scenarios
      .map((s) => {
        const ev = s.evaluation;
        const prepPct = Math.round((ev.preparedness / 200) * 100);
        const prepColor = getPreparednessColor(ev.preparedness);

        // Find relevant policies (match challenge tags to scenario tags)
        const relevantPolicies = policies
          .filter((p) => s.tags.includes(p.challengeTag))
          .slice(0, 3);

        const policyHtml = relevantPolicies.length
          ? relevantPolicies.map((p) => `<a href="policy.html#${p.id}" class="policy-tag">${p.name}</a>`).join('')
          : '<span class="policy-tag">&mdash;</span>';

        return `
        <tr>
          <td>
            <a href="scenario.html#${s.id}" class="scenario-name">${s.title}</a>
            <div class="scenario-institution">${s.institution}</div>
          </td>
          <td><span class="likelihood-badge">${ev.likelihood}%</span></td>
          <td>
            <div class="policy-tags">${policyHtml}</div>
          </td>
          <td class="preparedness-cell">
            <div class="preparedness-bar-container">
              <div class="preparedness-bar">
                <div class="preparedness-bar-fill" style="width: ${prepPct}%; background-color: ${prepColor};"></div>
              </div>
              <span class="preparedness-label" style="color: ${prepColor};">${ev.preparedness}/200</span>
            </div>
          </td>
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

    populateHomepage();
    renderChart();

    // Bind chart controls
    document.querySelectorAll('.chart-controls button').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    // Bind search/filter
    const searchInput = document.getElementById('filter-search');
    const tagSelect = document.getElementById('filter-tag');
    if (searchInput) {
      searchInput.addEventListener('input', populateScenarioTable);
    }
    if (tagSelect) {
      tagSelect.addEventListener('change', populateScenarioTable);
    }

    // Responsive resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderChart, 200);
    });
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
