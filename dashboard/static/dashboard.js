/**
 * Cisco IOS Honeypot Dashboard — Frontend Logic
 *
 * Polls the Flask API every 5 seconds and updates:
 * - Stat cards (animated counters)
 * - Timeline chart (sessions over time)
 * - Commands bar chart (top commands)
 * - Top attacker IPs table
 * - Auth attempts table
 * - Live command feed (terminal-style)
 * - Sessions list (paginated, clickable)
 * - Session detail modal (terminal replay)
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = '';
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_FEED_ENTRIES = 100;

// Chart.js global defaults for dark theme
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(51, 65, 85, 0.4)';
Chart.defaults.font.family = "'Inter', sans-serif";


// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let timelineChart = null;
let commandsChart = null;
let sessionsOffset = 0;
const sessionsLimit = 15;
let lastCommandId = 0;


// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function formatTime(isoStr) {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return isoStr;
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return isoStr;
  }
}

function formatDuration(startStr, endStr) {
  if (!startStr) return '--';
  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : new Date();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  return `${h}h ${m}m`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateStr(str, maxLen = 40) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

function animateCounter(el, target) {
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let step = 0;

  function tick() {
    step++;
    if (step >= steps) {
      el.textContent = target.toLocaleString();
      return;
    }
    el.textContent = Math.round(current + stepSize * step).toLocaleString();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}


// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchJSON(url) {
  try {
    const res = await fetch(API_BASE + url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`API Error [${url}]:`, err);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Update: Stat Cards
// ---------------------------------------------------------------------------

async function updateStats() {
  const data = await fetchJSON('/api/stats/overview');
  if (!data) return;

  animateCounter(document.getElementById('stat-total-sessions'), data.total_sessions);
  animateCounter(document.getElementById('stat-unique-ips'), data.unique_ips);
  animateCounter(document.getElementById('stat-total-commands'), data.total_commands);
  animateCounter(document.getElementById('stat-active-sessions'), data.active_sessions);

  document.getElementById('stat-today-sessions').textContent = `Today: ${data.today_sessions}`;
}


// ---------------------------------------------------------------------------
// Update: Timeline Chart
// ---------------------------------------------------------------------------

async function updateTimeline() {
  const data = await fetchJSON('/api/stats/timeline?granularity=hour&days=3');
  if (!data || !data.length) return;

  const labels = data.map(d => {
    if (!d.period) return '';
    // Show only HH:00 for hourly
    const parts = d.period.split('T');
    return parts[1] ? parts[1].slice(0, 5) : parts[0];
  });
  const values = data.map(d => d.count);

  if (timelineChart) {
    timelineChart.data.labels = labels;
    timelineChart.data.datasets[0].data = values;
    timelineChart.update('none');
  } else {
    const ctx = document.getElementById('timeline-chart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0)');

    timelineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Sessions',
          data: values,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#00ff88',
          borderWidth: 2,
          pointBackgroundColor: '#00ff88',
          pointBorderColor: '#0a0e17',
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 23, 0.95)',
            borderColor: 'rgba(0, 255, 136, 0.3)',
            borderWidth: 1,
            titleFont: { family: "'JetBrains Mono', monospace" },
            bodyFont: { family: "'JetBrains Mono', monospace" },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: { maxTicksLimit: 12, font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: { precision: 0, font: { size: 11 } },
          },
        },
      },
    });
  }
}


// ---------------------------------------------------------------------------
// Update: Commands Chart
// ---------------------------------------------------------------------------

async function updateCommandsChart() {
  const data = await fetchJSON('/api/stats/commands?limit=10');
  if (!data || !data.length) return;

  const labels = data.map(d => truncateStr(d.command, 25));
  const values = data.map(d => d.count);

  const colors = [
    '#00ff88', '#06b6d4', '#3b82f6', '#a855f7', '#f59e0b',
    '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6',
  ];

  if (commandsChart) {
    commandsChart.data.labels = labels;
    commandsChart.data.datasets[0].data = values;
    commandsChart.update('none');
  } else {
    const ctx = document.getElementById('commands-chart').getContext('2d');
    commandsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Count',
          data: values,
          backgroundColor: colors.map(c => c + '33'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.7,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 23, 0.95)',
            borderColor: 'rgba(6, 182, 212, 0.3)',
            borderWidth: 1,
            titleFont: { family: "'JetBrains Mono', monospace" },
            bodyFont: { family: "'JetBrains Mono', monospace" },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: { precision: 0, font: { size: 11 } },
          },
          y: {
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 } },
          },
        },
      },
    });
  }
}


// ---------------------------------------------------------------------------
// Update: Top IPs Table
// ---------------------------------------------------------------------------

async function updateTopIPs() {
  const data = await fetchJSON('/api/stats/top-ips?limit=8');
  if (!data) return;

  const tbody = document.getElementById('top-ips-body');

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="empty-state-icon">🌐</div>No data yet</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="ip-cell">${escapeHtml(r.ip)}</td>
      <td class="count-cell">${r.count}</td>
      <td class="time-cell">${formatDate(r.first_seen)}</td>
      <td class="time-cell">${formatDate(r.last_seen)}</td>
    </tr>
  `).join('');
}


// ---------------------------------------------------------------------------
// Update: Auth Attempts Table
// ---------------------------------------------------------------------------

async function updateAuth() {
  const data = await fetchJSON('/api/auth-attempts?limit=20');
  if (!data || !data.top_combos) return;

  const tbody = document.getElementById('auth-body');

  if (!data.top_combos.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="empty-state-icon">🔑</div>No data yet</td></tr>';
    return;
  }

  tbody.innerHTML = data.top_combos.map(r => `
    <tr>
      <td><span class="badge badge-warn">${escapeHtml(r.username)}</span></td>
      <td style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(r.password)}</td>
      <td class="count-cell">${r.cnt}</td>
      <td>${r.success_count > 0
        ? `<span class="badge badge-success">${r.success_count} ✓</span>`
        : `<span class="badge badge-fail">0 ✗</span>`
      }</td>
    </tr>
  `).join('');
}


// ---------------------------------------------------------------------------
// Update: Live Command Feed
// ---------------------------------------------------------------------------

async function updateLiveFeed() {
  const data = await fetchJSON('/api/commands/recent?limit=50');
  if (!data || !data.length) return;

  const feed = document.getElementById('live-feed');

  // Check if there are new entries
  const newestId = data[0]?.id || 0;
  if (newestId <= lastCommandId && lastCommandId !== 0) return;
  lastCommandId = newestId;

  // Reverse so newest is at bottom
  const entries = [...data].reverse();

  feed.innerHTML = entries.map(cmd => {
    const time = formatTime(cmd.timestamp);
    const ip = cmd.session_ip || cmd.src_ip || '?.?.?.?';
    const cmdText = escapeHtml(cmd.command);
    const failClass = cmd.success === 0 ? ' failed' : '';
    return `<div class="feed-entry">
      <span class="feed-time">${time}</span>
      <span class="feed-ip">${escapeHtml(ip)}</span>
      <span class="feed-command${failClass}">${cmdText}</span>
    </div>`;
  }).join('');

  // Auto-scroll to bottom
  feed.scrollTop = feed.scrollHeight;
}


// ---------------------------------------------------------------------------
// Update: Sessions Table
// ---------------------------------------------------------------------------

async function updateSessions() {
  const data = await fetchJSON(`/api/sessions?limit=${sessionsLimit}&offset=${sessionsOffset}`);
  if (!data) return;

  const tbody = document.getElementById('sessions-body');

  if (!data.sessions.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-state-icon">📋</div>No sessions yet</td></tr>';
    return;
  }

  tbody.innerHTML = data.sessions.map(s => {
    const isActive = !s.end_time;
    const statusBadge = isActive
      ? '<span class="badge badge-success">● Active</span>'
      : '<span class="badge badge-fail">● Closed</span>';
    const duration = formatDuration(s.start_time, s.end_time);

    return `<tr class="session-row" onclick="openSession('${escapeHtml(s.id)}')">
      <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted);">${truncateStr(s.id, 16)}</td>
      <td class="ip-cell">${escapeHtml(s.src_ip)}</td>
      <td>${s.username ? `<span class="badge badge-warn">${escapeHtml(s.username)}</span>` : '--'}</td>
      <td class="time-cell">${formatDate(s.start_time)}</td>
      <td style="font-family: var(--font-mono); color: var(--text-secondary);">${duration}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  // Pagination
  const pagDiv = document.getElementById('sessions-pagination');
  const totalPages = Math.ceil(data.total / sessionsLimit);
  const currentPage = Math.floor(sessionsOffset / sessionsLimit) + 1;

  pagDiv.innerHTML = `
    <button class="pagination-btn" onclick="prevPage()" ${sessionsOffset === 0 ? 'disabled' : ''}>← Prev</button>
    <span class="pagination-info">Page ${currentPage} of ${totalPages || 1} (${data.total} total)</span>
    <button class="pagination-btn" onclick="nextPage(${data.total})" ${sessionsOffset + sessionsLimit >= data.total ? 'disabled' : ''}>Next →</button>
  `;
}

function prevPage() {
  sessionsOffset = Math.max(0, sessionsOffset - sessionsLimit);
  updateSessions();
}

function nextPage(total) {
  if (sessionsOffset + sessionsLimit < total) {
    sessionsOffset += sessionsLimit;
    updateSessions();
  }
}


// ---------------------------------------------------------------------------
// Session Detail Modal
// ---------------------------------------------------------------------------

async function openSession(sessionId) {
  const modal = document.getElementById('session-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalMeta = document.getElementById('modal-meta');
  const modalBody = document.getElementById('modal-body');

  modal.classList.add('active');
  modalTitle.textContent = `Session ${truncateStr(sessionId, 20)}`;
  modalBody.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  const data = await fetchJSON(`/api/sessions/${sessionId}`);
  if (!data || !data.session) {
    modalBody.innerHTML = '<div class="empty-state">Session not found</div>';
    return;
  }

  const s = data.session;

  // Meta info
  modalMeta.innerHTML = `
    <div class="modal-meta-item">
      <span class="modal-meta-label">IP:</span>
      <span class="modal-meta-value">${escapeHtml(s.src_ip)}</span>
    </div>
    <div class="modal-meta-item">
      <span class="modal-meta-label">User:</span>
      <span class="modal-meta-value">${escapeHtml(s.username || '--')}</span>
    </div>
    <div class="modal-meta-item">
      <span class="modal-meta-label">Start:</span>
      <span class="modal-meta-value">${formatDate(s.start_time)}</span>
    </div>
    <div class="modal-meta-item">
      <span class="modal-meta-label">Duration:</span>
      <span class="modal-meta-value">${formatDuration(s.start_time, s.end_time)}</span>
    </div>
    <div class="modal-meta-item">
      <span class="modal-meta-label">Client:</span>
      <span class="modal-meta-value">${escapeHtml(s.client_version || '--')}</span>
    </div>
  `;

  // Terminal replay
  if (!data.commands || !data.commands.length) {
    modalBody.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⌨️</div>No commands recorded for this session</div>';
    return;
  }

  // Determine prompt based on cisco mode
  const hostname = 'Router';

  let replayHTML = '<div class="terminal-replay">';
  for (const cmd of data.commands) {
    let prompt;
    switch (cmd.cisco_mode) {
      case 'privileged':
        prompt = `${hostname}# `;
        break;
      case 'config':
        prompt = `${hostname}(config)# `;
        break;
      case 'config-if':
        prompt = `${hostname}(config-if)# `;
        break;
      default:
        prompt = `${hostname}> `;
    }

    replayHTML += `<div>
      <span class="terminal-line-prompt">${escapeHtml(prompt)}</span>
      <span class="terminal-line-input">${escapeHtml(cmd.command)}</span>
    </div>`;

    if (cmd.response) {
      replayHTML += `<div class="terminal-line-output">${escapeHtml(cmd.response)}</div>`;
    }
  }
  replayHTML += '</div>';

  modalBody.innerHTML = replayHTML;
}

function closeModal() {
  document.getElementById('session-modal').classList.remove('active');
}

// Modal close handlers
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('session-modal').addEventListener('click', (e) => {
  if (e.target.id === 'session-modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});


// ---------------------------------------------------------------------------
// Update timestamp display
// ---------------------------------------------------------------------------

function updateTimestamp() {
  const now = new Date();
  document.getElementById('last-updated').textContent =
    `Updated: ${now.toLocaleTimeString('en-GB', { hour12: false })}`;
}


// ---------------------------------------------------------------------------
// Main polling loop
// ---------------------------------------------------------------------------

async function refreshAll() {
  await Promise.all([
    updateStats(),
    updateTimeline(),
    updateCommandsChart(),
    updateTopIPs(),
    updateAuth(),
    updateLiveFeed(),
    updateSessions(),
  ]);
  updateTimestamp();
}

// Initial load
refreshAll();

// Poll every 5 seconds
setInterval(refreshAll, POLL_INTERVAL);
