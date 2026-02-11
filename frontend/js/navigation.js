/**
 * SIGN BOT - Navigation
 */

let currentSection = 'home';
let activeIntervals = [];

/**
 * Clear all active intervals
 */
function clearAllIntervals() {
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

/**
 * Register an interval for cleanup
 */
function registerInterval(id) {
  activeIntervals.push(id);
}

/**
 * Navigate to a section
 */
function navigateTo(section) {
  currentSection = section;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.section === section);
  });

  // All view IDs
  const views = {
    home: 'homeView',
    documents: 'documentsView',
    conversations: 'conversationsView',
    metrics: 'metricsView',
    settings: 'settingsView',
  };

  // Show/hide sections
  Object.entries(views).forEach(([key, viewId]) => {
    const view = document.getElementById(viewId);
    if (view) {
      view.classList.toggle('section-hidden', key !== section);
    }
  });

  // Clear previous intervals
  clearAllIntervals();

  // Load data for section
  if (section === 'home') {
    window.Dashboard.loadStats();
    registerInterval(setInterval(window.Dashboard.loadStats, window.CONFIG.REFRESH_INTERVAL_KPIS));
  } else if (section === 'documents') {
    window.Documents.loadDocuments();
    registerInterval(
      setInterval(window.Documents.loadDocuments, window.CONFIG.REFRESH_INTERVAL_DOCUMENTS)
    );
  } else if (section === 'conversations') {
    window.Conversations.loadList();
    registerInterval(
      setInterval(window.Conversations.loadList, window.CONFIG.REFRESH_INTERVAL_CONVERSATIONS)
    );
  } else if (section === 'metrics') {
    window.Metrics.loadAll();
    registerInterval(setInterval(window.Metrics.loadAll, window.CONFIG.REFRESH_INTERVAL_METRICS));
  } else if (section === 'settings') {
    window.Settings.loadHealth();
    registerInterval(
      setInterval(window.Settings.loadHealth, window.CONFIG.REFRESH_INTERVAL_HEALTH)
    );
  }
}

/**
 * Show sidebar (mobile)
 */
function showSidebar() {
  const sidebar = document.getElementById('sidebar');
  const chatArea = document.getElementById('chatArea');
  if (sidebar) {
    sidebar.classList.remove('hidden');
  }
  if (chatArea) {
    chatArea.classList.remove('active');
  }
}

/**
 * Get current section
 */
function getCurrentSection() {
  return currentSection;
}

// Export for use in other modules
window.Navigation = {
  navigateTo,
  showSidebar,
  getCurrentSection,
  clearAllIntervals,
  registerInterval,
};
